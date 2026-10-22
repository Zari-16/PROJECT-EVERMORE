-- Text-first personal and shared memories.
create table if not exists public.memories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160),
  body text not null check (pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 10000),
  memory_date date,
  category text not null default 'Moment',
  visibility text not null check (visibility in ('private', 'shared')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (
    (visibility = 'private' and space_id is null)
    or (visibility = 'shared' and space_id is not null)
  )
);

create index if not exists memories_space_date_idx
  on public.memories(space_id, memory_date desc, created_at desc);
create index if not exists memories_creator_date_idx
  on public.memories(created_by, memory_date desc, created_at desc);

alter table public.memories enable row level security;
revoke all privileges on table public.memories from anon, public, authenticated;
grant select, delete on table public.memories to authenticated;
grant insert (space_id, created_by, title, body, memory_date, category, visibility)
  on table public.memories to authenticated;
grant update (space_id, title, body, memory_date, category, visibility, updated_at)
  on table public.memories to authenticated;

create policy memories_select_visible
  on public.memories for select to authenticated
  using (
    (visibility = 'private' and created_by = (select auth.uid()))
    or (visibility = 'shared' and public.is_space_member(space_id, (select auth.uid())))
  );

create policy memories_insert_own
  on public.memories for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160
    and pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 10000
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and space_id is not null
          and public.is_space_member(space_id, (select auth.uid())))
    )
  );

create policy memories_update_own
  on public.memories for update to authenticated
  using (
    created_by = (select auth.uid())
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and public.is_space_member(space_id, (select auth.uid())))
    )
  )
  with check (
    created_by = (select auth.uid())
    and pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160
    and pg_catalog.char_length(pg_catalog.btrim(body)) between 1 and 10000
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and space_id is not null
          and public.is_space_member(space_id, (select auth.uid())))
    )
  );

create policy memories_delete_own
  on public.memories for delete to authenticated
  using (
    created_by = (select auth.uid())
    and (
      (visibility = 'private' and space_id is null)
      or (visibility = 'shared' and public.is_space_member(space_id, (select auth.uid())))
    )
  );

create or replace function public.evermore_set_memory_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.evermore_set_memory_updated_at() from public, anon, authenticated;
drop trigger if exists memories_updated_at on public.memories;
create trigger memories_updated_at
  before update on public.memories
  for each row execute function public.evermore_set_memory_updated_at();

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'memories'
  ) then
    execute 'alter publication supabase_realtime add table public.memories';
  end if;
end;
$block$;
