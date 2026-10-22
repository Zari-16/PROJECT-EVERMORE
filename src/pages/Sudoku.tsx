import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { getSudoku } from 'sudoku-gen';
import { supabase } from '../lib/supabase';
import { useAuth } from '../components/AuthProvider';

type Difficulty = 'easy' | 'medium' | 'hard' | 'expert';
type GameStatus = 'in_progress' | 'paused' | 'completed' | 'abandoned';
type Notes = Record<string, number[]>;

type SudokuGame = {
  id: string;
  user_id: string;
  difficulty: Difficulty;
  puzzle: string;
  solution: string;
  board: string;
  notes: Notes;
  status: GameStatus;
  elapsed_seconds: number;
  timer_started_at: string | null;
  hints_used: number;
  score: number;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

const GAME_COLUMNS = 'id,user_id,difficulty,puzzle,solution,board,notes,status,elapsed_seconds,timer_started_at,hints_used,score,created_at,updated_at,completed_at';
const DIFFICULTIES: Difficulty[] = ['easy', 'medium', 'hard', 'expert'];
const BASE_SCORE: Record<Difficulty, number> = { easy: 100, medium: 180, hard: 280, expert: 420 };

function elapsedFor(game: SudokuGame, now: number) {
  if (game.status !== 'in_progress' || !game.timer_started_at) return game.elapsed_seconds;
  return game.elapsed_seconds + Math.max(0, Math.floor((now - Date.parse(game.timer_started_at)) / 1000));
}

function formatTime(totalSeconds: number) {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  return `${String(Math.floor(seconds / 3600)).padStart(2, '0')}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function getScore(game: SudokuGame, elapsedSeconds: number) {
  const timeBonus = Math.max(0, 60 - Math.floor(elapsedSeconds / 60));
  return Math.max(10, BASE_SCORE[game.difficulty] + timeBonus - game.hints_used * 15);
}

export default function Sudoku() {
  const { session } = useAuth();
  const [games, setGames] = useState<SudokuGame[]>([]);
  const [game, setGame] = useState<SudokuGame | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [selectedCell, setSelectedCell] = useState<number | null>(null);
  const [notesMode, setNotesMode] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadGames = useCallback(async () => {
    if (!supabase || !session) {
      setLoading(false);
      return;
    }

    const { data, error: loadError } = await supabase
      .from('sudoku_games')
      .select(GAME_COLUMNS)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    if (loadError) setError(loadError.message);
    else {
      const rows = (data ?? []) as SudokuGame[];
      setGames(rows);
      const active = rows.find((row) => row.status === 'in_progress' || row.status === 'paused');
      if (active) {
        setGame(active);
        setDifficulty(active.difficulty);
      }
      setError(null);
    }
    setLoading(false);
  }, [session]);

  useEffect(() => { void loadGames(); }, [loadGames]);

  useEffect(() => {
    if (!game || game.status !== 'in_progress') return;
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [game?.id, game?.status]);

  const elapsedSeconds = game ? elapsedFor(game, now) : 0;
  const wrongCells = useMemo(() => {
    if (!game || !showErrors) return new Set<number>();
    const wrong = new Set<number>();
    for (let index = 0; index < 81; index += 1) {
      const value = game.board[index];
      if (value !== '-' && value !== game.solution[index]) wrong.add(index);
    }
    return wrong;
  }, [game, showErrors]);

  async function createGame() {
    if (!supabase || !session) return;
    if (game && (game.status === 'in_progress' || game.status === 'paused')) {
      if (!window.confirm('Abandon the current puzzle and start a new one? Your current game will remain in history.')) return;
      const { error: abandonError } = await supabase
        .from('sudoku_games')
        .update({ status: 'abandoned', elapsed_seconds: elapsedFor(game, Date.now()), timer_started_at: null })
        .eq('id', game.id)
        .eq('user_id', session.user.id);
      if (abandonError) {
        setError(abandonError.message);
        return;
      }
      setGames((current) => current.map((item) => item.id === game.id
        ? { ...item, status: 'abandoned', elapsed_seconds: elapsedFor(game, Date.now()), timer_started_at: null }
        : item));
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    const generated = getSudoku(difficulty);
    const { data, error: createError } = await supabase
      .from('sudoku_games')
      .insert({
        user_id: session.user.id,
        difficulty: generated.difficulty,
        puzzle: generated.puzzle,
        solution: generated.solution,
        board: generated.puzzle,
        notes: {},
        status: 'in_progress',
        elapsed_seconds: 0,
        timer_started_at: new Date().toISOString(),
        hints_used: 0,
        score: 0,
      })
      .select(GAME_COLUMNS)
      .single();

    if (createError) setError(createError.message);
    else {
      const newGame = data as SudokuGame;
      setGame(newGame);
      setGames((current) => [newGame, ...current.filter((item) => item.id !== newGame.id)]);
      setSelectedCell(null);
      setNotesMode(false);
      setShowErrors(false);
      setNow(Date.now());
      setNotice('New puzzle saved. Your progress is ready to resume anytime.');
    }
    setSaving(false);
  }

  async function saveGameUpdate(gameId: string, patch: Partial<SudokuGame>) {
    if (!supabase || !session) return false;
    setSaving(true);
    setError(null);
    const { data, error: updateError } = await supabase
      .from('sudoku_games')
      .update(patch)
      .eq('id', gameId)
      .eq('user_id', session.user.id)
      .select(GAME_COLUMNS)
      .single();
    if (updateError) {
      setError(`Could not save this move. Your current board is still on this screen. ${updateError.message}`);
      setSaving(false);
      return false;
    }

    const updated = data as SudokuGame;
    setGame(updated);
    setGames((current) => current.map((item) => item.id === updated.id ? updated : item));
    setSaving(false);
    return true;
  }

  async function commitBoard(gameState: SudokuGame, board: string, notes: Notes, hintsUsed = gameState.hints_used) {
    const complete = board === gameState.solution;
    const elapsed = elapsedFor(gameState, Date.now());
    const patch: Partial<SudokuGame> = { board, notes, hints_used: hintsUsed };
    if (complete) {
      patch.status = 'completed';
      patch.elapsed_seconds = elapsed;
      patch.timer_started_at = null;
      patch.completed_at = new Date().toISOString();
      patch.score = getScore({ ...gameState, hints_used: hintsUsed }, elapsed);
    }
    const saved = await saveGameUpdate(gameState.id, patch);
    if (saved && complete) setNotice(`Puzzle complete! Score: ${patch.score}.`);
    return saved;
  }

  async function enterValue(value: string) {
    if (!game || game.status !== 'in_progress' || selectedCell === null || saving) return;
    if (game.puzzle[selectedCell] !== '-') return;

    const key = String(selectedCell);
    const notes = { ...game.notes };
    const boardCells = game.board.split('');
    if (notesMode && value !== '-') {
      const cellNotes = new Set(notes[key] ?? []);
      const number = Number(value);
      if (cellNotes.has(number)) cellNotes.delete(number);
      else cellNotes.add(number);
      notes[key] = [...cellNotes].sort();
    } else {
      boardCells[selectedCell] = value;
      delete notes[key];
    }
    await commitBoard(game, boardCells.join(''), notes);
  }

  async function useHint() {
    if (!game || game.status !== 'in_progress' || saving) return;
    const target = selectedCell !== null && game.board[selectedCell] === '-'
      ? selectedCell
      : game.board.indexOf('-');
    if (target < 0) return;

    const board = game.board.split('');
    board[target] = game.solution[target];
    const notes = { ...game.notes };
    delete notes[String(target)];
    setSelectedCell(target);
    setShowErrors(false);
    await commitBoard(game, board.join(''), notes, game.hints_used + 1);
  }

  async function checkBoard() {
    if (!game) return;
    setShowErrors(true);
    if (!game.board.includes('-') && game.board === game.solution && game.status === 'in_progress') {
      const elapsed = elapsedFor(game, Date.now());
      const patch: Partial<SudokuGame> = {
        status: 'completed',
        elapsed_seconds: elapsed,
        timer_started_at: null,
        completed_at: new Date().toISOString(),
        score: getScore(game, elapsed),
      };
      const saved = await saveGameUpdate(game.id, patch);
      if (saved) setNotice(`Puzzle complete! Score: ${patch.score}.`);
    } else if (game.board.includes('-')) setNotice('There are still empty cells.');
    else setNotice('Some entries are incorrect. Incorrect cells are marked.');
  }

  async function pauseGame() {
    if (!game || game.status !== 'in_progress') return;
    const elapsed = elapsedFor(game, Date.now());
    const saved = await saveGameUpdate(game.id, { status: 'paused', elapsed_seconds: elapsed, timer_started_at: null });
    if (saved) setNotice('Puzzle paused and saved.');
  }

  async function resumeGame(selected: SudokuGame) {
    const saved = await saveGameUpdate(selected.id, { status: 'in_progress', timer_started_at: new Date().toISOString() });
    if (saved) {
      setNow(Date.now());
      setShowErrors(false);
      setNotice('Puzzle resumed.');
    }
  }

  async function handleCellKeys(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key >= '1' && event.key <= '9') {
      event.preventDefault();
      await enterValue(event.key);
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      await enterValue('-');
    } else if (selectedCell !== null && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
      event.preventDefault();
      const row = Math.floor(selectedCell / 9);
      const column = selectedCell % 9;
      const nextRow = event.key === 'ArrowUp' ? (row + 8) % 9 : event.key === 'ArrowDown' ? (row + 1) % 9 : row;
      const nextColumn = event.key === 'ArrowLeft' ? (column + 8) % 9 : event.key === 'ArrowRight' ? (column + 1) % 9 : column;
      setSelectedCell(nextRow * 9 + nextColumn);
    }
  }

  if (loading) return <main role="status">Loading your Sudoku games...</main>;

  const displayElapsed = game ? elapsedFor(game, now) : 0;
  const completedGames = games.filter((item) => item.status === 'completed');
  const activeGame = game && (game.status === 'in_progress' || game.status === 'paused');

  return (
    <main className="sudoku-page">
      <section className="sudoku-panel">
        <header className="sudoku-header">
          <div>
            <p className="sudoku-eyebrow">The Puzzle Library</p>
            <h1>Sudoku</h1>
            <p>One quiet puzzle, saved just for you.</p>
          </div>
          <div className="sudoku-header-actions">
            <label htmlFor="sudoku-difficulty">Difficulty</label>
            <select id="sudoku-difficulty" value={difficulty} onChange={(event) => setDifficulty(event.target.value as Difficulty)}>
              {DIFFICULTIES.map((level) => <option value={level} key={level}>{level[0].toUpperCase() + level.slice(1)}</option>)}
            </select>
            <button type="button" disabled={saving} onClick={() => void createGame()}>
              {activeGame ? 'New puzzle' : 'Start puzzle'}
            </button>
          </div>
        </header>

        {game ? (
          <div className="sudoku-game-layout">
            <section className="sudoku-board-section">
              <div className="sudoku-status-row">
                <span>{game.difficulty[0].toUpperCase() + game.difficulty.slice(1)}</span>
                <strong className="sudoku-timer">{formatTime(displayElapsed)}</strong>
                <span>{game.status.replace('_', ' ')}</span>
              </div>
              <div className="sudoku-board" role="grid" aria-label="Sudoku puzzle" onKeyDown={(event) => void handleCellKeys(event)}>
                {Array.from({ length: 81 }, (_, index) => {
                  const value = game.board[index];
                  const row = Math.floor(index / 9);
                  const column = index % 9;
                  const isGiven = game.puzzle[index] !== '-';
                  const related = selectedCell !== null && (
                    Math.floor(selectedCell / 9) === row
                    || selectedCell % 9 === column
                    || (Math.floor(Math.floor(selectedCell / 9) / 3) === Math.floor(row / 3)
                      && Math.floor((selectedCell % 9) / 3) === Math.floor(column / 3))
                  );
                  return (
                    <button
                      type="button"
                      role="gridcell"
                      key={index}
                      className={[
                        'sudoku-cell',
                        isGiven ? 'sudoku-cell-given' : '',
                        related ? 'sudoku-cell-related' : '',
                        selectedCell === index ? 'sudoku-cell-selected' : '',
                        wrongCells.has(index) ? 'sudoku-cell-wrong' : '',
                        column === 2 || column === 5 ? 'sudoku-cell-box-right' : '',
                        row === 2 || row === 5 ? 'sudoku-cell-box-bottom' : '',
                      ].filter(Boolean).join(' ')}
                      aria-label={`Row ${row + 1}, column ${column + 1}, ${value === '-' ? 'empty' : value}${isGiven ? ', given' : ''}`}
                      aria-selected={selectedCell === index}
                      disabled={game.status !== 'in_progress' || saving}
                      onClick={() => setSelectedCell(index)}
                    >
                      {value !== '-' ? value : (game.notes[String(index)] ?? []).length > 0 && (
                        <span className="sudoku-cell-notes">{game.notes[String(index)].join(' ')}</span>
                      )}
                    </button>
                  );
                })}
              </div>
              <p className="sudoku-save-state" role="status">{saving ? 'Saving move...' : 'Moves save automatically.'}</p>
              {error && <p role="alert" className="sudoku-feedback-error">{error}</p>}
              {notice && <p role="status" className="sudoku-feedback">{notice}</p>}
            </section>

            <aside className="sudoku-tools">
              <p className="sudoku-score">Score <strong>{game.score}</strong></p>
              <p>Hints used: {game.hints_used}</p>
              <button type="button" aria-pressed={notesMode} disabled={game.status !== 'in_progress'} onClick={() => setNotesMode((current) => !current)}>
                {notesMode ? 'Notes on' : 'Pencil notes'}
              </button>
              <div className="sudoku-number-pad" aria-label="Number pad">
                {Array.from({ length: 9 }, (_, index) => index + 1).map((number) => (
                  <button type="button" key={number} disabled={game.status !== 'in_progress' || saving} onClick={() => void enterValue(String(number))}>{number}</button>
                ))}
                <button className="sudoku-erase-button" type="button" disabled={game.status !== 'in_progress' || saving} onClick={() => void enterValue('-')}>Erase cell</button>
              </div>
              <div className="sudoku-action-list">
                <button type="button" disabled={game.status !== 'in_progress' || saving} onClick={() => void useHint()}>Use hint</button>
                <button type="button" disabled={game.status !== 'in_progress' || saving} onClick={() => void checkBoard()}>Check puzzle</button>
                {game.status === 'in_progress' && <button type="button" disabled={saving} onClick={() => void pauseGame()}>Pause</button>}
                {game.status === 'paused' && <button type="button" disabled={saving} onClick={() => void resumeGame(game)}>Resume</button>}
              </div>
            </aside>
          </div>
        ) : <p>Start a new puzzle to begin.</p>}

        {completedGames.length > 0 && (
          <section className="sudoku-history">
            <h2>Completed puzzles</h2>
            <ul>
              {completedGames.slice(0, 10).map((completed) => (
                <li key={completed.id}>
                  <span>{completed.difficulty[0].toUpperCase() + completed.difficulty.slice(1)} · {new Date(completed.created_at).toLocaleDateString()}</span>
                  <span>{formatTime(completed.elapsed_seconds)} · {completed.score} points</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
}
