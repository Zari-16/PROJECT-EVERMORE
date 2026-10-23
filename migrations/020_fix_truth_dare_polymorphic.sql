-- Fix untyped literals and prevent immediate repeats in migration 019.
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