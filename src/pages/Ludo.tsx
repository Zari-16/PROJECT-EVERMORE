import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type PlayerTokens = Record<string, number[]>;
type LudoGameState = {
  players: string[];
  tokens: PlayerTokens;
  current_player: string;
  dice: number | null;
  last_roll: number | null;
  six_streak: number;
  last_action: string;
};
type LudoGame = {
  id: string;
  space_id: string;
  game_state: LudoGameState;
  status: 'active' | 'completed' | 'abandoned';
  winner: string | null;
  created_at: string;
  completed_at: string | null;
};
type LudoHistory = {
  id: string;
  status: string;
  winner: string | null;
  created_at: string;
  completed_at: string | null;
};
type LudoPayload = { game: LudoGame | null; history: LudoHistory[]; my_id: string };
type BoardPoint = { x: number; y: number };

const TRACK: BoardPoint[] = [
  ...Array.from({ length: 13 }, (_, index) => ({ x: index + 1, y: 0 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 14, y: index + 1 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 13 - index, y: 14 })),
  ...Array.from({ length: 13 }, (_, index) => ({ x: 0, y: 13 - index })),
];
const SAFE_SPACES = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
const HOME_LANES: Record<number, BoardPoint[]> = {
  0: Array.from({ length: 6 }, (_, index) => ({ x: index + 1, y: index + 1 })),
  1: Array.from({ length: 6 }, (_, index) => ({ x: 13 - index, y: 13 - index })),
};
const YARDS: Record<number, BoardPoint[]> = {
  0: [{ x: 2, y: 2 }, { x: 4, y: 2 }, { x: 2, y: 4 }, { x: 4, y: 4 }],
  1: [{ x: 10, y: 10 }, { x: 12, y: 10 }, { x: 10, y: 12 }, { x: 12, y: 12 }],
};
const PLAYER_NAMES = ['Rose', 'Moon'];
const PLAYER_COLORS = ['#b94b63', '#536f9e'];
const GAME_COLUMNS = 'id,space_id,game_state,status,winner,created_at,completed_at';

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? (data[0] as T | undefined) ?? null : null;
}

function pointForToken(playerIndex: number, tokenIndex: number, progress: number): BoardPoint {
  if (progress < 0) return YARDS[playerIndex][tokenIndex];
  if (progress >= 58) return { x: 7, y: 7 };
  if (progress >= 52) return HOME_LANES[playerIndex][progress - 52];
  const startOffset = playerIndex === 0 ? 0 : 26;
  return TRACK[(startOffset + progress) % 52];
}

function tokenOffset(tokenIndex: number) {
  return [
    { x: -6, y: -6 }, { x: 6, y: -6 }, { x: -6, y: 6 }, { x: 6, y: 6 },
  ][tokenIndex];
}

function svgPoint(point: BoardPoint) {
  return { x: 20 + point.x * 40, y: 20 + point.y * 40 };
}

export default function Ludo() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [state, setState] = useState<LudoPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [isRolling, setIsRolling] = useState(false);
  const [animatedRoll, setAnimatedRoll] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!supabase) return;
    const { data, error: stateError } = await supabase.rpc('get_ludo_state');
    if (stateError) setError(stateError.message);
    else {
      const payload = data as LudoPayload;
      setState(payload);
      setAnimatedRoll(payload.game?.game_state.last_roll ?? 1);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to play Ludo.');
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
      .channel(`ludo:${spaceId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'ludo_games',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadState(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [spaceId, loadState]);

  useEffect(() => {
    if (!isRolling) return;
    const timer = window.setInterval(() => {
      setAnimatedRoll((current) => current === 6 ? 1 : current + 1);
    }, 90);
    return () => window.clearInterval(timer);
  }, [isRolling]);

  const game = state?.game?.status === 'active' ? state.game : null;
  const players = game?.game_state.players ?? [];
  const currentPlayer = game?.game_state.current_player;
  const myPlayerIndex = players.findIndex((player) => player === session?.user.id);
  const myTurn = currentPlayer === session?.user.id;
  const myTokens = myPlayerIndex >= 0 ? game?.game_state.tokens[players[myPlayerIndex]] ?? [-1, -1, -1, -1] : [];
  const dice = game?.game_state.dice ?? null;
  const legalToken = (position: number) => dice !== null && (
    (position === -1 && dice === 6)
    || (position >= 0 && position < 58 && position + dice <= 58)
  );

  async function startGame() {
    if (!supabase) return;
    if (game && !window.confirm('Abandon the current match and start a new one?')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (game) {
      const { error: abandonError } = await supabase.rpc('abandon_ludo_game');
      if (abandonError) {
        setError(abandonError.message);
        setBusy(false);
        return;
      }
    }
    const { error: startError } = await supabase.rpc('start_ludo_game');
    if (startError) setError(startError.message);
    else {
      setNotice('Ludo match started. Roll a six to leave your yard.');
      await loadState();
    }
    setBusy(false);
  }

  async function rollDice() {
    if (!supabase) return;
    setBusy(true);
    setIsRolling(true);
    setAnimatedRoll(1);
    setError(null);
    setNotice(null);
    const { data, error: rollError } = await supabase.rpc('roll_ludo_dice');
    if (rollError) {
      setError(rollError.message);
      setIsRolling(false);
    }
    else {
      const next = data as LudoGameState;
      if (next.last_roll !== null) setAnimatedRoll(next.last_roll);
      setIsRolling(false);
      setNotice(next.last_action || `You rolled ${next.last_roll}.`);
      await loadState();
    }
    setBusy(false);
  }

  async function moveToken(index: number) {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: moveError } = await supabase.rpc('move_ludo_token', { p_token_index: index });
    if (moveError) setError(moveError.message);
    else {
      const next = data as LudoGameState;
      setNotice(next.last_action || 'Token moved.');
      await loadState();
    }
    setBusy(false);
  }

  function renderToken(playerIndex: number, tokenIndex: number, progress: number, clickable: boolean) {
    const point = pointForToken(playerIndex, tokenIndex, progress);
    const offset = progress < 0 ? { x: 0, y: 0 } : tokenOffset(tokenIndex);
    const center = svgPoint({ x: point.x + offset.x / 40, y: point.y + offset.y / 40 });
    const canMove = clickable && myTurn && legalToken(progress) && !busy;
    return (
      <g
        className={canMove ? 'ludo-token ludo-token-ready' : 'ludo-token'}
        key={`${playerIndex}-${tokenIndex}`}
        role={clickable ? 'button' : undefined}
        tabIndex={canMove ? 0 : -1}
        aria-label={`${PLAYER_NAMES[playerIndex]} token ${tokenIndex + 1}, ${progress < 0 ? 'in yard' : progress >= 58 ? 'home' : `${progress} steps`}`}
        onClick={canMove ? () => void moveToken(tokenIndex) : undefined}
        onKeyDown={canMove ? (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); void moveToken(tokenIndex); } } : undefined}
      >
        <circle cx={center.x} cy={center.y} r="12" fill={PLAYER_COLORS[playerIndex]} stroke="white" strokeWidth="2" />
        <text x={center.x} y={center.y + 4} textAnchor="middle" fill="white" fontSize="10" fontWeight="700">{tokenIndex + 1}</text>
      </g>
    );
  }

  if (loading) return <main role="status">Loading Ludo...</main>;

  return (
    <main className="ludo-page">
      <section className="ludo-panel">
        <header className="ludo-header">
          <div>
            <p className="game-eyebrow">A two-player race home</p>
            <h1>Ludo</h1>
            <p>Roll a six to leave the yard. Land on your partner to send a token home. Safe spaces protect tokens.</p>
          </div>
          <button type="button" disabled={busy || !spaceId} onClick={() => void startGame()}>{game ? 'Restart match' : 'New match'}</button>
        </header>

        {!spaceId ? <p>Pair two accounts to play Ludo. <a href={`${import.meta.env.BASE_URL}pairing`}>Go to Pairing</a></p> : game ? (
          <>
            <div className="ludo-game-bar">
              <p role="status">{myTurn ? 'Your turn' : 'Partner turn'}{dice !== null ? ` · Dice ${dice}` : ''}{game.game_state.last_action ? ` · ${game.game_state.last_action}` : ''}</p>
              <div className={`ludo-dice-display${isRolling ? ' is-rolling' : ''}`} aria-live="polite">
                <span className="ludo-die-value">{isRolling ? animatedRoll : dice ?? (game.game_state.last_roll ?? '·')}</span>
                <span>{isRolling ? 'Rolling' : dice !== null ? 'Rolled' : game.game_state.last_roll !== null ? 'Last roll' : 'Dice'}</span>
              </div>
              {myTurn && dice === null && <button type="button" disabled={busy} onClick={() => void rollDice()}>Roll dice</button>}
            </div>

            <div className="ludo-board-wrap">
              <svg className="ludo-board" viewBox="0 0 600 600" role="img" aria-label="Two-player Ludo board">
                <rect x="1" y="1" width="598" height="598" rx="18" className="ludo-board-ground" />
                <rect x="40" y="40" width="200" height="200" rx="18" fill="#f5dce2" className="ludo-yard" />
                <rect x="360" y="360" width="200" height="200" rx="18" fill="#dce7f4" className="ludo-yard" />
                {[...Array(52)].map((_, index) => {
                  const point = svgPoint(TRACK[index]);
                  const safe = SAFE_SPACES.has(index);
                  return <rect key={index} x={point.x - 17} y={point.y - 17} width="34" height="34" rx="4" className={`ludo-track-cell${safe ? ' ludo-track-safe' : ''}`} />;
                })}
                {HOME_LANES[0].map((point, index) => {
                  const center = svgPoint(point);
                  return <rect key={`rose-home-${index}`} x={center.x - 17} y={center.y - 17} width="34" height="34" rx="4" className="ludo-home-rose" />;
                })}
                {HOME_LANES[1].map((point, index) => {
                  const center = svgPoint(point);
                  return <rect key={`moon-home-${index}`} x={center.x - 17} y={center.y - 17} width="34" height="34" rx="4" className="ludo-home-moon" />;
                })}
                <path d="M260 260h80v80h-80z" className="ludo-home-center" />
                {players.map((player, playerIndex) => {
                  const tokens = game.game_state.tokens[player] ?? [-1, -1, -1, -1];
                  return tokens.map((progress, tokenIndex) => renderToken(playerIndex, tokenIndex, progress, player === session?.user.id));
                })}
              </svg>
            </div>

            <div className="ludo-controls">
              <div><strong>Rose</strong><span>{players[0] === session?.user.id ? 'You' : 'Partner'} · {game.game_state.tokens[players[0]]?.filter((position) => position === 58).length ?? 0} home</span></div>
              <div><strong>Moon</strong><span>{players[1] === session?.user.id ? 'You' : 'Partner'} · {game.game_state.tokens[players[1]]?.filter((position) => position === 58).length ?? 0} home</span></div>
              {myTurn && dice !== null && <p>Select one of your highlighted tokens to move.</p>}
            </div>
          </>
        ) : (
          <section className="game-ready">
            <p>{state?.game?.status === 'completed' ? 'Your last match is complete.' : 'Ready to race home?'}</p>
            <button type="button" disabled={busy} onClick={() => void startGame()}>Start a two-player match</button>
          </section>
        )}

        {error && <p className="card-game-feedback" role="alert">{error}</p>}
        {notice && <p className="card-game-feedback" role="status">{notice}</p>}
        {state?.history && state.history.length > 0 && (
          <section className="card-game-history">
            <h2>Recent matches</h2>
            <ul>{state.history.slice(0, 8).map((item) => (
              <li key={item.id}><span>{item.status === 'completed' ? item.winner === session?.user.id ? 'You won' : 'Partner won' : item.status}</span><span>{new Date(item.created_at).toLocaleDateString()}</span></li>
            ))}</ul>
          </section>
        )}
      </section>
    </main>
  );
}
