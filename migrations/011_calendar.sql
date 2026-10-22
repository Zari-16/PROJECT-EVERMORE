-- Personal and paired-space calendar events.
create table if not exists public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 120),
  description text not null default '',
  category text not null default 'Personal',
  starts_at timestamptz not null,
  visibility text not null check (visibility in ('private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (visibility = 'private' and space_id is null)
    or (visibility = 'shared' and space_id is not null)
  ),
  check (pg_catalog.char_length(description) <= 5000)
);

create index if not exists calendar_events_space_starts_idx
  on public.calendar_events(space_id, starts_at);
create index if not exists calendar_events_creator_starts_idx
  on public.calendar_events(created_by, starts_at);

alter table public.calendar_events enable row level security;
revoke all privileges on table public.calendar_events from anon, public, authenticated;
grant select, delete on table public.calendar_events to authenticated;
grant insert (space_id, created_by, title, description, category, starts_at, visibility)
  on table public.calendar_events to authenticated;
grant update (space_id, title, description, category, starts_at, visibility, updated_at)
  on table public.calendar_events to authenticated;

create policy calendar_events_select_visible
  on public.calendar_events for select to authenticated
  using (
    (visibility = 'private' and created_by = (select auth.uid()))
    or (visibility = 'shared' and public.is_space_member(space_id, (select auth.uid())))
  );

create policy calendar_events_insert_own
  on public.calendar_events for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 120
    and pg_catalog.char_length(description) <= 5000
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and space_id is not null
          and public.is_space_member(space_id, (select auth.uid())))
    )
  );

create policy calendar_events_update_own
  on public.calendar_events for update to authenticated
  using (
    created_by = (select auth.uid())
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and public.is_space_member(space_id, (select auth.uid())))
    )
  )
  with check (
    created_by = (select auth.uid())
    and pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 120
    and pg_catalog.char_length(description) <= 5000
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and space_id is not null
          and public.is_space_member(space_id, (select auth.uid())))
    )
  );

create policy calendar_events_delete_own
  on public.calendar_events for delete to authenticated
  using (
    created_by = (select auth.uid())
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and public.is_space_member(space_id, (select auth.uid())))
    )
  );

create or replace function public.evermore_set_calendar_event_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.evermore_set_calendar_event_updated_at() from public, anon, authenticated;
drop trigger if exists calendar_events_updated_at on public.calendar_events;
create trigger calendar_events_updated_at
  before update on public.calendar_events
  for each row execute function public.evermore_set_calendar_event_updated_at();

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'calendar_events'
  ) then
    execute 'alter publication supabase_realtime add table public.calendar_events';
  end if;
end;
$block$;
