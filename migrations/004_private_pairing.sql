-- Secure two-person pairing. Apply after migrations 001 and 003.
create extension if not exists pgcrypto;

create table if not exists public.private_space_invites (
  token_hash bytea primary key,
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz
);

create index if not exists private_space_invites_space_idx
  on public.private_space_invites(space_id);

create table if not exists public.pairing_attempt_limits (
  user_id uuid primary key references auth.users(id) on delete cascade,
  window_started_at timestamptz not null,
  attempt_count integer not null default 0 check (attempt_count >= 0)
);

alter table public.private_space_invites enable row level security;
alter table public.pairing_attempt_limits enable row level security;
revoke all privileges on table public.private_space_invites, public.pairing_attempt_limits
  from anon, public, authenticated;

-- The extension can live in different schemas on Supabase installations.
create or replace function public.evermore_hash_invite(p_code text)
returns bytea
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_crypto_schema name;
  v_hash bytea;
begin
  select namespace.nspname
    into v_crypto_schema
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace on namespace.oid = extension.extnamespace
   where extension.extname = 'pgcrypto';

  if v_crypto_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute pg_catalog.format('select %I.digest($1, $2)', v_crypto_schema)
    into v_hash
    using pg_catalog.convert_to(p_code, 'UTF8'), 'sha256';
  return v_hash;
end;
$function$;

create or replace function public.evermore_new_invite_code()
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_crypto_schema name;
  v_code text;
begin
  select namespace.nspname
    into v_crypto_schema
    from pg_catalog.pg_extension as extension
    join pg_catalog.pg_namespace as namespace on namespace.oid = extension.extnamespace
   where extension.extname = 'pgcrypto';

  if v_crypto_schema is null then
    raise exception 'pgcrypto extension is required';
  end if;

  execute pg_catalog.format('select pg_catalog.encode(%I.gen_random_bytes($1), $2)', v_crypto_schema)
    into v_code
    using 16, 'hex';
  return v_code;
end;
$function$;

revoke all on function public.evermore_hash_invite(text) from public, anon, authenticated;
revoke all on function public.evermore_new_invite_code() from public, anon, authenticated;

-- RLS helpers run as the migration owner, avoiding recursive membership policies.
create or replace function public.is_space_member(p_space uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.space_members as member
    where member.space_id = p_space
      and member.user_id = p_user
      and p_user = (select auth.uid())
  );
$function$;

create or replace function public.evermore_users_share_space(p_first uuid, p_second uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.space_members as first_member
      join public.space_members as second_member
        on second_member.space_id = first_member.space_id
     where first_member.user_id = p_first
       and second_member.user_id = p_second
       and p_second = (select auth.uid())
  );
$function$;

revoke all on function public.is_space_member(uuid, uuid) from public, anon;
revoke all on function public.evermore_users_share_space(uuid, uuid) from public, anon;
grant execute on function public.is_space_member(uuid, uuid) to authenticated;
grant execute on function public.evermore_users_share_space(uuid, uuid) to authenticated;

create unique index if not exists space_members_one_space_per_user_idx
  on public.space_members(user_id);
create unique index if not exists space_members_one_owner_per_space_idx
  on public.space_members(space_id) where role = 'owner';

alter table public.private_spaces enable row level security;
alter table public.space_members enable row level security;

revoke all privileges on table public.private_spaces, public.space_members
  from anon, public, authenticated;
grant select on table public.private_spaces, public.space_members to authenticated;

drop policy if exists select_space_if_member on public.private_spaces;
drop policy if exists insert_space_owner_is_auth on public.private_spaces;
drop policy if exists update_space_owner_only on public.private_spaces;
drop policy if exists private_spaces_select_member on public.private_spaces;
create policy private_spaces_select_member
  on public.private_spaces for select to authenticated
  using (public.is_space_member(id, (select auth.uid())));

drop policy if exists select_members_if_member on public.space_members;
drop policy if exists insert_member_self on public.space_members;
drop policy if exists delete_member_owner_or_self on public.space_members;
drop policy if exists space_members_select_member on public.space_members;
create policy space_members_select_member
  on public.space_members for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

-- A paired user's display name and avatar are visible only within their own space.
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_or_partner_select on public.profiles;
create policy profiles_self_or_partner_select
  on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or public.evermore_users_share_space(id, (select auth.uid()))
  );

create or replace function public.get_my_space()
returns table (
  space_id uuid,
  space_name text,
  pairing_locked boolean,
  member_id uuid,
  member_display_name text,
  member_role text
)
language sql
stable
security definer
set search_path = ''
as $function$
  select space.id, space.name, space.pairing_locked,
         member.user_id, profile.display_name, member.role
    from public.space_members as current_member
    join public.private_spaces as space on space.id = current_member.space_id
    join public.space_members as member on member.space_id = space.id
    left join public.profiles as profile on profile.id = member.user_id
   where current_member.user_id = (select auth.uid())
   order by member.joined_at, member.user_id;
$function$;

create or replace function public.create_private_space(p_space_name text)
returns table (space_id uuid, invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_code text;
  v_expiry timestamptz := now() + interval '24 hours';
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_space_name is null or pg_catalog.char_length(pg_catalog.btrim(p_space_name)) not between 1 and 60 then
    raise exception 'Space name must contain 1 to 60 characters';
  end if;
  if exists (select 1 from public.space_members where user_id = v_user) then
    raise exception 'You are already in a private space';
  end if;

  insert into public.private_spaces (owner, name)
  values (v_user, pg_catalog.btrim(p_space_name))
  returning id into v_space_id;

  insert into public.space_members (space_id, user_id, role)
  values (v_space_id, v_user, 'owner');

  v_code := public.evermore_new_invite_code();
  insert into public.private_space_invites (token_hash, space_id, created_by, expires_at)
  values (public.evermore_hash_invite(v_code), v_space_id, v_user, v_expiry);

  return query select v_space_id, v_code, v_expiry;
end;
$function$;

create or replace function public.create_pairing_invite(p_space_id uuid)
returns table (invite_code text, expires_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_pairing_locked boolean;
  v_member_count integer;
  v_code text;
  v_expiry timestamptz := now() + interval '24 hours';
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select space.pairing_locked into v_pairing_locked
    from public.private_spaces as space
   where space.id = p_space_id and space.owner = v_user
   for update;
  if not found then raise exception 'Only the space owner can create an invite'; end if;
  if v_pairing_locked then raise exception 'This space is already paired'; end if;

  select count(*) into v_member_count
    from public.space_members where space_id = p_space_id;
  if v_member_count <> 1 then raise exception 'This space cannot accept another member'; end if;

  update public.private_space_invites
     set revoked_at = now()
   where space_id = p_space_id and redeemed_at is null and revoked_at is null;

  v_code := public.evermore_new_invite_code();
  insert into public.private_space_invites (token_hash, space_id, created_by, expires_at)
  values (public.evermore_hash_invite(v_code), p_space_id, v_user, v_expiry);

  return query select v_code, v_expiry;
end;
$function$;

create or replace function public.accept_pairing_invite(p_invite_code text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_attempt_count integer;
  v_space_id uuid;
  v_pairing_locked boolean;
  v_invite public.private_space_invites%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_invite_code is null or pg_catalog.lower(pg_catalog.btrim(p_invite_code)) !~ '^[0-9a-f]{32}$' then
    return false;
  end if;
  if exists (select 1 from public.space_members where user_id = v_user) then
    return false;
  end if;

  insert into public.pairing_attempt_limits as attempts (user_id, window_started_at, attempt_count)
  values (v_user, now(), 1)
  on conflict (user_id) do update
    set attempt_count = case
          when attempts.window_started_at < now() - interval '1 hour' then 1
          else attempts.attempt_count + 1
        end,
        window_started_at = case
          when attempts.window_started_at < now() - interval '1 hour' then now()
          else attempts.window_started_at
        end
  returning attempt_count into v_attempt_count;

  if v_attempt_count > 10 then return false; end if;

  select invite.space_id into v_space_id
    from public.private_space_invites as invite
   where invite.token_hash = public.evermore_hash_invite(pg_catalog.lower(pg_catalog.btrim(p_invite_code)))
     and invite.redeemed_at is null
     and invite.revoked_at is null
     and invite.expires_at > now();
  if not found then return false; end if;

  select space.pairing_locked into v_pairing_locked
    from public.private_spaces as space
   where space.id = v_space_id
   for update;
  if not found or v_pairing_locked then return false; end if;

  select invite.* into v_invite
    from public.private_space_invites as invite
   where invite.token_hash = public.evermore_hash_invite(pg_catalog.lower(pg_catalog.btrim(p_invite_code)))
     and invite.space_id = v_space_id
     and invite.redeemed_at is null
     and invite.revoked_at is null
     and invite.expires_at > now()
   for update;
  if not found then return false; end if;

  select count(*) into v_attempt_count
    from public.space_members where space_id = v_space_id;
  if v_attempt_count <> 1 then return false; end if;

  update public.private_space_invites set redeemed_at = now()
   where token_hash = v_invite.token_hash;
  insert into public.space_members (space_id, user_id, role)
  values (v_space_id, v_user, 'member');
  update public.private_spaces set pairing_locked = true where id = v_space_id;

  return true;
end;
$function$;

create or replace function public.reset_pairing(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_pairing_locked boolean;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select space.pairing_locked into v_pairing_locked
    from public.private_spaces as space
   where space.id = p_space_id and space.owner = v_user
   for update;
  if not found then raise exception 'Only the space owner can reset pairing'; end if;
  if not v_pairing_locked then raise exception 'This space is not currently paired'; end if;

  update public.private_space_invites
     set revoked_at = now()
   where space_id = p_space_id and redeemed_at is null and revoked_at is null;
  delete from public.space_members
   where space_id = p_space_id and user_id <> v_user;
  update public.private_spaces set pairing_locked = false where id = p_space_id;
end;
$function$;

revoke all on function public.get_my_space() from public, anon;
revoke all on function public.create_private_space(text) from public, anon;
revoke all on function public.create_pairing_invite(uuid) from public, anon;
revoke all on function public.accept_pairing_invite(text) from public, anon;
revoke all on function public.reset_pairing(uuid) from public, anon;
grant execute on function public.get_my_space() to authenticated;
grant execute on function public.create_private_space(text) to authenticated;
grant execute on function public.create_pairing_invite(uuid) to authenticated;
grant execute on function public.accept_pairing_invite(text) to authenticated;
grant execute on function public.reset_pairing(uuid) to authenticated;
