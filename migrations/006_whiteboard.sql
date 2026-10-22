-- One shared whiteboard per paired space, with append-only persisted operations.
alter table public.whiteboards enable row level security;
alter table public.whiteboard_operations enable row level security;

revoke all privileges on table public.whiteboards, public.whiteboard_operations
  from anon, public, authenticated;
grant select on table public.whiteboards to authenticated;
grant select on table public.whiteboard_operations to authenticated;
grant insert (board_id, op, author) on table public.whiteboard_operations to authenticated;

create index if not exists whiteboard_operations_board_created_idx
  on public.whiteboard_operations(board_id, created_at, id);

drop policy if exists wb_select_member on public.whiteboards;
drop policy if exists wb_insert_member on public.whiteboards;
drop policy if exists wb_update_owner on public.whiteboards;
drop policy if exists whiteboards_select_member on public.whiteboards;
create policy whiteboards_select_member
  on public.whiteboards for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

drop policy if exists wbops_select_member on public.whiteboard_operations;
drop policy if exists wbops_insert_member on public.whiteboard_operations;
drop policy if exists whiteboard_operations_select_member on public.whiteboard_operations;
drop policy if exists whiteboard_operations_insert_member on public.whiteboard_operations;
create policy whiteboard_operations_select_member
  on public.whiteboard_operations for select to authenticated
  using (
    exists (
      select 1 from public.whiteboards as board
       where board.id = board_id
         and public.is_space_member(board.space_id, (select auth.uid()))
    )
  );

create policy whiteboard_operations_insert_member
  on public.whiteboard_operations for insert to authenticated
  with check (
    author = (select auth.uid())
    and pg_catalog.jsonb_typeof(op) = 'object'
    and op ->> 'type' in ('stroke', 'clear')
    and pg_catalog.octet_length(op::text) <= 262144
    and exists (
      select 1 from public.whiteboards as board
       where board.id = board_id
         and public.is_space_member(board.space_id, (select auth.uid()))
    )
  );

create or replace function public.get_or_create_shared_whiteboard()
returns table (board_id uuid, title text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_board_id uuid;
  v_title text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select member.space_id into v_space_id
    from public.space_members as member
   where member.user_id = v_user;
  if not found then raise exception 'Pair your account before opening the whiteboard'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space_id::text, 0));

  select board.id, board.title into v_board_id, v_title
    from public.whiteboards as board
   where board.space_id = v_space_id
   order by board.created_at, board.id
   limit 1;

  if not found then
    insert into public.whiteboards (space_id, title, created_by)
    values (v_space_id, 'Our Whiteboard', v_user)
    returning id, whiteboards.title into v_board_id, v_title;
  end if;

  return query select v_board_id, v_title;
end;
$function$;

revoke all on function public.get_or_create_shared_whiteboard() from public, anon;
grant execute on function public.get_or_create_shared_whiteboard() to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'whiteboard_operations'
  ) then
    execute 'alter publication supabase_realtime add table public.whiteboard_operations';
  end if;
end;
$block$;
