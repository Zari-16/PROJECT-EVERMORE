-- Chat replies and append-only whiteboard undo. Run after 025.
alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null;

create index if not exists messages_reply_to_idx
  on public.messages(reply_to) where reply_to is not null;

grant insert (reply_to) on table public.messages to authenticated;

-- Policies can't query their own table without recursing, so these checks bypass RLS.
create or replace function public.evermore_reply_target_ok(p_reply_to uuid, p_space_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select p_reply_to is null or exists (
    select 1 from public.messages as parent
     where parent.id = p_reply_to and parent.space_id = p_space_id
  );
$function$;

create or replace function public.evermore_can_undo_operation(p_target text, p_board_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1 from public.whiteboard_operations as target
     where target.id::text = p_target
       and target.board_id = p_board_id
       and target.author = (select auth.uid())
       and target.op ->> 'type' <> 'undo'
  );
$function$;

revoke all on function public.evermore_reply_target_ok(uuid, uuid) from public, anon;
revoke all on function public.evermore_can_undo_operation(text, uuid) from public, anon;
grant execute on function public.evermore_reply_target_ok(uuid, uuid) to authenticated;
grant execute on function public.evermore_can_undo_operation(text, uuid) to authenticated;

drop policy if exists messages_insert_paired_space on public.messages;
create policy messages_insert_paired_space
  on public.messages for insert to authenticated
  with check (
    author = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and content is not null
    and pg_catalog.char_length(pg_catalog.btrim(content)) between 1 and 4000
    and deleted = false
    and edited_at is null
    and public.evermore_reply_target_ok(reply_to, space_id)
  );

-- A reply to the recipient's own message gets a distinct alert title.
create or replace function public.evermore_notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.evermore_notifications(space_id, user_id, notification_type, entity_id, title, body)
  select new.space_id, member.user_id, 'chat_message', new.id,
         case when parent.author = member.user_id then 'Replied to your message' else 'New chat message' end,
         pg_catalog.left(coalesce(new.content, ''), 160)
    from public.space_members as member
    left join public.messages as parent on parent.id = new.reply_to
   where member.space_id = new.space_id and member.user_id <> new.author;
  return new;
end;
$function$;

revoke all on function public.evermore_notify_chat_message() from public, anon, authenticated;

-- Undo is an appended operation that points at one of the author's own earlier operations.
drop policy if exists whiteboard_operations_insert_member on public.whiteboard_operations;
create policy whiteboard_operations_insert_member
  on public.whiteboard_operations for insert to authenticated
  with check (
    author = (select auth.uid())
    and pg_catalog.jsonb_typeof(op) = 'object'
    and op ->> 'type' in ('stroke', 'erase', 'clear', 'undo')
    and pg_catalog.octet_length(op::text) <= 262144
    and exists (
      select 1 from public.whiteboards as board
       where board.id = board_id
         and public.is_space_member(board.space_id, (select auth.uid()))
    )
    and (
      op ->> 'type' <> 'undo'
      or public.evermore_can_undo_operation(op ->> 'target', board_id)
    )
  );
