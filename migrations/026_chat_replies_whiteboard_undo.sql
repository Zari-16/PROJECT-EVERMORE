-- Chat replies and append-only whiteboard undo. Run after 025.
alter table public.messages
  add column if not exists reply_to uuid references public.messages(id) on delete set null;

create index if not exists messages_reply_to_idx
  on public.messages(reply_to) where reply_to is not null;

grant insert (reply_to) on table public.messages to authenticated;

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
    and (
      messages.reply_to is null
      or exists (
        select 1 from public.messages as parent
         where parent.id = messages.reply_to
           and parent.space_id = messages.space_id
      )
    )
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
      or exists (
        select 1 from public.whiteboard_operations as target
         where target.id::text = whiteboard_operations.op ->> 'target'
           and target.board_id = whiteboard_operations.board_id
           and target.author = (select auth.uid())
           and target.op ->> 'type' <> 'undo'
      )
    )
  );
