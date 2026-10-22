-- Shared companion-room task list.
create table if not exists public.shared_tasks (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  assigned_to uuid references auth.users(id) on delete set null,
  title text not null check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160),
  description text not null default '',
  due_at timestamptz,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  status text not null default 'not_started' check (status in ('not_started', 'in_progress', 'completed', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (pg_catalog.char_length(description) <= 5000)
);

create index if not exists shared_tasks_space_status_due_idx
  on public.shared_tasks(space_id, status, due_at);

alter table public.shared_tasks enable row level security;
revoke all privileges on table public.shared_tasks from anon, public, authenticated;
grant select, delete on table public.shared_tasks to authenticated;
grant insert (space_id, created_by, assigned_to, title, description, due_at, priority, status)
  on table public.shared_tasks to authenticated;
grant update (assigned_to, title, description, due_at, priority, status, updated_at)
  on table public.shared_tasks to authenticated;

create or replace function public.evermore_task_assignee_allowed(p_space_id uuid, p_assigned_to uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.space_members as own_member
     where own_member.space_id = p_space_id
       and own_member.user_id = (select auth.uid())
  ) and (
    p_assigned_to is null
    or exists (
      select 1 from public.space_members as assignee
       where assignee.space_id = p_space_id
         and assignee.user_id = p_assigned_to
    )
  );
$function$;

revoke all on function public.evermore_task_assignee_allowed(uuid, uuid) from public, anon;
grant execute on function public.evermore_task_assignee_allowed(uuid, uuid) to authenticated;

create policy shared_tasks_select_member
  on public.shared_tasks for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create policy shared_tasks_insert_member
  on public.shared_tasks for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and public.evermore_task_assignee_allowed(space_id, assigned_to)
    and pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160
    and pg_catalog.char_length(description) <= 5000
    and priority in ('low', 'normal', 'high')
    and status in ('not_started', 'in_progress', 'completed', 'cancelled')
  );

create policy shared_tasks_update_member
  on public.shared_tasks for update to authenticated
  using (public.is_space_member(space_id, (select auth.uid())))
  with check (
    public.is_space_member(space_id, (select auth.uid()))
    and public.evermore_task_assignee_allowed(space_id, assigned_to)
    and pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 160
    and pg_catalog.char_length(description) <= 5000
    and priority in ('low', 'normal', 'high')
    and status in ('not_started', 'in_progress', 'completed', 'cancelled')
  );

create policy shared_tasks_delete_creator
  on public.shared_tasks for delete to authenticated
  using (
    created_by = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
  );

create or replace function public.evermore_set_shared_task_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.evermore_set_shared_task_updated_at() from public, anon, authenticated;
drop trigger if exists shared_tasks_updated_at on public.shared_tasks;
create trigger shared_tasks_updated_at
  before update on public.shared_tasks
  for each row execute function public.evermore_set_shared_task_updated_at();

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'shared_tasks'
  ) then
    execute 'alter publication supabase_realtime add table public.shared_tasks';
  end if;
end;
$block$;
