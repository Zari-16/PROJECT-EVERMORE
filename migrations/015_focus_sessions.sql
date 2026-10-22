-- Shared focus timer sessions with database-authoritative start and pause state.
create table if not exists public.focus_sessions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  title text not null default 'Focus session' check (pg_catalog.char_length(pg_catalog.btrim(title)) between 1 and 120),
  session_type text not null check (session_type in ('focus', 'short_break', 'long_break')),
  duration_seconds integer not null check (duration_seconds between 60 and 10800),
  status text not null default 'running' check (status in ('running', 'paused', 'completed', 'cancelled')),
  started_at timestamptz not null default now(),
  paused_at timestamptz,
  paused_seconds integer not null default 0 check (paused_seconds >= 0),
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'paused' and paused_at is not null) or (status <> 'paused' and paused_at is null))
);

create unique index if not exists focus_sessions_one_active_per_space_idx
  on public.focus_sessions(space_id) where status in ('running', 'paused');
create index if not exists focus_sessions_space_created_idx
  on public.focus_sessions(space_id, created_at desc);

alter table public.focus_sessions enable row level security;
revoke all privileges on table public.focus_sessions from anon, public, authenticated;
grant select on table public.focus_sessions to authenticated;

create policy focus_sessions_select_member
  on public.focus_sessions for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create or replace function public.start_focus_session(
  p_title text,
  p_session_type text,
  p_duration_minutes integer
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_session_id uuid;
  v_max_minutes integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_session_type not in ('focus', 'short_break', 'long_break') then
    raise exception 'Invalid focus session type';
  end if;
  v_max_minutes := case when p_session_type = 'focus' then 180 else 60 end;
  if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > v_max_minutes then
    raise exception 'Duration must be between 1 and % minutes', v_max_minutes;
  end if;
  if p_title is null or pg_catalog.char_length(pg_catalog.btrim(p_title)) not between 1 and 120 then
    raise exception 'Title must contain 1 to 120 characters';
  end if;

  select member.space_id into v_space_id
    from public.space_members as member
   where member.user_id = v_user;
  if not found then raise exception 'Pair your account before starting a focus session'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space_id::text, 1));
  if exists (
    select 1 from public.focus_sessions as active_session
     where active_session.space_id = v_space_id
       and active_session.status in ('running', 'paused')
  ) then
    raise exception 'A focus session is already active';
  end if;

  insert into public.focus_sessions (space_id, created_by, title, session_type, duration_seconds)
  values (v_space_id, v_user, pg_catalog.btrim(p_title), p_session_type, p_duration_minutes * 60)
  returning id into v_session_id;

  return v_session_id;
end;
$function$;

create or replace function public.pause_focus_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.focus_sessions as session
     set status = 'paused', paused_at = now()
   where session.id = p_session_id
     and session.status = 'running'
     and public.is_space_member(session.space_id, auth.uid());
  if not found then raise exception 'Focus session is not running or is not in your space'; end if;
end;
$function$;

create or replace function public.resume_focus_session(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.focus_sessions as session
     set status = 'running',
       paused_seconds = session.paused_seconds + GREATEST(0, EXTRACT(epoch from (now() - session.paused_at))::integer),
         paused_at = null
   where session.id = p_session_id
     and session.status = 'paused'
     and public.is_space_member(session.space_id, auth.uid());
  if not found then raise exception 'Focus session is not paused or is not in your space'; end if;
end;
$function$;

create or replace function public.finish_focus_session(p_session_id uuid, p_cancel boolean default false)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  update public.focus_sessions as session
     set status = case when p_cancel then 'cancelled' else 'completed' end,
         ended_at = now(),
         paused_seconds = session.paused_seconds + case
           when session.paused_at is not null
             then greatest(0, extract(epoch from (now() - session.paused_at))::integer)
           else 0
         end,
         paused_at = null
   where session.id = p_session_id
     and session.status in ('running', 'paused')
     and public.is_space_member(session.space_id, auth.uid());
  if not found then raise exception 'Focus session is no longer active or is not in your space'; end if;
end;
$function$;

create or replace function public.get_focus_room_state()
returns table (
  session_id uuid,
  space_id uuid,
  title text,
  session_type text,
  duration_seconds integer,
  status text,
  started_at timestamptz,
  paused_at timestamptz,
  paused_seconds integer,
  ended_at timestamptz,
  created_at timestamptz,
  server_now timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select member.space_id into v_space_id
    from public.space_members as member
   where member.user_id = v_user;
  if not found then raise exception 'Pair your account before opening the focus room'; end if;

  update public.focus_sessions as session
     set status = 'completed',
         ended_at = session.started_at + ((session.duration_seconds + session.paused_seconds) * interval '1 second')
   where session.space_id = v_space_id
     and session.status = 'running'
     and session.started_at + ((session.duration_seconds + session.paused_seconds) * interval '1 second') <= now();

  return query
    select session.id, session.space_id, session.title, session.session_type,
           session.duration_seconds, session.status, session.started_at,
           session.paused_at, session.paused_seconds, session.ended_at,
           session.created_at, now()
      from public.focus_sessions as session
     where session.space_id = v_space_id
     order by session.created_at desc
     limit 20;
end;
$function$;

revoke all on function public.start_focus_session(text, text, integer) from public, anon;
revoke all on function public.pause_focus_session(uuid) from public, anon;
revoke all on function public.resume_focus_session(uuid) from public, anon;
revoke all on function public.finish_focus_session(uuid, boolean) from public, anon;
revoke all on function public.get_focus_room_state() from public, anon;
grant execute on function public.start_focus_session(text, text, integer) to authenticated;
grant execute on function public.pause_focus_session(uuid) to authenticated;
grant execute on function public.resume_focus_session(uuid) to authenticated;
grant execute on function public.finish_focus_session(uuid, boolean) to authenticated;
grant execute on function public.get_focus_room_state() to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'focus_sessions'
  ) then
    execute 'alter publication supabase_realtime add table public.focus_sessions';
  end if;
end;
$block$;
