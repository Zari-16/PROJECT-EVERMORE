import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type Point = { x: number; y: number };
type Direction = 'up' | 'down' | 'left' | 'right';
type SnakeGameState = {
  players: string[];
  phase: 'active' | 'completed';
  snake: Point[];
  direction: Direction;
  next_direction: Direction;
  food: Point;
  score: number;
  tick: number;
  last_tick_at: string | null;
  last_action: string;
};
type SnakeGame = {
  id: string;
  space_id: string;
  game_state: SnakeGameState;
  status: 'active' | 'completed' | 'abandoned';
};
type SnakePayload = { game: SnakeGame | null; my_id: string };

const BOARD_SIZE = 20;
const DIRECTIONS: { direction: Direction; label: string; icon: string }[] = [
  { direction: 'up', label: 'Up', icon: '↑' },
  { direction: 'left', label: 'Left', icon: '←' },
  { direction: 'down', label: 'Down', icon: '↓' },
  { direction: 'right', label: 'Right', icon: '→' },
];

export default function Snake() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [state, setState] = useState<SnakePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ticking = useRef(false);

  const loadState = useCallback(async () => {
    if (!supabase) return;
    const { data, error: stateError } = await supabase.rpc('get_snake_state');
    if (stateError) setError(stateError.message);
    else setState(data as SnakePayload);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to play Snake.');
      setLoading(false);
      return;
    }
    let active = true;
    const client = supabase;
    async function loadSpace() {
      const { data, error: spaceError } = await client.rpc('get_my_space');
      if (!active) return;
      if (spaceError) setError(spaceError.message);
      else {
        const rows = Array.isArray(data) ? data as { space_id: string }[] : [];
        setSpaceId(rows[0]?.space_id ?? null);
      }
      await loadState();
    }
    void loadSpace();
    return () => { active = false; };
  }, [session, loadState]);

  useEffect(() => {
    if (!supabase || !spaceId) return;
    const client = supabase;
    const channel = client
      .channel(`snake:${spaceId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'snake_games',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadState(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [spaceId, loadState]);

  const game = state?.game ?? null;
  const gameState = game?.game_state;
  const active = game?.status === 'active' && gameState?.phase === 'active';

  useEffect(() => {
    if (!active || !supabase || ticking.current) return;
    const client = supabase;
    const interval = window.setInterval(() => {
      if (ticking.current) return;
      ticking.current = true;
      void (async () => {
        try {
          const { error: advanceError } = await client.rpc('advance_snake_game');
          if (advanceError) setError(advanceError.message);
          else await loadState();
        } finally {
          ticking.current = false;
        }
      })();
    }, 300);
    return () => window.clearInterval(interval);
  }, [active, game?.id, loadState]);

  async function startGame() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: startError } = await supabase.rpc('start_snake_game');
    if (startError) setError(startError.message);
    else await loadState();
    setBusy(false);
  }

  async function endGame() {
    if (!supabase || !window.confirm('End this shared Snake game for both of you?')) return;
    setBusy(true);
    setError(null);
    const { error: endError } = await supabase.rpc('end_snake_game');
    if (endError) setError(endError.message);
    else await loadState();
    setBusy(false);
  }

  async function setDirection(direction: Direction) {
    if (!supabase || !active) return;
    const { error: directionError } = await supabase.rpc('set_snake_direction', { p_direction: direction });
    if (directionError) setError(directionError.message);
    else setError(null);
  }

  function handleBoardKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const directionByKey: Record<string, Direction> = {
      ArrowUp: 'up', w: 'up', W: 'up',
      ArrowDown: 'down', s: 'down', S: 'down',
      ArrowLeft: 'left', a: 'left', A: 'left',
      ArrowRight: 'right', d: 'right', D: 'right',
    };
    const direction = directionByKey[event.key];
    if (direction) {
      event.preventDefault();
      void setDirection(direction);
    }
  }

  if (loading) return <main role="status">Opening Snake...</main>;

  return (
    <main className="snake-page">
      <section className="snake-panel">
        <header className="snake-header">
          <div>
            <p className="games-eyebrow">One snake, two gardeners</p>
            <h1>Snake</h1>
            <p>Steer together, gather blossoms, and see how long your shared snake can grow.</p>
          </div>
          {active && (
            <div className="snake-header-actions">
              <p className="snake-score"><strong>{gameState.score}</strong><span>blossoms</span></p>
              <button className="snake-end-button" type="button" disabled={busy} onClick={() => void endGame()}>End game</button>
            </div>
          )}
        </header>

        {!spaceId ? (
          <p>Pair two accounts to play. <Link to="/pairing">Go to Pairing</Link></p>
        ) : !active ? (
          <section className="snake-ready-panel">
            {game?.status === 'completed' ? <p>Garden over. You gathered <strong>{game.game_state.score}</strong> blossoms together.</p>
              : game?.status === 'abandoned' ? <p>Your last garden was put away. Ready to grow a new one?</p>
                : <p>Take turns steering the same snake. Collect blossoms and avoid the garden edge and your own tail.</p>}
            <button type="button" disabled={busy} onClick={() => void startGame()}>{busy ? 'Planting the garden...' : 'Start a shared game'}</button>
          </section>
        ) : gameState ? (
          <>
            <div
              className="snake-board"
              role="grid"
              aria-label="Shared Snake game board. Use arrow keys or WASD to steer."
              tabIndex={0}
              onKeyDown={handleBoardKeyDown}
            >
              {Array.from({ length: BOARD_SIZE * BOARD_SIZE }, (_, index) => {
                const x = index % BOARD_SIZE;
                const y = Math.floor(index / BOARD_SIZE);
                const snakeIndex = gameState.snake.findIndex((point) => point.x === x && point.y === y);
                const isFood = gameState.food.x === x && gameState.food.y === y;
                const cellClass = snakeIndex === 0 ? 'snake-cell snake-head'
                  : snakeIndex > 0 ? 'snake-cell snake-body'
                    : isFood ? 'snake-cell snake-food' : 'snake-cell';
                return (
                  <div className={cellClass} role="gridcell" key={`${x}-${y}`} aria-label={snakeIndex === 0 ? 'Snake head' : snakeIndex > 0 ? 'Snake body' : isFood ? 'Blossom' : undefined}>
                    {snakeIndex === 0 ? <span aria-hidden="true">✦</span> : isFood ? <span aria-hidden="true">✿</span> : null}
                  </div>
                );
              })}
            </div>

            <div className="snake-game-bar">
              <p role="status">{gameState.last_action}</p>
              <p>{gameState.snake.length} segments · Both of you can steer</p>
            </div>

            <div className="snake-controls" aria-label="Steering controls">
              {DIRECTIONS.map(({ direction, label, icon }) => (
                <button type="button" key={direction} title={`Steer ${label.toLowerCase()}`} aria-label={`Steer ${label.toLowerCase()}`} disabled={!active} onClick={() => void setDirection(direction)}>{icon}</button>
              ))}
            </div>
          </>
        ) : null}

        {error && <p className="card-game-feedback" role="alert">{error}</p>}
        <p className="snake-footnote">A shared game with shared controls. No rush, and you can end the round whenever you like.</p>
      </section>
    </main>
  );
}
