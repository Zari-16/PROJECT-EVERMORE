-- Shared Letters, Future Map goals, and Quest Board for a paired space.
create table if not exists public.realm_letters (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  recipient_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 120),
  body text not null check (pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 20000),
  reveal_at timestamptz not null,
  opened_at timestamptz,
  created_at timestamptz not null default now(),
  check (sender_id <> recipient_id)
);

create index if not exists realm_letters_space_created_idx
  on public.realm_letters(space_id, created_at desc);
create index if not exists realm_letters_recipient_reveal_idx
  on public.realm_letters(recipient_id, reveal_at);

create table if not exists public.future_map_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160),
  description text not null default '' check (pg_catalog.char_length(description) <= 3000),
  target_date date,
  category text not null default 'Together' check (pg_catalog.char_length(category) between 1 and 48),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((completed_at is null) = (completed_by is null))
);

create index if not exists future_map_items_space_date_idx
  on public.future_map_items(space_id, target_date, created_at desc);

create table if not exists public.realm_quests (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160),
  description text not null default '' check (pg_catalog.char_length(description) <= 3000),
  reward_points integer not null default 10 check (reward_points between 1 and 1000),
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check ((completed_at is null) = (completed_by is null))
);

create index if not exists realm_quests_space_completed_idx
  on public.realm_quests(space_id, completed_at, created_at desc);

alter table public.realm_letters enable row level security;
alter table public.future_map_items enable row level security;
alter table public.realm_quests enable row level security;
revoke all privileges on table public.realm_letters from anon, public, authenticated;
revoke all privileges on table public.future_map_items from anon, public, authenticated;
revoke all privileges on table public.realm_quests from anon, public, authenticated;
grant select on table public.realm_letters, public.future_map_items, public.realm_quests to authenticated;

create policy realm_letters_select_participants
  on public.realm_letters for select to authenticated
  using (
    public.is_space_member(space_id, (select auth.uid()))
    and (sender_id = (select auth.uid()) or (recipient_id = (select auth.uid()) and reveal_at <= now()))
  );

create policy future_map_items_select_member
  on public.future_map_items for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create policy realm_quests_select_member
  on public.realm_quests for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create or replace function public.send_realm_letter(p_title text, p_body text, p_reveal_at timestamptz)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_recipient uuid;
  v_letter_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 120 then
    raise exception 'Letter titles must be between 1 and 120 characters';
  end if;
  if pg_catalog.char_length(pg_catalog.btrim(p_body)) not between 1 and 20000 then
    raise exception 'Letter text must be between 1 and 20000 characters';
  end if;
  if p_reveal_at is null then raise exception 'Choose when the letter should arrive'; end if;

  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before sending a letter'; end if;
  select member.user_id into v_recipient
    from public.space_members as member
   where member.space_id = v_space and member.user_id <> v_user
   limit 1;
  if not found then raise exception 'A paired recipient is required'; end if;

  insert into public.realm_letters (space_id, sender_id, recipient_id, title, body, reveal_at)
  values (v_space, v_user, v_recipient, pg_catalog.btrim(p_title), pg_catalog.btrim(p_body), p_reveal_at)
  returning id into v_letter_id;
  return v_letter_id;
end;
$function$;

create or replace function public.get_realm_letters()
returns table (
  id uuid,
  sender_id uuid,
  recipient_id uuid,
  title text,
  body text,
  reveal_at timestamptz,
  opened_at timestamptz,
  created_at timestamptz,
  is_revealed boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before opening letters'; end if;

  return query
  select letter.id,
         letter.sender_id,
         letter.recipient_id,
         case when letter.sender_id = v_user or letter.reveal_at <= now()
           then letter.title else 'A sealed letter'::text end,
         case when letter.sender_id = v_user or letter.reveal_at <= now()
           then letter.body else null::text end,
         letter.reveal_at,
         letter.opened_at,
         letter.created_at,
         (letter.sender_id = v_user or letter.reveal_at <= now())
    from public.realm_letters as letter
   where letter.space_id = v_space
     and (letter.sender_id = v_user or letter.recipient_id = v_user)
   order by letter.reveal_at desc, letter.created_at desc;
end;
$function$;

create or replace function public.open_realm_letter(p_letter_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_opened_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before opening letters'; end if;

  update public.realm_letters as letter
     set opened_at = coalesce(letter.opened_at, now())
   where letter.id = p_letter_id
     and letter.space_id = v_space
     and letter.recipient_id = v_user
     and letter.reveal_at <= now()
  returning letter.id into v_opened_id;
  if not found then raise exception 'This letter is not ready to open'; end if;
end;
$function$;

create or replace function public.create_future_map_item(p_title text, p_description text, p_target_date date, p_category text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_item_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 160 then
    raise exception 'Goal titles must be between 1 and 160 characters';
  end if;
  if pg_catalog.char_length(p_description) > 3000 then raise exception 'Descriptions are limited to 3000 characters'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before adding a goal'; end if;
  insert into public.future_map_items (space_id, created_by, title, description, target_date, category)
  values (v_space, v_user, pg_catalog.btrim(p_title), coalesce(p_description, ''), p_target_date,
    coalesce(nullif(pg_catalog.btrim(p_category), ''), 'Together'))
  returning id into v_item_id;
  return v_item_id;
end;
$function$;

create or replace function public.complete_future_map_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_item_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before updating a goal'; end if;
  update public.future_map_items as item
     set completed_at = coalesce(item.completed_at, now()), completed_by = coalesce(item.completed_by, v_user)
   where item.id = p_item_id and item.space_id = v_space
  returning item.id into v_item_id;
  if not found then raise exception 'Goal not found'; end if;
end;
$function$;

create or replace function public.create_realm_quest(p_title text, p_description text, p_reward_points integer)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_quest_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 160 then
    raise exception 'Quest titles must be between 1 and 160 characters';
  end if;
  if pg_catalog.char_length(p_description) > 3000 then raise exception 'Descriptions are limited to 3000 characters'; end if;
  if p_reward_points not between 1 and 1000 then raise exception 'Reward points must be between 1 and 1000'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before creating a quest'; end if;
  insert into public.realm_quests (space_id, created_by, title, description, reward_points)
  values (v_space, v_user, pg_catalog.btrim(p_title), coalesce(p_description, ''), p_reward_points)
  returning id into v_quest_id;
  return v_quest_id;
end;
$function$;

create or replace function public.complete_realm_quest(p_quest_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_quest_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before completing a quest'; end if;
  update public.realm_quests as quest
     set completed_at = coalesce(quest.completed_at, now()), completed_by = coalesce(quest.completed_by, v_user)
   where quest.id = p_quest_id and quest.space_id = v_space
  returning quest.id into v_quest_id;
  if not found then raise exception 'Quest not found'; end if;
end;
$function$;

revoke all on function public.send_realm_letter(text, text, timestamptz) from public, anon;
revoke all on function public.get_realm_letters() from public, anon;
revoke all on function public.open_realm_letter(uuid) from public, anon;
revoke all on function public.create_future_map_item(text, text, date, text) from public, anon;
revoke all on function public.complete_future_map_item(uuid) from public, anon;
revoke all on function public.create_realm_quest(text, text, integer) from public, anon;
revoke all on function public.complete_realm_quest(uuid) from public, anon;
grant execute on function public.send_realm_letter(text, text, timestamptz) to authenticated;
grant execute on function public.get_realm_letters() to authenticated;
grant execute on function public.open_realm_letter(uuid) to authenticated;
grant execute on function public.create_future_map_item(text, text, date, text) to authenticated;
grant execute on function public.complete_future_map_item(uuid) to authenticated;
grant execute on function public.create_realm_quest(text, text, integer) to authenticated;
grant execute on function public.complete_realm_quest(uuid) to authenticated;

do $block$
declare
  v_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;
  foreach v_table in array array['realm_letters', 'future_map_items', 'realm_quests'] loop
    if not exists (
      select 1 from pg_catalog.pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table
    ) then
      execute pg_catalog.format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$block$;