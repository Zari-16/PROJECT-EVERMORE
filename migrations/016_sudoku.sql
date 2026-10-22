-- Private, resumable Sudoku games. Puzzles and solutions are saved for exact recovery.
create table if not exists public.sudoku_games (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  difficulty text not null check (difficulty in ('easy', 'medium', 'hard', 'expert')),
  puzzle text not null check (puzzle ~ '^[1-9-]{81}$'),
  solution text not null check (solution ~ '^[1-9]{81}$'),
  board text not null check (board ~ '^[1-9-]{81}$'),
  notes jsonb not null default '{}'::jsonb check (pg_catalog.jsonb_typeof(notes) = 'object'),
  status text not null default 'in_progress' check (status in ('in_progress', 'paused', 'completed', 'abandoned')),
  elapsed_seconds integer not null default 0 check (elapsed_seconds >= 0),
  timer_started_at timestamptz,
  hints_used integer not null default 0 check (hints_used between 0 and 81),
  score integer not null default 0 check (score >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'in_progress' and timer_started_at is not null) or (status <> 'in_progress' and timer_started_at is null))
);

create unique index if not exists sudoku_one_active_game_per_user_idx
  on public.sudoku_games(user_id) where status in ('in_progress', 'paused');
create index if not exists sudoku_games_user_history_idx
  on public.sudoku_games(user_id, created_at desc);

alter table public.sudoku_games enable row level security;
revoke all privileges on table public.sudoku_games from anon, public, authenticated;
grant select, delete on table public.sudoku_games to authenticated;
grant insert (user_id, difficulty, puzzle, solution, board, notes, status, elapsed_seconds, timer_started_at, hints_used, score, completed_at)
  on table public.sudoku_games to authenticated;
grant update (board, notes, status, elapsed_seconds, timer_started_at, hints_used, score, completed_at, updated_at)
  on table public.sudoku_games to authenticated;

create policy sudoku_games_select_own
  on public.sudoku_games for select to authenticated
  using (user_id = (select auth.uid()));
create policy sudoku_games_insert_own
  on public.sudoku_games for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and pg_catalog.char_length(puzzle) = 81
    and pg_catalog.char_length(solution) = 81
    and pg_catalog.char_length(board) = 81
    and difficulty in ('easy', 'medium', 'hard', 'expert')
  );
create policy sudoku_games_update_own
  on public.sudoku_games for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));
create policy sudoku_games_delete_own
  on public.sudoku_games for delete to authenticated
  using (user_id = (select auth.uid()));

create or replace function public.evermore_set_sudoku_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end;
$function$;

revoke all on function public.evermore_set_sudoku_updated_at() from public, anon, authenticated;
drop trigger if exists sudoku_games_updated_at on public.sudoku_games;
create trigger sudoku_games_updated_at
  before update on public.sudoku_games
  for each row execute function public.evermore_set_sudoku_updated_at();
