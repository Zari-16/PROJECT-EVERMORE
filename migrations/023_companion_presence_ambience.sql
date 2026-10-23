-- Shared Companion Room presence and visual ambience.
create table if not exists public.companion_room_presence (
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  presence_status text not null default 'here' check (presence_status in ('here', 'away')),
  last_seen_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create index if not exists companion_room_presence_space_seen_idx
  on public.companion_room_presence(space_id, last_seen_at desc);

create table if not exists public.companion_room_settings (
  space_id uuid primary key references public.private_spaces(id) on delete cascade,
  ambience text not null default 'quiet' check (ambience in ('quiet', 'rain', 'garden', 'starlight')),
  updated_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

alter table public.companion_room_presence enable row level security;
alter table public.companion_room_settings enable row level security;
revoke all privileges on table public.companion_room_presence from anon, public, authenticated;
revoke all privileges on table public.companion_room_settings from anon, public, authenticated;
grant select on table public.companion_room_presence, public.companion_room_settings to authenticated;

create policy companion_room_presence_select_member
  on public.companion_room_presence for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create policy companion_room_settings_select_member
  on public.companion_room_settings for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create or replace function public.sync_companion_room(p_presence_status text default null)
returns table (
  member_id uuid,
  member_display_name text,
  presence_status text,
  is_online boolean,
  last_seen_at timestamptz,
  ambience text,
  ambience_updated_by uuid
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_presence_status is not null and p_presence_status not in ('here', 'away') then
    raise exception 'Presence must be here or away';
  end if;

  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before opening the Companion Room'; end if;

  insert into public.companion_room_presence (space_id, user_id, presence_status, last_seen_at)
  values (v_space, v_user, coalesce(p_presence_status, 'here'), now())
  on conflict (space_id, user_id) do update
    set presence_status = coalesce(p_presence_status, companion_room_presence.presence_status),
        last_seen_at = now()
    where companion_room_presence.presence_status is distinct from coalesce(p_presence_status, companion_room_presence.presence_status)
       or companion_room_presence.last_seen_at <= now() - interval '25 seconds';

  insert into public.companion_room_settings (space_id, ambience, updated_by)
  values (v_space, 'quiet', v_user)
  on conflict (space_id) do nothing;

  return query
  select member.user_id,
         coalesce(profile.display_name, 'Partner'::text),
         coalesce(presence.presence_status, 'away'::text),
         coalesce(presence.presence_status = 'here' and presence.last_seen_at >= now() - interval '90 seconds', false),
         presence.last_seen_at,
         settings.ambience,
         settings.updated_by
    from public.space_members as member
    left join public.profiles as profile on profile.id = member.user_id
    left join public.companion_room_presence as presence
      on presence.space_id = member.space_id and presence.user_id = member.user_id
    join public.companion_room_settings as settings on settings.space_id = member.space_id
   where member.space_id = v_space
   order by member.joined_at, member.user_id;
end;
$function$;

create or replace function public.set_companion_room_ambience(p_ambience text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_ambience is null or p_ambience not in ('quiet', 'rain', 'garden', 'starlight') then
    raise exception 'Choose a valid room ambience';
  end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before changing the room ambience'; end if;

  insert into public.companion_room_settings (space_id, ambience, updated_by)
  values (v_space, p_ambience, v_user)
  on conflict (space_id) do update
    set ambience = excluded.ambience, updated_by = excluded.updated_by, updated_at = now();
end;
$function$;

revoke all on function public.sync_companion_room(text) from public, anon;
revoke all on function public.set_companion_room_ambience(text) from public, anon;
grant execute on function public.sync_companion_room(text) to authenticated;
grant execute on function public.set_companion_room_ambience(text) to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'companion_room_presence'
  ) then
    execute 'alter publication supabase_realtime add table public.companion_room_presence';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'companion_room_settings'
  ) then
    execute 'alter publication supabase_realtime add table public.companion_room_settings';
  end if;
end;
$block$;