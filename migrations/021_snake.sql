-- Cooperative two-player Snake with server-authoritative movement.
create table if not exists public.snake_games (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  game_state jsonb not null,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists snake_one_active_per_space_idx
  on public.snake_games(space_id) where status = 'active';
create index if not exists snake_games_space_history_idx
  on public.snake_games(space_id, created_at desc);

alter table public.snake_games enable row level security;
revoke all privileges on table public.snake_games from anon, public, authenticated;
grant select on table public.snake_games to authenticated;

create policy snake_games_select_member
  on public.snake_games for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create or replace function public.start_snake_game()
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
  v_food_x integer;
  v_food_y integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select array_agg(member.user_id order by member.joined_at, member.user_id)
    into v_players
    from public.space_members as member where member.space_id = v_space;
  if pg_catalog.array_length(v_players, 1) <> 2 then
    raise exception 'Snake requires exactly two paired players';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space::text, 5));
  if exists (select 1 from public.snake_games as game where game.space_id = v_space and game.status = 'active') then
    raise exception 'A Snake game is already active';
  end if;

  loop
    v_food_x := pg_catalog.floor(pg_catalog.random() * 20)::integer;
    v_food_y := pg_catalog.floor(pg_catalog.random() * 20)::integer;
    exit when not ((v_food_x between 6 and 8) and v_food_y = 9);
  end loop;

  v_state := pg_catalog.jsonb_build_object(
    'players', pg_catalog.to_jsonb(v_players),
    'phase', 'active',
    'snake', pg_catalog.jsonb_build_array(
      pg_catalog.jsonb_build_object('x', 8, 'y', 9),
      pg_catalog.jsonb_build_object('x', 7, 'y', 9),
      pg_catalog.jsonb_build_object('x', 6, 'y', 9)
    ),
    'direction', 'right',
    'next_direction', 'right',
    'food', pg_catalog.jsonb_build_object('x', v_food_x, 'y', v_food_y),
    'score', 0,
    'tick', 0,
    'last_tick_at', null::text,
    'last_action', 'The shared snake is ready'
  );

  insert into public.snake_games (space_id, created_by, game_state)
  values (v_space, v_user, v_state)
  returning id into v_game_id;
  return v_game_id;
end;
$function$;

create or replace function public.get_snake_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.snake_games%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game from public.snake_games as game
   where game.space_id = v_space order by game.created_at desc limit 1;
  return pg_catalog.jsonb_build_object(
    'game', case when v_game.id is null then null else
      pg_catalog.jsonb_build_object('id', v_game.id, 'space_id', v_game.space_id,
        'game_state', v_game.game_state, 'status', v_game.status,
        'created_at', v_game.created_at, 'updated_at', v_game.updated_at) end,
    'my_id', v_user
  );
end;
$function$;

create or replace function public.set_snake_direction(p_direction text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.snake_games%rowtype;
  v_state jsonb;
  v_direction text;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if p_direction is null or p_direction not in ('up', 'down', 'left', 'right') then
    raise exception 'Choose a valid direction';
  end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  select game.* into v_game from public.snake_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'No active Snake game'; end if;

  v_state := v_game.game_state;
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements_text(v_state->'players') as player(user_id)
     where player.user_id = v_user::text
  ) then raise exception 'You are not a player in this game'; end if;
  v_direction := coalesce(v_state->>'next_direction', v_state->>'direction');
  if (v_direction = 'up' and p_direction = 'down')
    or (v_direction = 'down' and p_direction = 'up')
    or (v_direction = 'left' and p_direction = 'right')
    or (v_direction = 'right' and p_direction = 'left') then
    raise exception 'The snake cannot reverse into itself';
  end if;

  v_state := pg_catalog.jsonb_set(v_state, '{next_direction}', pg_catalog.to_jsonb(p_direction::text), true);
  update public.snake_games set game_state = v_state, updated_at = now() where id = v_game.id;
  return v_state;
end;
$function$;

create or replace function public.advance_snake_game()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.snake_games%rowtype;
  v_state jsonb;
  v_snake jsonb;
  v_head jsonb;
  v_next_head jsonb;
  v_body jsonb;
  v_new_snake jsonb;
  v_direction text;
  v_x integer;
  v_y integer;
  v_food_x integer;
  v_food_y integer;
  v_growing boolean;
  v_collision boolean;
  v_length integer;
  v_score integer;
  v_tick_time timestamptz := pg_catalog.clock_timestamp();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  select game.* into v_game from public.snake_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'No active Snake game'; end if;

  v_state := v_game.game_state;
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements_text(v_state->'players') as player(user_id)
     where player.user_id = v_user::text
  ) then raise exception 'You are not a player in this game'; end if;
  if v_state->>'last_tick_at' is not null
    and (v_state->>'last_tick_at')::timestamptz > v_tick_time - interval '280 milliseconds' then
    return v_state;
  end if;

  v_snake := v_state->'snake';
  v_length := pg_catalog.jsonb_array_length(v_snake);
  v_head := v_snake->0;
  v_direction := coalesce(v_state->>'next_direction', v_state->>'direction');
  v_x := (v_head->>'x')::integer;
  v_y := (v_head->>'y')::integer;
  if v_direction = 'up' then v_y := v_y - 1;
  elsif v_direction = 'down' then v_y := v_y + 1;
  elsif v_direction = 'left' then v_x := v_x - 1;
  else v_x := v_x + 1;
  end if;

  v_food_x := (v_state->'food'->>'x')::integer;
  v_food_y := (v_state->'food'->>'y')::integer;
  v_growing := v_x = v_food_x and v_y = v_food_y;
  v_next_head := pg_catalog.jsonb_build_object('x', v_x, 'y', v_y);
  v_collision := v_x < 0 or v_x >= 20 or v_y < 0 or v_y >= 20;
  if not v_collision then
    select exists (
      select 1 from pg_catalog.jsonb_array_elements(v_snake) with ordinality as segment(point, position)
       where (v_growing or segment.position < v_length)
         and segment.point = v_next_head
    ) into v_collision;
  end if;

  v_state := pg_catalog.jsonb_set(v_state, '{tick}', pg_catalog.to_jsonb(coalesce((v_state->>'tick')::integer, 0) + 1), true);
  v_state := pg_catalog.jsonb_set(v_state, '{last_tick_at}', pg_catalog.to_jsonb(v_tick_time), true);
  v_state := pg_catalog.jsonb_set(v_state, '{direction}', pg_catalog.to_jsonb(v_direction::text), true);
  if v_collision then
    v_state := pg_catalog.jsonb_set(v_state, '{phase}', pg_catalog.to_jsonb('completed'::text), true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb('The snake bumped into the garden edge or itself'::text), true);
    update public.snake_games set game_state = v_state, status = 'completed', updated_at = now() where id = v_game.id;
    return v_state;
  end if;

  select coalesce(pg_catalog.jsonb_agg(segment.point order by segment.position), '[]'::jsonb)
    into v_body
    from pg_catalog.jsonb_array_elements(v_snake) with ordinality as segment(point, position)
   where v_growing or segment.position < v_length;
  v_new_snake := pg_catalog.jsonb_build_array(v_next_head) || v_body;
  v_state := pg_catalog.jsonb_set(v_state, '{snake}', v_new_snake, true);
  v_score := coalesce((v_state->>'score')::integer, 0);

  if v_growing then
    v_score := v_score + 1;
    if v_length >= 399 then
      v_state := pg_catalog.jsonb_set(v_state, '{snake}', v_new_snake, true);
      v_state := pg_catalog.jsonb_set(v_state, '{phase}', pg_catalog.to_jsonb('completed'::text), true);
      v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb('You filled the garden!'::text), true);
      v_state := pg_catalog.jsonb_set(v_state, '{score}', pg_catalog.to_jsonb(v_score), true);
      update public.snake_games set game_state = v_state, status = 'completed', updated_at = now() where id = v_game.id;
      return v_state;
    end if;
    loop
      v_food_x := pg_catalog.floor(pg_catalog.random() * 20)::integer;
      v_food_y := pg_catalog.floor(pg_catalog.random() * 20)::integer;
      exit when not exists (
        select 1 from pg_catalog.jsonb_array_elements(v_new_snake) as segment(point)
         where (segment.point->>'x')::integer = v_food_x and (segment.point->>'y')::integer = v_food_y
      );
    end loop;
    v_state := pg_catalog.jsonb_set(v_state, '{food}', pg_catalog.jsonb_build_object('x', v_food_x, 'y', v_food_y), true);
    v_state := pg_catalog.jsonb_set(v_state, '{score}', pg_catalog.to_jsonb(v_score), true);
    v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb('Fruit collected'::text), true);
  else
    v_state := pg_catalog.jsonb_set(v_state, '{last_action}', pg_catalog.to_jsonb('The shared snake moved'::text), true);
  end if;

  update public.snake_games set game_state = v_state, updated_at = now() where id = v_game.id;
  return v_state;
end;
$function$;

create or replace function public.end_snake_game()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space uuid;
  v_game public.snake_games%rowtype;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space
    from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  select game.* into v_game from public.snake_games as game
   where game.space_id = v_space and game.status = 'active' for update;
  if not found then raise exception 'No active Snake game'; end if;
  if not exists (
    select 1 from pg_catalog.jsonb_array_elements_text(v_game.game_state->'players') as player(user_id)
     where player.user_id = v_user::text
  ) then raise exception 'You are not a player in this game'; end if;
  update public.snake_games set status = 'abandoned', updated_at = now() where id = v_game.id;
end;
$function$;

revoke all on function public.start_snake_game() from public, anon;
revoke all on function public.get_snake_state() from public, anon;
revoke all on function public.set_snake_direction(text) from public, anon;
revoke all on function public.advance_snake_game() from public, anon;
revoke all on function public.end_snake_game() from public, anon;
grant execute on function public.start_snake_game() to authenticated;
grant execute on function public.get_snake_state() to authenticated;
grant execute on function public.set_snake_direction(text) to authenticated;
grant execute on function public.advance_snake_game() to authenticated;
grant execute on function public.end_snake_game() to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'snake_games'
  ) then
    execute 'alter publication supabase_realtime add table public.snake_games';
  end if;
end;
$block$;