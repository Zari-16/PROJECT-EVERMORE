-- Two-player, server-authoritative Ludo with a public shared board state.
create table if not exists public.ludo_games (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  game_state jsonb not null,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  winner uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists ludo_one_active_game_per_space_idx
  on public.ludo_games(space_id) where status = 'active';
create index if not exists ludo_games_space_history_idx
  on public.ludo_games(space_id, created_at desc);

alter table public.ludo_games enable row level security;
revoke all privileges on table public.ludo_games from anon, public, authenticated;
grant select on table public.ludo_games to authenticated;

create policy ludo_games_select_member
  on public.ludo_games for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create or replace function public.start_ludo_game()
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
  v_first uuid;
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
    raise exception 'Ludo requires exactly two paired players';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space::text, 3));
  if exists (select 1 from public.ludo_games as game where game.space_id = v_space and game.status = 'active') then
    raise exception 'A Ludo match is already active';
  end if;

  v_first := case when random() < 0.5 then v_players[1] else v_players[2] end;
  v_state := pg_catalog.jsonb_build_object(
    'players', pg_catalog.to_jsonb(v_players),
    'tokens', pg_catalog.jsonb_build_object(v_players[1]::text, '[-1,-1,-1,-1]'::jsonb, v_players[2]::text, '[-1,-1,-1,-1]'::jsonb),
    'current_player', v_first,
    'dice', null,
    'last_roll', null,
    'six_streak', 0,
    'last_action', 'Match started'
  );

  insert into public.ludo_games (space_id, created_by, game_state)
  values (v_space, v_user, v_state)
  returning id into v_game_id;
  return v_game_id;
end;
$function$;

create or replace function public.get_ludo_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.ludo_games%rowtype;
  v_history jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game from public.ludo_games as game
   where game.space_id = v_space
   order by case when game.status = 'active' then 0 else 1 end, game.created_at desc
   limit 1;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object('id', history.id, 'status', history.status,
      'winner', history.winner, 'created_at', history.created_at, 'completed_at', history.completed_at)
    order by history.created_at desc
  ), '[]'::jsonb)
  into v_history
  from (
    select game.id, game.status, game.winner, game.created_at, game.completed_at
      from public.ludo_games as game where game.space_id = v_space
     order by game.created_at desc limit 10
  ) as history;

  return pg_catalog.jsonb_build_object('game', case when v_game.id is null then null else
    pg_catalog.jsonb_build_object('id', v_game.id, 'space_id', v_game.space_id,
      'game_state', v_game.game_state, 'status', v_game.status, 'winner', v_game.winner,
      'created_at', v_game.created_at, 'completed_at', v_game.completed_at) end,
    'history', v_history,
    'my_id', v_user);
end;
$function$;

create or replace function public.roll_ludo_dice()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.ludo_games%rowtype;
  v_state jsonb;
  v_tokens jsonb;
  v_my_tokens jsonb;
  v_roll integer;
  v_streak integer;
  v_legal boolean := false;
  v_position integer;
  v_other uuid;
  v_index integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game from public.ludo_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'No active Ludo match'; end if;
  v_state := v_game.game_state;
  if (v_state->>'current_player')::uuid <> v_user then raise exception 'It is not your turn'; end if;
  if v_state->'dice' is not null and v_state->'dice' <> 'null'::jsonb then raise exception 'Move a token before rolling again'; end if;

  v_roll := floor(random() * 6 + 1)::integer;
  v_streak := case when v_roll = 6 then coalesce((v_state->>'six_streak')::integer, 0) + 1 else 0 end;
  v_other := case when v_state->'players'->>0 = v_user::text then (v_state->'players'->>1)::uuid else (v_state->'players'->>0)::uuid end;
  v_my_tokens := coalesce(v_state->'tokens'->v_user::text, '[-1,-1,-1,-1]'::jsonb);

  if v_streak < 3 then
    for v_index in 0..3 loop
      v_position := (v_my_tokens->>v_index)::integer;
      if (v_position = -1 and v_roll = 6) or (v_position >= 0 and v_position < 58 and v_position + v_roll <= 58) then
        v_legal := true;
        exit;
      end if;
    end loop;
  end if;

  if v_streak >= 3 or not v_legal then
    v_state := pg_catalog.jsonb_set(v_state, '{dice}', 'null'::jsonb, true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_roll}', pg_catalog.to_jsonb(v_roll), true);
    v_state := pg_catalog.jsonb_set(v_state, '{six_streak}', pg_catalog.to_jsonb(case when v_streak >= 3 then 0 else v_streak end), true);
    v_state := pg_catalog.jsonb_set(v_state, '{current_player}', pg_catalog.to_jsonb(case when v_streak >= 3 or v_roll <> 6 then v_other else v_user end), true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb(case when v_streak >= 3 then 'Three sixes; turn skipped' when v_roll = 6 then 'No legal move; roll again' else 'No legal move; turn passed' end), true);
  else
    v_state := pg_catalog.jsonb_set(v_state, '{dice}', pg_catalog.to_jsonb(v_roll), true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_roll}', pg_catalog.to_jsonb(v_roll), true);
    v_state := pg_catalog.jsonb_set(v_state, '{six_streak}', pg_catalog.to_jsonb(v_streak), true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb('Rolled ' || v_roll::text), true);
  end if;

  update public.ludo_games set game_state = v_state, updated_at = now() where id = v_game.id;
  return v_state;
end;
$function$;

create or replace function public.move_ludo_token(p_token_index integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.ludo_games%rowtype;
  v_state jsonb;
  v_tokens jsonb;
  v_my_tokens jsonb;
  v_other_tokens jsonb;
  v_players jsonb;
  v_other uuid;
  v_start integer;
  v_other_start integer;
  v_roll integer;
  v_position integer;
  v_new_position integer;
  v_global integer;
  v_captured integer := 0;
  v_finished integer := 0;
  v_winner uuid;
  v_token_index integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_token_index is null or p_token_index not between 0 and 3 then raise exception 'Choose one of your four tokens'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game from public.ludo_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'No active Ludo match'; end if;
  v_state := v_game.game_state;
  if (v_state->>'current_player')::uuid <> v_user then raise exception 'It is not your turn'; end if;
  if v_state->'dice' is null or v_state->'dice' = 'null'::jsonb then raise exception 'Roll the dice first'; end if;

  v_roll := (v_state->>'dice')::integer;
  v_players := v_state->'players';
  v_other := case when v_players->>0 = v_user::text then (v_players->>1)::uuid else (v_players->>0)::uuid end;
  v_start := case when v_players->>0 = v_user::text then 0 else 26 end;
  v_other_start := case when v_players->>0 = v_user::text then 26 else 0 end;
  v_tokens := coalesce(v_state->'tokens', '{}'::jsonb);
  v_my_tokens := coalesce(v_tokens->v_user::text, '[-1,-1,-1,-1]'::jsonb);
  v_other_tokens := coalesce(v_tokens->v_other::text, '[-1,-1,-1,-1]'::jsonb);
  v_position := (v_my_tokens->>p_token_index)::integer;

  if v_position = -1 then
    if v_roll <> 6 then raise exception 'A six is needed to leave the yard'; end if;
    v_new_position := 0;
  elsif v_position < 0 or v_position >= 58 or v_position + v_roll > 58 then
    raise exception 'That token cannot move with this roll';
  else
    v_new_position := v_position + v_roll;
  end if;

  if v_new_position < 52 then
    v_global := (v_start + v_new_position) % 52;
    if v_global not in (0, 8, 13, 21, 26, 34, 39, 47) then
      for v_token_index in 0..3 loop
        v_position := (v_other_tokens->>v_token_index)::integer;
        if v_position between 0 and 51 and (v_other_start + v_position) % 52 = v_global then
          v_other_tokens := pg_catalog.jsonb_set(v_other_tokens, array[v_token_index::text], '-1'::jsonb, false);
          v_captured := v_captured + 1;
        end if;
      end loop;
      v_tokens := pg_catalog.jsonb_set(v_tokens, array[v_other::text], v_other_tokens, true);
    end if;
  end if;

  v_my_tokens := pg_catalog.jsonb_set(v_my_tokens, array[p_token_index::text], pg_catalog.to_jsonb(v_new_position), false);
  v_tokens := pg_catalog.jsonb_set(v_tokens, array[v_user::text], v_my_tokens, true);
  v_state := pg_catalog.jsonb_set(v_state, '{tokens}', v_tokens, true);
  v_state := pg_catalog.jsonb_set(v_state, '{dice}', 'null'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb(case when v_captured > 0 then 'Token captured' else 'Token moved' end), true);

  select count(*)::integer into v_finished
    from pg_catalog.jsonb_array_elements_text(v_my_tokens) as token(position)
   where token.position::integer = 58;

  if v_finished = 4 then
    v_winner := v_user;
    update public.ludo_games set game_state = v_state, status = 'completed', winner = v_winner,
      completed_at = now(), updated_at = now() where id = v_game.id;
  else
    v_state := pg_catalog.jsonb_set(v_state, '{current_player}', pg_catalog.to_jsonb(case when v_roll = 6 then v_user else v_other end), true);
    update public.ludo_games set game_state = v_state, updated_at = now() where id = v_game.id;
  end if;
  return v_state;
end;
$function$;

create or replace function public.abandon_ludo_game()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  update public.ludo_games as game
     set status = 'abandoned', updated_at = now()
   where game.space_id = v_space and game.status = 'active';
end;
$function$;

revoke all on function public.start_ludo_game() from public, anon;
revoke all on function public.get_ludo_state() from public, anon;
revoke all on function public.roll_ludo_dice() from public, anon;
revoke all on function public.move_ludo_token(integer) from public, anon;
revoke all on function public.abandon_ludo_game() from public, anon;
grant execute on function public.start_ludo_game() to authenticated;
grant execute on function public.get_ludo_state() to authenticated;
grant execute on function public.roll_ludo_dice() to authenticated;
grant execute on function public.move_ludo_token(integer) to authenticated;
grant execute on function public.abandon_ludo_game() to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'ludo_games'
  ) then
    execute 'alter publication supabase_realtime add table public.ludo_games';
  end if;
end;
$block$;
