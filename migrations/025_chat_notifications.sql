-- Per-user in-app alerts for paired chat messages and shared calendar events.
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

alter table public.evermore_notifications enable row level security;
revoke all privileges on table public.evermore_notifications from anon, public, authenticated;
grant select, update (read_at) on table public.evermore_notifications to authenticated;

drop policy if exists evermore_notifications_select_self on public.evermore_notifications;
create policy evermore_notifications_select_self
  on public.evermore_notifications for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists evermore_notifications_update_self on public.evermore_notifications;
create policy evermore_notifications_update_self
  on public.evermore_notifications for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create or replace function public.evermore_notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  insert into public.evermore_notifications(space_id, user_id, notification_type, entity_id, title, body)
  select new.space_id, member.user_id, 'chat_message', new.id,
         'New chat message', pg_catalog.left(coalesce(new.content, ''), 160)
    from public.space_members as member
   where member.space_id = new.space_id and member.user_id <> new.author;
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
    select new.space_id, member.user_id, 'calendar_event', new.id,
           'Shared calendar event', new.title
      from public.space_members as member
     where member.space_id = new.space_id and member.user_id <> new.created_by;
  end if;
  return new;
end;
$function$;

revoke all on function public.evermore_notify_chat_message() from public, anon, authenticated;
revoke all on function public.evermore_notify_calendar_event() from public, anon, authenticated;

drop trigger if exists evermore_messages_notify on public.messages;
create trigger evermore_messages_notify
  after insert on public.messages
  for each row when (new.deleted = false)
  execute function public.evermore_notify_chat_message();

drop trigger if exists evermore_calendar_notify on public.calendar_events;
create trigger evermore_calendar_notify
  after insert on public.calendar_events
  for each row execute function public.evermore_notify_calendar_event();

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'evermore_notifications'
  ) then
    execute 'alter publication supabase_realtime add table public.evermore_notifications';
  end if;
end;
$block$;