-- Shared daily questions with database-enforced answer visibility.
create table if not exists public.question_bank (
  id uuid primary key default gen_random_uuid(),
  prompt text not null unique,
  category text not null,
  enabled boolean not null default true,
  created_at timestamptz not null default now()
);

insert into public.question_bank (prompt, category) values
  ('What is a tiny thing that always makes your day better?', 'Lighthearted'),
  ('If we could visit any fantasy kingdom for a weekend, where would we go?', 'Imaginative'),
  ('What memory of us makes you smile when you think about it?', 'Memories'),
  ('What is one experience you would love for us to share someday?', 'Future'),
  ('What would our dream home feel like on an ordinary evening?', 'Future'),
  ('What is something you wish people understood about you?', 'Deep conversation'),
  ('What is your favourite way to unwind after a difficult day?', 'Support'),
  ('If we had a free day with no plans, how would you want to spend it?', 'Date ideas'),
  ('What song brings back a strong memory for you?', 'Memories'),
  ('What is a skill you would enjoy learning together?', 'Learning'),
  ('What fictional world would you invite me to explore with you?', 'Imaginative'),
  ('What small act of kindness means the most to you?', 'Affection'),
  ('What food would you choose for our perfect picnic?', 'Favourite things'),
  ('What is something new you would like us to try this year?', 'Future'),
  ('When do you feel most listened to?', 'Communication'),
  ('What was a favourite game or activity from your childhood?', 'Childhood'),
  ('If we could keep one tradition forever, what should it be?', 'Values'),
  ('What place nearby would you like to explore together?', 'Date ideas'),
  ('What is one thing you are proud of from this week?', 'Encouragement'),
  ('If we were a team on a quest, what would each of our strengths be?', 'Imaginative'),
  ('What helps you feel cared for when you are stressed?', 'Support'),
  ('What ordinary moment would you like to have more often?', 'Affection'),
  ('What is a funny misunderstanding you remember from growing up?', 'Funny'),
  ('What is one goal you would like me to cheer you on with?', 'Encouragement'),
  ('What would make our next date feel special to you?', 'Date ideas')
on conflict (prompt) do nothing;

create table if not exists public.daily_questions (
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  question_date date not null,
  question_id uuid not null references public.question_bank(id),
  created_at timestamptz not null default now(),
  primary key (space_id, question_date)
);

create table if not exists public.question_answers (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null,
  question_date date not null,
  author uuid not null references auth.users(id) on delete cascade,
  answer text not null check (pg_catalog.char_length(pg_catalog.btrim(answer)) between 1 and 5000),
  visibility text not null default 'private' check (visibility in ('private', 'shared', 'after_both')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, question_date, author),
  foreign key (space_id, question_date)
    references public.daily_questions(space_id, question_date) on delete cascade
);

create index if not exists question_answers_space_date_idx
  on public.question_answers(space_id, question_date);

alter table public.question_bank enable row level security;
alter table public.daily_questions enable row level security;
alter table public.question_answers enable row level security;
revoke all privileges on table public.question_bank, public.daily_questions, public.question_answers
  from anon, public, authenticated;
grant select on table public.question_answers to authenticated;
grant insert (space_id, question_date, author, answer, visibility)
  on table public.question_answers to authenticated;
grant update (answer, visibility) on table public.question_answers to authenticated;

create or replace function public.can_read_question_answer(p_space_id uuid, p_date date, p_author uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_visibility text;
begin
  if v_user is null then return false; end if;
  if p_author = v_user then return true; end if;
  if not public.evermore_users_share_space(p_author, v_user) then return false; end if;

  select answer.visibility into v_visibility
    from public.question_answers as answer
   where answer.space_id = p_space_id
     and answer.question_date = p_date
     and answer.author = p_author;
  if not found then return false; end if;
  if v_visibility = 'shared' then return true; end if;
  if v_visibility <> 'after_both' then return false; end if;

  return exists (
    select 1 from public.question_answers as own_answer
     where own_answer.space_id = p_space_id
       and own_answer.question_date = p_date
       and own_answer.author = v_user
  );
end;
$function$;

revoke all on function public.can_read_question_answer(uuid, date, uuid) from public, anon;
grant execute on function public.can_read_question_answer(uuid, date, uuid) to authenticated;

create policy question_answers_select_visible
  on public.question_answers for select to authenticated
  using (public.can_read_question_answer(space_id, question_date, author));

create policy question_answers_insert_own
  on public.question_answers for insert to authenticated
  with check (
    author = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and answer is not null
    and pg_catalog.char_length(pg_catalog.btrim(answer)) between 1 and 5000
    and visibility in ('private', 'shared', 'after_both')
  );

create policy question_answers_update_own
  on public.question_answers for update to authenticated
  using (author = (select auth.uid()) and public.is_space_member(space_id, (select auth.uid())))
  with check (
    author = (select auth.uid())
    and public.is_space_member(space_id, (select auth.uid()))
    and pg_catalog.char_length(pg_catalog.btrim(answer)) between 1 and 5000
    and visibility in ('private', 'shared', 'after_both')
  );

create or replace function public.evermore_set_question_answer_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.evermore_set_question_answer_updated_at() from public, anon, authenticated;
drop trigger if exists question_answers_updated_at on public.question_answers;
create trigger question_answers_updated_at
  before update on public.question_answers
  for each row execute function public.evermore_set_question_answer_updated_at();

create or replace function public.get_today_question()
returns table (question_date date, question_id uuid, prompt text, category text)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_today date := pg_catalog.timezone('UTC', now())::date;
  v_count bigint;
  v_offset bigint;
  v_question_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select member.space_id into v_space_id
    from public.space_members as member
   where member.user_id = v_user;
  if not found then raise exception 'Pair your account before opening daily questions'; end if;

  select count(*) into v_count from public.question_bank where enabled;
  if v_count = 0 then raise exception 'No enabled questions are available'; end if;

  v_offset := pg_catalog.mod(
    pg_catalog.hashtextextended(v_space_id::text || ':' || v_today::text, 0) & 9223372036854775807,
    v_count
  );

  select bank.id into v_question_id
    from public.question_bank as bank
   where bank.enabled
   order by bank.id
   offset v_offset
   limit 1;

  insert into public.daily_questions (space_id, question_date, question_id)
  values (v_space_id, v_today, v_question_id)
  on conflict (space_id, question_date) do nothing;

  return query
    select daily.question_date, bank.id, bank.prompt, bank.category
      from public.daily_questions as daily
      join public.question_bank as bank on bank.id = daily.question_id
     where daily.space_id = v_space_id and daily.question_date = v_today;
end;
$function$;

revoke all on function public.get_today_question() from public, anon;
grant execute on function public.get_today_question() to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'question_answers'
  ) then
    execute 'alter publication supabase_realtime add table public.question_answers';
  end if;
end;
$block$;
