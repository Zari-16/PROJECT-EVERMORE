-- Heart & Hollow: server-authoritative two-player shedding-card game.
create table if not exists public.card_games (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  game_state jsonb not null,
  status text not null default 'active' check (status in ('active', 'completed', 'abandoned')),
  winner uuid references auth.users(id) on delete set null,
  winner_score integer not null default 0 check (winner_score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists card_games_one_active_per_space_idx
  on public.card_games(space_id) where status = 'active';
create index if not exists card_games_space_history_idx
  on public.card_games(space_id, created_at desc);

create table if not exists public.card_game_status (
  game_id uuid primary key references public.card_games(id) on delete cascade,
  space_id uuid not null references public.private_spaces(id) on delete cascade,
  status text not null check (status in ('active', 'completed', 'abandoned')),
  version integer not null default 1,
  winner uuid references auth.users(id) on delete set null,
  winner_score integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists card_game_status_space_updated_idx
  on public.card_game_status(space_id, updated_at desc);

alter table public.card_games enable row level security;
alter table public.card_game_status enable row level security;
revoke all privileges on table public.card_games from anon, public, authenticated;
revoke all privileges on table public.card_game_status from anon, public, authenticated;
grant select on table public.card_game_status to authenticated;

create policy card_game_status_select_member
  on public.card_game_status for select to authenticated
  using (public.is_space_member(space_id, (select auth.uid())));

create or replace function public.start_heart_hollow_game()
returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_players uuid[];
  v_deck jsonb;
  v_hand_one jsonb;
  v_hand_two jsonb;
  v_draw jsonb;
  v_discard jsonb;
  v_state jsonb;
  v_game_id uuid;
  v_first_player uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  select member.space_id into v_space_id
    from public.space_members as member
   where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select array_agg(member.user_id order by member.joined_at, member.user_id)
    into v_players
    from public.space_members as member
   where member.space_id = v_space_id;
  if pg_catalog.array_length(v_players, 1) <> 2 then
    raise exception 'Heart & Hollow requires a paired two-person space';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space_id::text, 2));
  if exists (
    select 1 from public.card_games as game
     where game.space_id = v_space_id and game.status = 'active'
  ) then
    raise exception 'A card game is already in progress';
  end if;

  select pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'id', pg_catalog.gen_random_uuid()::text,
      'color', deck.color,
      'kind', deck.kind,
      'value', deck.value
    ) order by random()
  ) into v_deck
  from (
    select colors.color, 'number'::text as kind, numbers.number::text as value
      from unnest(array['rose', 'moss', 'moon', 'ember']::text[]) as colors(color)
      cross join generate_series(0, 9) as numbers(number)
      cross join lateral generate_series(1, case when numbers.number = 0 then 1 else 2 end) as copies(copy)
    union all
    select colors.color, 'skip'::text, 'skip'::text
      from unnest(array['rose', 'moss', 'moon', 'ember']::text[]) as colors(color)
      cross join generate_series(1, 2) as copies(copy)
    union all
    select colors.color, 'draw_two'::text, 'draw_two'::text
      from unnest(array['rose', 'moss', 'moon', 'ember']::text[]) as colors(color)
      cross join generate_series(1, 2) as copies(copy)
    union all
    select null::text, 'wild'::text, 'wild'::text from generate_series(1, 4) as copies(copy)
    union all
    select null::text, 'wild_four'::text, 'wild_four'::text from generate_series(1, 4) as copies(copy)
  ) as deck;

  select pg_catalog.jsonb_agg(cards.card order by cards.ordinal)
    into v_hand_one
    from pg_catalog.jsonb_array_elements(v_deck) with ordinality as cards(card, ordinal)
   where cards.ordinal between 1 and 7;
  select pg_catalog.jsonb_agg(cards.card order by cards.ordinal)
    into v_hand_two
    from pg_catalog.jsonb_array_elements(v_deck) with ordinality as cards(card, ordinal)
   where cards.ordinal between 8 and 14;
  select cards.card into v_discard
    from pg_catalog.jsonb_array_elements(v_deck) with ordinality as cards(card, ordinal)
   where cards.ordinal > 14 and cards.card->>'kind' = 'number'
   order by cards.ordinal
   limit 1;
  select pg_catalog.jsonb_agg(cards.card order by cards.ordinal)
    into v_draw
    from pg_catalog.jsonb_array_elements(v_deck) with ordinality as cards(card, ordinal)
   where cards.ordinal > 14 and cards.card->>'id' <> v_discard->>'id';

  if v_discard is null then raise exception 'Unable to deal a starting card'; end if;
  v_first_player := case when random() < 0.5 then v_players[1] else v_players[2] end;
  v_state := pg_catalog.jsonb_build_object(
    'players', pg_catalog.to_jsonb(v_players),
    'hands', pg_catalog.jsonb_build_object(v_players[1]::text, v_hand_one, v_players[2]::text, v_hand_two),
    'draw_pile', coalesce(v_draw, '[]'::jsonb),
    'discard_pile', pg_catalog.jsonb_build_array(v_discard),
    'current_player', v_first_player,
    'pending_draw', 0
  );

  insert into public.card_games (space_id, created_by, game_state)
  values (v_space_id, v_user, v_state)
  returning id into v_game_id;

  insert into public.card_game_status (game_id, space_id, status)
  values (v_game_id, v_space_id, 'active');
  return v_game_id;
end;
$function$;

create or replace function public.get_heart_hollow_state()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_game public.card_games%rowtype;
  v_history jsonb;
  v_opponent uuid;
  v_my_hand jsonb;
  v_state jsonb;
  v_public_game jsonb;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space_id from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game
    from public.card_games as game
   where game.space_id = v_space_id
   order by case when game.status = 'active' then 0 else 1 end, game.created_at desc
   limit 1;

  if found then
    v_state := v_game.game_state;
    v_opponent := case
      when v_state->'players'->>0 = v_user::text then (v_state->'players'->>1)::uuid
      else (v_state->'players'->>0)::uuid
    end;
    v_my_hand := coalesce(v_state->'hands'->v_user::text, '[]'::jsonb);
    v_public_game := pg_catalog.jsonb_build_object(
      'id', v_game.id,
      'status', v_game.status,
      'winner', v_game.winner,
      'winner_score', v_game.winner_score,
      'my_id', v_user,
      'opponent_id', v_opponent,
      'my_hand', v_my_hand,
      'opponent_count', pg_catalog.jsonb_array_length(coalesce(v_state->'hands'->v_opponent::text, '[]'::jsonb)),
      'top_card', v_state->'discard_pile'->-1,
      'draw_count', pg_catalog.jsonb_array_length(coalesce(v_state->'draw_pile', '[]'::jsonb)),
      'current_player', v_state->>'current_player',
      'pending_draw', coalesce((v_state->>'pending_draw')::integer, 0),
      'created_at', v_game.created_at,
      'completed_at', v_game.completed_at
    );
  end if;

  select coalesce(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'game_id', history.game_id,
      'status', history.status,
      'winner', history.winner,
      'winner_score', history.winner_score,
      'created_at', history.created_at,
      'completed_at', history.completed_at
    ) order by history.created_at desc
  ), '[]'::jsonb)
    into v_history
    from (
      select status.game_id, status.status, status.winner, status.winner_score,
             status.created_at, status.completed_at
        from public.card_game_status as status
       where status.space_id = v_space_id
       order by status.created_at desc
       limit 10
    ) as history;

  return pg_catalog.jsonb_build_object('game', v_public_game, 'history', v_history);
end;
$function$;

create or replace function public.abandon_heart_hollow_game()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_game_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space_id from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space_id::text, 2));
  update public.card_games as game
     set status = 'abandoned', updated_at = now()
   where game.space_id = v_space_id and game.status = 'active'
  returning game.id into v_game_id;
  if v_game_id is not null then
    update public.card_game_status as status
       set status = 'abandoned', version = status.version + 1, updated_at = now()
     where status.game_id = v_game_id;
  end if;
end;
$function$;

create or replace function public.play_heart_hollow_card(p_card_id uuid, p_wild_color text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_game public.card_games%rowtype;
  v_state jsonb;
  v_players jsonb;
  v_hand jsonb;
  v_new_hand jsonb;
  v_discard jsonb;
  v_card jsonb;
  v_top jsonb;
  v_played_card jsonb;
  v_other uuid;
  v_current uuid;
  v_pending_draw integer;
  v_score integer := 0;
  v_winner uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space_id from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game from public.card_games as game
   where game.space_id = v_space_id and game.status = 'active' for update;
  if not found then raise exception 'No active card game'; end if;

  v_state := v_game.game_state;
  v_current := (v_state->>'current_player')::uuid;
  if v_current <> v_user then raise exception 'It is not your turn'; end if;
  v_players := v_state->'players';
  v_other := case when v_players->>0 = v_user::text then (v_players->>1)::uuid else (v_players->>0)::uuid end;
  v_hand := coalesce(v_state->'hands'->v_user::text, '[]'::jsonb);
  v_top := v_state->'discard_pile'->-1;
  v_pending_draw := coalesce((v_state->>'pending_draw')::integer, 0);

  if v_pending_draw > 0 then
    raise exception 'Draw % cards before playing another card', v_pending_draw;
  end if;

  select item.card into v_card
    from pg_catalog.jsonb_array_elements(v_hand) as item(card)
   where item.card->>'id' = p_card_id::text;
  if not found then raise exception 'That card is not in your hand'; end if;

  if v_card->>'kind' not in ('wild', 'wild_four')
     and v_card->>'color' <> v_top->>'color'
     and v_card->>'value' <> v_top->>'value' then
    raise exception 'Play a matching color or value';
  end if;
  if v_card->>'kind' = 'wild_four' and exists (
    select 1 from pg_catalog.jsonb_array_elements(v_hand) as item(card)
     where item.card->>'color' = v_top->>'color'
  ) then
    raise exception 'Use a wild four only when you have no card in the active color';
  end if;
  if v_card->>'kind' in ('wild', 'wild_four') and (p_wild_color is null or p_wild_color not in ('rose', 'moss', 'moon', 'ember')) then
    raise exception 'Choose a valid color for the wild card';
  end if;

  v_played_card := case
    when v_card->>'kind' in ('wild', 'wild_four') then v_card || pg_catalog.jsonb_build_object('color', p_wild_color)
    else v_card
  end;
  select coalesce(pg_catalog.jsonb_agg(item.card order by item.ordinal), '[]'::jsonb)
    into v_new_hand
    from pg_catalog.jsonb_array_elements(v_hand) with ordinality as item(card, ordinal)
   where item.card->>'id' <> p_card_id::text;

  v_discard := coalesce(v_state->'discard_pile', '[]'::jsonb) || pg_catalog.jsonb_build_array(v_played_card);
  v_state := pg_catalog.jsonb_set(v_state, '{hands}',
    pg_catalog.jsonb_set(coalesce(v_state->'hands', '{}'::jsonb), array[v_user::text], v_new_hand, true), true);
  v_state := pg_catalog.jsonb_set(v_state, '{discard_pile}', v_discard, true);
  v_pending_draw := case when v_card->>'kind' = 'draw_two' then 2 when v_card->>'kind' = 'wild_four' then 4 else 0 end;
  v_state := pg_catalog.jsonb_set(v_state, '{pending_draw}', pg_catalog.to_jsonb(v_pending_draw), true);
  v_state := pg_catalog.jsonb_set(v_state, '{current_player}', pg_catalog.to_jsonb(
    case when v_card->>'kind' = 'skip' then v_user else v_other end
  ), true);

  if pg_catalog.jsonb_array_length(v_new_hand) = 0 then
    select coalesce(sum(case
      when card->>'kind' = 'number' then (card->>'value')::integer
      when card->>'kind' = 'draw_two' then 20
      when card->>'kind' = 'wild_four' then 40
      else 15
    end), 0)::integer into v_score
      from pg_catalog.jsonb_array_elements(coalesce(v_state->'hands'->v_other::text, '[]'::jsonb)) as remaining(card);
    v_winner := v_user;
    update public.card_games
       set game_state = v_state, status = 'completed', winner = v_winner,
           winner_score = v_score, completed_at = now(), updated_at = now()
     where id = v_game.id;
    update public.card_game_status
       set status = 'completed', winner = v_winner, winner_score = v_score,
           completed_at = now(), updated_at = now(), version = version + 1
     where game_id = v_game.id;
  else
    update public.card_games set game_state = v_state, updated_at = now() where id = v_game.id;
    update public.card_game_status set updated_at = now(), version = version + 1 where game_id = v_game.id;
  end if;
end;
$function$;

create or replace function public.draw_heart_hollow_cards()
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_game public.card_games%rowtype;
  v_state jsonb;
  v_hand jsonb;
  v_draw jsonb;
  v_discard jsonb;
  v_top jsonb;
  v_opponent uuid;
  v_draw_count integer;
  v_drawn integer := 0;
  v_card jsonb;
  v_draw_index integer;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space_id from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;

  select game.* into v_game from public.card_games as game
   where game.space_id = v_space_id and game.status = 'active' for update;
  if not found then raise exception 'No active card game'; end if;
  v_state := v_game.game_state;
  if (v_state->>'current_player')::uuid <> v_user then raise exception 'It is not your turn'; end if;
  v_opponent := case when v_state->'players'->>0 = v_user::text then (v_state->'players'->>1)::uuid else (v_state->'players'->>0)::uuid end;
  v_hand := coalesce(v_state->'hands'->v_user::text, '[]'::jsonb);
  v_draw := coalesce(v_state->'draw_pile', '[]'::jsonb);
  v_discard := coalesce(v_state->'discard_pile', '[]'::jsonb);
  v_draw_count := case when coalesce((v_state->>'pending_draw')::integer, 0) > 0 then (v_state->>'pending_draw')::integer else 1 end;

  for v_draw_index in 1..v_draw_count loop
    if pg_catalog.jsonb_array_length(v_draw) = 0 then
      v_top := v_discard->-1;
      select coalesce(pg_catalog.jsonb_agg(item.card order by random()), '[]'::jsonb)
        into v_draw
        from pg_catalog.jsonb_array_elements(v_discard) as item(card)
       where item.card->>'id' <> v_top->>'id';
      v_discard := pg_catalog.jsonb_build_array(v_top);
    end if;
    exit when pg_catalog.jsonb_array_length(v_draw) = 0;
    v_card := v_draw->0;
    v_hand := v_hand || pg_catalog.jsonb_build_array(v_card);
    v_draw := v_draw - 0;
    v_drawn := v_drawn + 1;
  end loop;

  v_state := pg_catalog.jsonb_set(v_state, '{hands}',
    pg_catalog.jsonb_set(coalesce(v_state->'hands', '{}'::jsonb), array[v_user::text], v_hand, true), true);
  v_state := pg_catalog.jsonb_set(v_state, '{draw_pile}', v_draw, true);
  v_state := pg_catalog.jsonb_set(v_state, '{discard_pile}', v_discard, true);
  v_state := pg_catalog.jsonb_set(v_state, '{pending_draw}', '0'::jsonb, true);
  v_state := pg_catalog.jsonb_set(v_state, '{current_player}', pg_catalog.to_jsonb(v_opponent), true);

  update public.card_games set game_state = v_state, updated_at = now() where id = v_game.id;
  update public.card_game_status set updated_at = now(), version = version + 1 where game_id = v_game.id;
  return v_drawn;
end;
$function$;

create or replace function public.abandon_heart_hollow_game()
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_user uuid := auth.uid();
  v_space_id uuid;
  v_game_id uuid;
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  select member.space_id into v_space_id from public.space_members as member where member.user_id = v_user;
  if not found then raise exception 'Pair your account before playing'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_space_id::text, 2));

  update public.card_games as game
     set status = 'abandoned', updated_at = now()
   where game.space_id = v_space_id and game.status = 'active'
  returning game.id into v_game_id;
  if v_game_id is not null then
    update public.card_game_status as status
       set status = 'abandoned', updated_at = now(), version = status.version + 1
     where status.game_id = v_game_id;
  end if;
end;
$function$;

revoke all on function public.start_heart_hollow_game() from public, anon;
revoke all on function public.get_heart_hollow_state() from public, anon;
revoke all on function public.abandon_heart_hollow_game() from public, anon;
revoke all on function public.play_heart_hollow_card(uuid, text) from public, anon;
revoke all on function public.draw_heart_hollow_cards() from public, anon;
grant execute on function public.start_heart_hollow_game() to authenticated;
grant execute on function public.get_heart_hollow_state() to authenticated;
grant execute on function public.abandon_heart_hollow_game() to authenticated;
grant execute on function public.play_heart_hollow_card(uuid, text) to authenticated;
grant execute on function public.draw_heart_hollow_cards() to authenticated;

do $block$
begin
  if not exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    raise exception 'Supabase Realtime publication supabase_realtime does not exist';
  end if;

  if not exists (
    select 1 from pg_catalog.pg_publication_tables
     where pubname = 'supabase_realtime'
       and schemaname = 'public'
       and tablename = 'card_game_status'
  ) then
    execute 'alter publication supabase_realtime add table public.card_game_status';
  end if;
end;
$block$;
