-- Private two-player Truth or Dare with a server-selected player and prompt.
create table if not exists public.truth_dare_prompts (
  id bigint generated always as identity primary key,
  prompt_type text not null check (prompt_type in ('truth', 'dare')),
  prompt_text text not null,
  unique (prompt_type, prompt_text)
);

create table if not exists public.truth_dare_games (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  game_state jsonb not null,
  status text not null default 'active' check (status in ('active', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists truth_dare_one_active_per_space_idx
  on public.truth_dare_games(space_id) where status = 'active';
create index if not exists truth_dare_games_space_history_idx
  on public.truth_dare_games(space_id, created_at desc);

alter table public.truth_dare_prompts enable row level security;
alter table public.truth_dare_games enable row level security;
revoke all privileges on table public.truth_dare_prompts from anon, public, authenticated;
revoke all privileges on table public.truth_dare_games from anon, public, authenticated;
grant select on table public.truth_dare_games to authenticated;

create policy truth_dare_games_select_member
  on public.truth_dare_games for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

with truth_stems(stem) as (
  select unnest(array[
    'What tiny detail do you appreciate about %s?',
    'Which part of %s makes you smile most?',
    'What is one thing about %s you would happily do again?',
    'What color feels like %s to you, and why?',
    'What is a funny memory connected to %s?',
    'What is one word you would use to describe %s?',
    'What is a small way %s makes an ordinary day better?',
    'What part of %s feels most like us?',
    'What is something new you would like to discover about %s?',
    'What is one thing about %s you hope never changes?',
    'What little tradition could you build around %s?',
    'If %s had a theme song, what would its title be?',
    'What would you tell your past self about %s?',
    'What tiny award would you give %s?',
    'What detail about %s would you put in a museum?',
    'Which emoji best captures %s, and why?',
    'What is something about %s you appreciate more than you say?',
    'What question do you wish you could ask about %s?',
    'What story involving %s should be told more often?',
    'Which season feels most like %s?',
    'What is a playful nickname for %s?',
    'What is one thing you learned from %s?',
    'What is the coziest version of %s you can imagine?',
    'What is one goal you would like to share around %s?',
    'What sound would be the theme for %s?',
    'What part of %s brings out your playful side?',
    'What are you looking forward to about %s?',
    'If %s were a board-game piece, what would it look like?',
    'What small victory connected to %s deserves applause?',
    'What snack would represent %s?',
    'What is one thing about %s you would tell a friend?',
    'What phrase or inside joke is linked to %s?',
    'What do you notice about %s that your partner might not realize?',
    'How could you make more room for %s this week?',
    'What little thing would make %s feel special?',
    'If %s were a fictional place, what would it look like?',
    'What is the silliest award you could give someone for %s?',
    'What would you like to learn together about %s?',
    'What is a happy memory involving %s?',
    'What do you think %s will look like a year from now?',
    'What detail about %s deserves a round of applause?',
    'What does %s remind you to make time for?',
    'Which fictional character would fit %s, and why?',
    'What kind message could you send inspired by %s?',
    'What is your favorite tiny detail of %s?',
    'What would you like to do differently next time involving %s?',
    'What is one way you could make %s more fun?',
    'What do you think your partner enjoys most about %s?',
    'What is one thing about %s you would like to celebrate?',
    'Describe %s in exactly five cheerful words.'
  ]::text[])
), truth_topics(topic) as (
  select unnest(array[
    'your conversations', 'your shared jokes', 'your check-ins', 'your partner''s laugh',
    'your first meeting', 'your favorite meals', 'your little routines', 'your plans for a day together',
    'your music choices', 'your messages', 'your silly debates', 'your favorite memories',
    'your quiet moments', 'your celebrations', 'your weekend plans', 'your favorite places',
    'your future adventures', 'your inside jokes', 'your teamwork', 'your partner''s talents',
    'the way you say hello', 'the way you encourage each other', 'the little wins you share',
    'the stories you tell', 'the things you learn together', 'your comfort shows',
    'your favorite snacks', 'your playful traditions', 'your shared goals', 'your everyday kindness'
  ]::text[])
)
insert into public.truth_dare_prompts (prompt_type, prompt_text)
select 'truth', pg_catalog.format(truth_stems.stem, truth_topics.topic)
  from truth_stems cross join truth_topics
on conflict (prompt_type, prompt_text) do nothing;

with dare_stems(stem) as (
  select unnest(array[
    'Send your partner a one-line compliment containing the word %s.',
    'Describe your day as if it were %s.',
    'Write a dramatic ten-second speech about %s.',
    'Invent a tiny award inspired by %s and give it a title.',
    'Write a two-line poem that includes %s.',
    'Make up a cheerful slogan about %s.',
    'Create a fictional holiday celebrating %s.',
    'Describe %s like a sports commentator in one sentence.',
    'Send a three-emoji review of %s.',
    'Come up with a movie title featuring %s.',
    'Make a six-word story that includes %s.',
    'Send a playful compliment that mentions %s.',
    'Write a weather report for %s in your best announcer voice.',
    'Write a silly headline about %s.',
    'Make up a new nickname inspired by %s.',
    'Pitch %s as the star of a cozy adventure.',
    'Send a haiku inspired by %s.',
    'Describe %s using exactly five words.',
    'Give %s a very serious job title.',
    'Invent a friendly mascot based on %s.',
    'Make a playful prediction about %s.',
    'Write a text message from the point of view of %s.',
    'Turn %s into a made-up superpower.',
    'Invent a two-person challenge inspired by %s; no props needed.',
    'Write a tiny theme-song lyric that includes %s.',
    'Give %s a restaurant-menu description.',
    'Write a one-sentence fairy tale where %s saves the day.',
    'Send your partner a thank-you note that mentions %s.',
    'Describe how %s would introduce itself at a party.',
    'Write a two-line pep talk using %s.',
    'Give %s a dramatic plot twist.',
    'Write a cheerful fortune about %s.',
    'Imagine %s won a prize and announce what it is.',
    'Make a gentle pun involving %s.',
    'Explain why %s deserves a fan club.',
    'Describe %s as a travel destination.',
    'Give %s a new color and invent its name.',
    'Make up a bedtime story featuring %s.',
    'Write a polite complaint from the point of view of %s.',
    'Create a motto for a team named %s.',
    'Write a play-by-play commentary about %s.',
    'Text your partner a lighthearted question inspired by %s.',
    'Invent a tiny museum exhibit about %s.',
    'Describe %s as if it were a legendary hero.',
    'Write a two-line conversation between %s and a snack.',
    'Turn %s into a cheerful holiday greeting.',
    'Write a positive review of %s.',
    'Give %s a one-sentence superhero origin story.',
    'Send a message that makes %s sound extremely important.',
    'Invent a board-game rule involving %s.'
  ]::text[])
), dare_topics(topic) as (
  select unnest(array[
    'acorn', 'balloon', 'bookmark', 'cactus', 'comet', 'compass', 'cupcake', 'dragon',
    'duck', 'fern', 'flashlight', 'frisbee', 'giraffe', 'jellybean', 'kite', 'lighthouse',
    'mailbox', 'marshmallow', 'moonbeam', 'pancake', 'paperclip', 'penguin', 'pillow',
    'pineapple', 'robot', 'teapot', 'turtle', 'umbrella', 'waffle', 'wizard'
  ]::text[])
)
insert into public.truth_dare_prompts (prompt_type, prompt_text)
select 'dare', pg_catalog.format(dare_stems.stem, dare_topics.topic)
  from dare_stems cross join dare_topics
on conflict (prompt_type, prompt_text) do nothing;

do $block$
declare
  v_truth_count integer;
  v_dare_count integer;
begin
  select count(*)::integer into v_truth_count
    from public.truth_dare_prompts where prompt_type = 'truth';
  select count(*)::integer into v_dare_count
    from public.truth_dare_prompts where prompt_type = 'dare';
  if v_truth_count <> 1500 or v_dare_count <> 1500 then
    raise exception 'Expected 1500 prompts of each type; found % truths and % dares', v_truth_count, v_dare_count;
  end if;
end;
$block$;

create or replace function public.start_truth_dare_game()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_players uuid[];
  v_game_id uuid;
  v_state jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select array_agg(member.user_id order by member.joined_at, member.user_id)
    into v_players
    from public.space_members as member where member.space_id = v_space;
  if pg_catalog.array_length(v_players, 1) <> 2 then
    raise exception 'Truth or Dare requires exactly two paired players';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space::text, 4));
  if exists (
    select 1 from public.truth_dare_games as game
     where game.space_id = v_space and game.status = 'active'
  ) then
    raise exception 'A Truth or Dare game is already active';
  end if;

  v_state := pg_catalog.jsonb_build_object(
    'players', pg_catalog.to_jsonb(v_players),
    'phase', 'spin',
    'selected_player', null::text,
    'previous_selected_player', null::text,
    'prompt_type', null::text,
    'prompt_text', null::text,
    'previous_prompt_text', null::text,
    'round_number', 0,
    'last_action', 'The bottle is ready'
  );
  insert into public.truth_dare_games (space_id, created_by, game_state)
  values (v_space, v_user, v_state)
  returning id into v_game_id;
  return v_game_id;
end;
$function$;

create or replace function public.get_truth_dare_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.truth_dare_games%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game from public.truth_dare_games as game
   where game.space_id = v_space and game.status = 'active'
   order by game.created_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'game', case when v_game.id is null then null else
      pg_catalog.jsonb_build_object('id', v_game.id, 'space_id', v_game.space_id,
        'game_state', v_game.game_state, 'status', v_game.status,
        'created_at', v_game.created_at, 'updated_at', v_game.updated_at) end,
    'my_id', v_user
  );
end;
$function$;

create or replace function public.spin_truth_dare_bottle()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.truth_dare_games%rowtype;
  v_state jsonb;
  v_selected uuid;
  v_previous uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  select game.* into v_game from public.truth_dare_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'Start a game before spinning'; end if;

  v_state := v_game.game_state;
  if v_state->>'phase' <> 'spin' then raise exception 'Finish this turn before spinning again'; end if;
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements_text(v_state->'players') as player(user_id)
     where player.user_id = v_user::text
  ) then raise exception 'You are not a player in this game'; end if;

  v_previous := nullif(v_state->>'previous_selected_player', '')::uuid;
  if v_previous = (v_state->'players'->>0)::uuid then
    v_selected := (v_state->'players'->>1)::uuid;
  elsif v_previous = (v_state->'players'->>1)::uuid then
    v_selected := (v_state->'players'->>0)::uuid;
  else
    v_selected := case when random() < 0.5
      then (v_state->'players'->>0)::uuid else (v_state->'players'->>1)::uuid end;
  end if;
  v_state := pg_catalog.jsonb_set(v_state, '{phase}', pg_catalog.to_jsonb('selected'::text), true);
  v_state := pg_catalog.jsonb_set(v_state, '{selected_player}', pg_catalog.to_jsonb(v_selected::text), true);
  v_state := pg_catalog.jsonb_set(v_state, '{previous_selected_player}', pg_catalog.to_jsonb(v_selected::text), true);
  v_state := pg_catalog.jsonb_set(v_state, '{prompt_type}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{prompt_text}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb('The bottle chose a player'::text), true);
  update public.truth_dare_games set game_state = v_state, updated_at = now() where id = v_game.id;
  return v_state;
end;
$function$;

create or replace function public.ready_truth_dare_prompt()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.truth_dare_games%rowtype;
  v_state jsonb;
  v_prompt_type text;
  v_prompt_text text;
  v_round integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  select game.* into v_game from public.truth_dare_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'Start a game before drawing a prompt'; end if;

  v_state := v_game.game_state;
  if v_state->>'phase' <> 'selected' then raise exception 'Spin the bottle first'; end if;
  if v_state->>'selected_player' <> v_user::text then raise exception 'Only the selected player can press Ready'; end if;

  v_prompt_type := case when random() < 0.5 then 'truth' else 'dare' end;
  select prompt.prompt_text into v_prompt_text
    from public.truth_dare_prompts as prompt
   where prompt.prompt_type = v_prompt_type
     and (v_state->>'previous_prompt_text' is null or prompt.prompt_text <> v_state->>'previous_prompt_text')
   order by random() limit 1;
  if not found then raise exception 'The prompt bank is empty'; end if;
  v_round := coalesce((v_state->>'round_number')::integer, 0) + 1;

  v_state := pg_catalog.jsonb_set(v_state, '{phase}', pg_catalog.to_jsonb('drawn'::text), true);
  v_state := pg_catalog.jsonb_set(v_state, '{prompt_type}', pg_catalog.to_jsonb(v_prompt_type), true);
  v_state := pg_catalog.jsonb_set(v_state, '{prompt_text}', pg_catalog.to_jsonb(v_prompt_text), true);
  v_state := pg_catalog.jsonb_set(v_state, '{previous_prompt_text}', pg_catalog.to_jsonb(v_prompt_text), true);
  v_state := pg_catalog.jsonb_set(v_state, '{round_number}', pg_catalog.to_jsonb(v_round), true);
  v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb('A prompt has been drawn'::text), true);
  update public.truth_dare_games set game_state = v_state, updated_at = now() where id = v_game.id;
  return v_state;
end;
$function$;

create or replace function public.finish_truth_dare_turn(p_skipped boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.truth_dare_games%rowtype;
  v_state jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  select game.* into v_game from public.truth_dare_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'No active game'; end if;

  v_state := v_game.game_state;
  if v_state->>'phase' not in ('selected', 'drawn') then raise exception 'There is no prompt to finish'; end if;
  if v_state->>'selected_player' <> v_user::text then raise exception 'Only the selected player can finish this turn'; end if;

  v_state := pg_catalog.jsonb_set(v_state, '{phase}', pg_catalog.to_jsonb('spin'::text), true);
  v_state := pg_catalog.jsonb_set(v_state, '{selected_player}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{prompt_type}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{prompt_text}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb(
    (case when p_skipped then 'Prompt skipped; spin again' else 'Turn finished; spin again' end)::text), true);
  update public.truth_dare_games set game_state = v_state, updated_at = now() where id = v_game.id;
  return v_state;
end;
$function$;

create or replace function public.end_truth_dare_game()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.truth_dare_games%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  select game.* into v_game from public.truth_dare_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'No active game'; end if;
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements_text(v_game.game_state->'players') as player(user_id)
     where player.user_id = v_user::text
  ) then raise exception 'You are not a player in this game'; end if;

  update public.truth_dare_games set status = 'abandoned', updated_at = now() where id = v_game.id;
end;
$function$;

revoke all on function public.start_truth_dare_game() from public, anon;
revoke all on function public.get_truth_dare_state() from public, anon;
revoke all on function public.spin_truth_dare_bottle() from public, anon;
revoke all on function public.ready_truth_dare_prompt() from public, anon;
revoke all on function public.finish_truth_dare_turn(boolean) from public, anon;
revoke all on function public.end_truth_dare_game() from public, anon;
grant execute on function public.start_truth_dare_game() to authenticated;
grant execute on function public.get_truth_dare_state() to authenticated;
grant execute on function public.spin_truth_dare_bottle() to authenticated;
grant execute on function public.ready_truth_dare_prompt() to authenticated;
grant execute on function public.finish_truth_dare_turn(boolean) to authenticated;
grant execute on function public.end_truth_dare_game() to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'truth_dare_games'
  ) then
    execute 'alter publication supabase_realtime add table public.truth_dare_games';
  end if;
end;
$block$;