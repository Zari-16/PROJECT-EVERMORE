-- Final interaction, reminder, attachment, and whiteboard-history features.

alter table public.calendar_events
  add column if not exists recurrence text not null default 'none',
  add column if not exists recurrence_until date,
  add column if not exists reminder_minutes integer;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.calendar_events'::regclass and conname = 'calendar_events_recurrence_check') then
    alter table public.calendar_events add constraint calendar_events_recurrence_check
      check (recurrence in ('none', 'daily', 'weekly', 'monthly', 'yearly'));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.calendar_events'::regclass and conname = 'calendar_events_reminder_check') then
    alter table public.calendar_events add constraint calendar_events_reminder_check
      check (reminder_minutes is null or reminder_minutes in (0, 5, 10, 15, 30, 60, 1440));
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid = 'public.calendar_events'::regclass and conname = 'calendar_events_recurrence_until_check') then
    alter table public.calendar_events add constraint calendar_events_recurrence_until_check
      check (recurrence_until is null or recurrence_until >= starts_at::date);
  end if;
end;
$block$;

grant insert (recurrence, recurrence_until, reminder_minutes) on table public.calendar_events to authenticated;
grant update (recurrence, recurrence_until, reminder_minutes) on table public.calendar_events to authenticated;

create table if not exists public.message_reactions (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('heart', 'laugh', 'support', 'wow')),
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, reaction)
);

create table if not exists public.chat_read_state (
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (space_id, user_id)
);

create table if not exists public.evermore_notifications (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null check (notification_type in ('chat_message', 'calendar_event')),
  entity_id uuid not null,
  title text not null check (pg_catalog.char_length(title) between 1 and 160),
  body text not null default '' check (pg_catalog.char_length(body) <= 500),
  created_at timestamptz not null default now(),
  read_at timestamptz
);

create index if not exists evermore_notifications_user_unread_idx
  on public.evermore_notifications(user_id, created_at desc) where read_at is null;

create table if not exists public.question_answer_comments (
  id uuid primary key default gen_random_uuid(),
  answer_id uuid not null references public.question_answers(id) on delete cascade,
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  question_date date not null,
  answer_author uuid not null references auth.users(id) on delete cascade,
  author uuid not null references auth.users(id) on delete cascade,
  comment text not null check (pg_catalog.char_length(pg_catalog.btrim(comment)) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index if not exists question_answer_comments_answer_created_idx
  on public.question_answer_comments(answer_id, created_at);

create table if not exists public.question_answer_reactions (
  answer_id uuid not null references public.question_answers(id) on delete cascade,
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  question_date date not null,
  answer_author uuid not null references auth.users(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  reaction text not null check (reaction in ('heart', 'laugh', 'support', 'wow')),
  created_at timestamptz not null default now(),
  primary key (answer_id, user_id)
);

create table if not exists public.memory_attachments (
  id uuid primary key default gen_random_uuid(),
  memory_id uuid not null references public.memories(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  storage_path text not null unique,
  file_name text not null check (pg_catalog.char_length(file_name) between 1 and 240),
  mime_type text not null,
  file_size integer not null check (file_size between 1 and 10485760),
  created_at timestamptz not null default now()
);

create index if not exists memory_attachments_memory_idx on public.memory_attachments(memory_id, created_at);

create table if not exists public.whiteboard_operation_controls (
  target_operation_id uuid primary key references public.whiteboard_operations(id) on delete cascade,
  board_id uuid not null references public.whiteboards(id) on delete cascade,
  is_undone boolean not null default true,
  updated_by uuid not null references auth.users(id) on delete cascade,
  updated_at timestamptz not null default now()
);

create index if not exists whiteboard_operation_controls_board_idx
  on public.whiteboard_operation_controls(board_id, is_undone, updated_at desc);

alter table public.message_reactions enable row level security;
alter table public.chat_read_state enable row level security;
alter table public.evermore_notifications enable row level security;
alter table public.question_answer_comments enable row level security;
alter table public.question_answer_reactions enable row level security;
alter table public.memory_attachments enable row level security;
alter table public.whiteboard_operation_controls enable row level security;

revoke all privileges on table public.message_reactions, public.chat_read_state,
  public.evermore_notifications, public.question_answer_comments,
  public.question_answer_reactions, public.memory_attachments,
  public.whiteboard_operation_controls from anon, public, authenticated;
grant select, insert, delete on table public.message_reactions to authenticated;
grant select, insert, update (last_read_at) on table public.chat_read_state to authenticated;
grant select, update (read_at) on table public.evermore_notifications to authenticated;
grant select, insert on table public.question_answer_comments to authenticated;
grant select, insert, delete on table public.question_answer_reactions to authenticated;
grant select, insert, delete on table public.memory_attachments to authenticated;
grant select on table public.whiteboard_operation_controls to authenticated;

create policy message_reactions_select_member on public.message_reactions for select to authenticated
  using (exists (select 1 from public.messages as message where message.id = message_id and public.is_space_member(message.space_id, (select auth.uid()))));
create policy message_reactions_insert_self on public.message_reactions for insert to authenticated
  with check (user_id = (select auth.uid()) and exists (select 1 from public.messages as message where message.id = message_id and not message.deleted and public.is_space_member(message.space_id, (select auth.uid()))));
create policy message_reactions_delete_self on public.message_reactions for delete to authenticated
  using (user_id = (select auth.uid()) and exists (select 1 from public.messages as message where message.id = message_id and public.is_space_member(message.space_id, (select auth.uid()))));

create policy chat_read_state_select_self on public.chat_read_state for select to authenticated
  using (user_id = (select auth.uid()) and public.is_space_member(space_id, (select auth.uid())));
create policy chat_read_state_insert_self on public.chat_read_state for insert to authenticated
  with check (user_id = (select auth.uid()) and public.is_space_member(space_id, (select auth.uid())));
create policy chat_read_state_update_self on public.chat_read_state for update to authenticated
  using (user_id = (select auth.uid()) and public.is_space_member(space_id, (select auth.uid())))
  with check (user_id = (select auth.uid()) and public.is_space_member(space_id, (select auth.uid())));

create policy evermore_notifications_select_self on public.evermore_notifications for select to authenticated
  using (user_id = (select auth.uid()));
create policy evermore_notifications_update_self on public.evermore_notifications for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists evermore_chat_broadcast_select on realtime.messages;
create policy evermore_chat_broadcast_select on realtime.messages for select to authenticated
  using (
    realtime.topic() like 'messages:%'
    and exists (
      select 1 from public.space_members as member
       where member.space_id::text = pg_catalog.split_part(realtime.topic(), ':', 2)
         and member.user_id = (select auth.uid())
    )
  );
drop policy if exists evermore_chat_broadcast_insert on realtime.messages;
create policy evermore_chat_broadcast_insert on realtime.messages for insert to authenticated
  with check (
    realtime.topic() like 'messages:%'
    and exists (
      select 1 from public.space_members as member
       where member.space_id::text = pg_catalog.split_part(realtime.topic(), ':', 2)
         and member.user_id = (select auth.uid())
    )
  );

create policy question_answer_comments_select_visible on public.question_answer_comments for select to authenticated
  using (public.can_read_question_answer(space_id, question_date, answer_author));
create policy question_answer_comments_insert_visible on public.question_answer_comments for insert to authenticated
  with check (
    author = (select auth.uid())
    and pg_catalog.char_length(pg_catalog.btrim(comment)) between 1 and 2000
    and public.can_read_question_answer(space_id, question_date, answer_author)
    and exists (select 1 from public.question_answers as answer where answer.id = question_answer_comments.answer_id and answer.space_id = question_answer_comments.space_id and answer.author = question_answer_comments.answer_author)
  );

create policy question_answer_reactions_select_visible on public.question_answer_reactions for select to authenticated
  using (public.can_read_question_answer(space_id, question_date, answer_author));
create policy question_answer_reactions_insert_self on public.question_answer_reactions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and public.can_read_question_answer(space_id, question_date, answer_author)
    and exists (select 1 from public.question_answers as answer where answer.id = question_answer_reactions.answer_id and answer.space_id = question_answer_reactions.space_id and answer.author = question_answer_reactions.answer_author)
  );
create policy question_answer_reactions_delete_self on public.question_answer_reactions for delete to authenticated
  using (user_id = (select auth.uid()) and public.can_read_question_answer(space_id, question_date, answer_author));

create policy memory_attachments_select_visible on public.memory_attachments for select to authenticated
  using (exists (
    select 1 from public.memories as memory
     where memory.id = memory_attachments.memory_id
       and (memory.created_by = (select auth.uid()) or (memory.visibility = 'shared' and public.is_space_member(memory.space_id, (select auth.uid()))))
  ));
create policy memory_attachments_insert_owner on public.memory_attachments for insert to authenticated
  with check (
    created_by = (select auth.uid())
    and exists (
      select 1 from public.memories as memory
       where memory.id = memory_attachments.memory_id
         and memory.created_by = (select auth.uid())
         and storage_path ~ (
           '^' || case when memory.visibility = 'private' then 'private' else memory.space_id::text end
           || '/' || (select auth.uid())::text || '/memories/[A-Za-z0-9._-]+$'
         )
    )
  );
create policy memory_attachments_delete_owner on public.memory_attachments for delete to authenticated
  using (created_by = (select auth.uid()) and exists (select 1 from public.memories as memory where memory.id = memory_attachments.memory_id and memory.created_by = (select auth.uid())));

create policy whiteboard_operation_controls_select_member on public.whiteboard_operation_controls for select to authenticated
  using (exists (select 1 from public.whiteboards as board where board.id = board_id and public.is_space_member(board.space_id, (select auth.uid()))));

alter table public.messages alter column metadata set default '{}'::jsonb;
grant insert (space_id, author, content, metadata) on table public.messages to authenticated;
drop policy if exists messages_insert_paired_space on public.messages;
create policy messages_insert_paired_space on public.messages for insert to authenticated
  with check (
    author = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and content is not null
    and pg_catalog.char_length(pg_catalog.btrim(content)) between 1 and 4000
    and deleted = false
    and edited_at is null
    and metadata is not null
    and pg_catalog.jsonb_typeof(metadata) = 'object'
    and pg_catalog.octet_length(metadata::text) <= 12000
    and case
      when not (metadata ? 'attachments') then true
      when pg_catalog.jsonb_typeof(metadata->'attachments') <> 'array' then false
      when pg_catalog.jsonb_array_length(metadata->'attachments') > 4 then false
      else not exists (
        select 1
          from pg_catalog.jsonb_array_elements(metadata->'attachments') as item(attachment)
         where pg_catalog.jsonb_typeof(item.attachment) <> 'object'
            or pg_catalog.jsonb_typeof(item.attachment->'path') is distinct from 'string'
            or (item.attachment->>'path') !~ ('^' || space_id::text || '/' || (select auth.uid())::text || '/chat/[A-Za-z0-9._-]+$')
            or pg_catalog.jsonb_typeof(item.attachment->'file_name') is distinct from 'string'
            or pg_catalog.char_length(item.attachment->>'file_name') not between 1 and 240
            or pg_catalog.jsonb_typeof(item.attachment->'mime_type') is distinct from 'string'
            or item.attachment->>'mime_type' not in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain')
            or case
              when pg_catalog.jsonb_typeof(item.attachment->'file_size') is distinct from 'number' then true
              when (item.attachment->>'file_size') !~ '^[0-9]+$' then true
              else (item.attachment->>'file_size')::integer not between 1 and 10485760
            end
      )
    end
  );

create or replace function public.mark_chat_read(p_space_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if not public.is_space_member(p_space_id, auth.uid()) then raise exception 'Not a member of this space'; end if;
  insert into public.chat_read_state (space_id, user_id, last_read_at) values (p_space_id, auth.uid(), now())
  on conflict (space_id, user_id) do update set last_read_at = excluded.last_read_at;
end;
$function$;

create or replace function public.get_chat_unread_count(p_space_id uuid)
returns bigint
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare v_user uuid := auth.uid(); v_last_read timestamptz;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not public.is_space_member(p_space_id, v_user) then raise exception 'Not a member of this space'; end if;
  select state.last_read_at into v_last_read from public.chat_read_state as state where state.space_id = p_space_id and state.user_id = v_user;
  return (select count(*) from public.messages as message where message.space_id = p_space_id and message.author <> v_user and not message.deleted and message.created_at > coalesce(v_last_read, '-infinity'::timestamptz));
end;
$function$;

create or replace function public.toggle_question_answer_reaction(p_answer_id uuid, p_reaction text)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid := auth.uid(); v_answer public.question_answers%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_reaction not in ('heart', 'laugh', 'support', 'wow') then raise exception 'Invalid reaction'; end if;
  select answer.* into v_answer from public.question_answers as answer where answer.id = p_answer_id;
  if not found or not public.can_read_question_answer(v_answer.space_id, v_answer.question_date, v_answer.author) then raise exception 'Answer is not visible'; end if;
  if exists (
    select 1 from public.question_answer_reactions as reaction
     where reaction.answer_id = p_answer_id and reaction.user_id = v_user and reaction.reaction = p_reaction
  ) then
    delete from public.question_answer_reactions where answer_id = p_answer_id and user_id = v_user;
    return;
  end if;
  delete from public.question_answer_reactions where answer_id = p_answer_id and user_id = v_user;
  insert into public.question_answer_reactions(answer_id, space_id, question_date, answer_author, user_id, reaction)
  values (p_answer_id, v_answer.space_id, v_answer.question_date, v_answer.author, v_user, p_reaction);
exception when unique_violation then
  return;
end;
$function$;

create or replace function public.toggle_whiteboard_operation(p_board_id uuid, p_redo boolean default false)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare v_user uuid := auth.uid(); v_target uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists (select 1 from public.whiteboards as board where board.id = p_board_id and public.is_space_member(board.space_id, v_user)) then raise exception 'Board is not in your space'; end if;
  if p_redo then
    select control.target_operation_id into v_target from public.whiteboard_operation_controls as control
     where control.board_id = p_board_id and control.is_undone order by control.updated_at desc limit 1;
    if v_target is null then raise exception 'Nothing to redo'; end if;
    update public.whiteboard_operation_controls set is_undone = false, updated_by = v_user, updated_at = now() where target_operation_id = v_target;
  else
    select operation.id into v_target from public.whiteboard_operations as operation
     where operation.board_id = p_board_id and operation.op->>'type' in ('stroke', 'erase', 'clear')
       and not exists (select 1 from public.whiteboard_operation_controls as control where control.target_operation_id = operation.id and control.is_undone)
     order by operation.created_at desc, operation.id desc limit 1;
    if v_target is null then raise exception 'Nothing to undo'; end if;
    insert into public.whiteboard_operation_controls(target_operation_id, board_id, is_undone, updated_by)
    values (v_target, p_board_id, true, v_user)
    on conflict (target_operation_id) do update set is_undone = true, updated_by = v_user, updated_at = now();
  end if;
  return v_target;
end;
$function$;

create or replace function public.evermore_notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.evermore_notifications(space_id, user_id, notification_type, entity_id, title, body)
  select new.space_id, member.user_id, 'chat_message', new.id, 'New chat message', pg_catalog.left(coalesce(new.content, ''), 160)
    from public.space_members as member where member.space_id = new.space_id and member.user_id <> new.author
  on conflict do nothing;
  return new;
end;
$function$;

create or replace function public.evermore_notify_calendar_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.visibility = 'shared' then
    insert into public.evermore_notifications(space_id, user_id, notification_type, entity_id, title, body)
    select new.space_id, member.user_id, 'calendar_event', new.id, 'Shared calendar event', new.title
      from public.space_members as member where member.space_id = new.space_id and member.user_id <> new.created_by
    on conflict do nothing;
  end if;
  return new;
end;
$function$;

create or replace function public.evermore_clear_whiteboard_redo()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.op->>'type' in ('stroke', 'erase', 'clear') then
    delete from public.whiteboard_operation_controls where board_id = new.board_id and is_undone;
  end if;
  return new;
end;
$function$;

create trigger evermore_messages_notify after insert on public.messages
for each row when (new.deleted = false) execute function public.evermore_notify_chat_message();
create trigger evermore_calendar_notify after insert on public.calendar_events
for each row execute function public.evermore_notify_calendar_event();
create trigger evermore_whiteboard_clear_redo after insert on public.whiteboard_operations
for each row execute function public.evermore_clear_whiteboard_redo();

revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.get_chat_unread_count(uuid) from public, anon;
revoke all on function public.toggle_question_answer_reaction(uuid, text) from public, anon;
revoke all on function public.toggle_whiteboard_operation(uuid, boolean) from public, anon;
revoke all on function public.evermore_notify_chat_message() from public, anon, authenticated;
revoke all on function public.evermore_notify_calendar_event() from public, anon, authenticated;
revoke all on function public.evermore_clear_whiteboard_redo() from public, anon, authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.get_chat_unread_count(uuid) to authenticated;
grant execute on function public.toggle_question_answer_reaction(uuid, text) to authenticated;
grant execute on function public.toggle_whiteboard_operation(uuid, boolean) to authenticated;

do $block$
declare v_table text;
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then raise exception 'Supabase Realtime publication supabase_realtime does not exist'; end if;
  foreach v_table in array array['message_reactions','chat_read_state','evermore_notifications','question_answer_comments','question_answer_reactions','memory_attachments','whiteboard_operation_controls'] loop
    if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = v_table) then
      execute pg_catalog.format('alter publication supabase_realtime add table public.%I', v_table);
    end if;
  end loop;
end;
$block$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evermore-private', 'evermore-private', false, 10485760,
  array['image/jpeg','image/png','image/webp','application/pdf','text/plain']::text[])
on conflict (id) do update set public = false, file_size_limit = 10485760,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists evermore_private_files_select on storage.objects;
drop policy if exists evermore_private_files_insert on storage.objects;
drop policy if exists evermore_private_files_delete on storage.objects;
create policy evermore_private_files_select on storage.objects for select to authenticated
  using (bucket_id = 'evermore-private' and (
    ((storage.foldername(name))[1] = 'private' and (storage.foldername(name))[2] = (select auth.uid())::text)
    or exists (select 1 from public.space_members as member where member.space_id::text = (storage.foldername(name))[1] and member.user_id = (select auth.uid()))
  ));
create policy evermore_private_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'evermore-private' and (storage.foldername(name))[2] = (select auth.uid())::text and (
    (storage.foldername(name))[1] = 'private'
    or exists (select 1 from public.space_members as member where member.space_id::text = (storage.foldername(name))[1] and member.user_id = (select auth.uid()))
  ));
create policy evermore_private_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'evermore-private' and (storage.foldername(name))[2] = (select auth.uid())::text and (
    (storage.foldername(name))[1] = 'private'
    or exists (select 1 from public.space_members as member where member.space_id::text = (storage.foldername(name))[1] and member.user_id = (select auth.uid()))
  ));

revoke all on function public.evermore_notify_chat_message() from public, anon, authenticated;
revoke all on function public.evermore_notify_calendar_event() from public, anon, authenticated;
revoke all on function public.evermore_clear_whiteboard_redo() from public, anon, authenticated;

create or replace function public.get_memory_attachments(p_memory_ids uuid[])
returns table (id uuid, memory_id uuid, storage_path text, file_name text, mime_type text, file_size integer, created_by uuid, created_at timestamptz)
language plpgsql stable security definer set search_path = '' as $function$
declare v_user uuid := auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  return query select attachment.id, attachment.memory_id, attachment.storage_path, attachment.file_name, attachment.mime_type, attachment.file_size, attachment.created_by, attachment.created_at
    from public.memory_attachments as attachment join public.memories as memory on memory.id = attachment.memory_id
   where attachment.memory_id = any(p_memory_ids)
     and (memory.created_by = v_user or (memory.visibility = 'shared' and public.is_space_member(memory.space_id, v_user)))
   order by attachment.created_at;
end;
$function$;

create or replace function public.get_question_history(p_limit integer default 365)
returns table (question_date date, prompt text, category text, answer_id uuid, answer text, visibility text, author uuid)
language plpgsql stable security definer set search_path = '' as $function$
declare v_user uuid := auth.uid(); v_space uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_limit is null or p_limit not between 1 and 2557 then raise exception 'History limit must be 1-2557'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account to open question history'; end if;
  return query select daily.question_date, bank.prompt, bank.category, answer.id, answer.answer, answer.visibility, answer.author
    from public.daily_questions as daily join public.question_bank as bank on bank.id = daily.question_id
    left join public.question_answers as answer
      on answer.space_id = daily.space_id
     and answer.question_date = daily.question_date
     and public.can_read_question_answer(answer.space_id, answer.question_date, answer.author)
   where daily.space_id = v_space and exists (select 1 from public.question_answers as own where own.space_id = v_space and own.question_date = daily.question_date and own.author = v_user)
   order by daily.question_date desc limit p_limit;
end;
$function$;
revoke all on function public.toggle_question_answer_reaction(uuid, text) from public, anon;
revoke all on function public.toggle_whiteboard_operation(uuid, boolean) from public, anon;
revoke all on function public.mark_chat_read(uuid) from public, anon;
revoke all on function public.get_chat_unread_count(uuid) from public, anon;
revoke all on function public.get_memory_attachments(uuid[]) from public, anon;
revoke all on function public.get_question_history(integer) from public, anon;
grant execute on function public.toggle_question_answer_reaction(uuid, text) to authenticated;
grant execute on function public.toggle_whiteboard_operation(uuid, boolean) to authenticated;
grant execute on function public.mark_chat_read(uuid) to authenticated;
grant execute on function public.get_chat_unread_count(uuid) to authenticated;
grant execute on function public.get_memory_attachments(uuid[]) to authenticated;
grant execute on function public.get_question_history(integer) to authenticated;
EOF