-- Allow eraser strokes while preserving the paired-member insert boundary.
drop policy if exists whiteboard_operations_insert_member on public.whiteboard_operations;
create policy whiteboard_operations_insert_member
  on public.whiteboard_operations for insert to authenticated
  with check (
    author = (select auth.uid())
    and pg_catalog.jsonb_typeof(op) = 'object'
    and op ->> 'type' in ('stroke', 'erase', 'clear')
    and pg_catalog.octet_length(op::text) <= 262144
    and exists (
      select 1 from public.whiteboards as board
       where board.id = board_id
         and public.is_space_member(board.space_id, (select auth.uid()))
    )
  );