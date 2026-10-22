import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type CardColor = 'rose' | 'moss' | 'moon' | 'ember';
type PlayingCard = { id: string; color: CardColor | null; kind: string; value: string };
type PublicGame = {
  id: string;
  status: 'active' | 'completed' | 'abandoned';
  winner: string | null;
  winner_score: number;
  my_id: string;
  opponent_id: string;
  my_hand: PlayingCard[];
  opponent_count: number;
  top_card: PlayingCard | null;
  draw_count: number;
  current_player: string;
  pending_draw: number;
  created_at: string;
  completed_at: string | null;
};
type GameHistory = {
  game_id: string;
  status: string;
  winner: string | null;
  winner_score: number;
  created_at: string;
  completed_at: string | null;
};
type PublicState = { game: PublicGame | null; history: GameHistory[] };

const CARD_COLORS: CardColor[] = ['rose', 'moss', 'moon', 'ember'];
const COLOR_NAMES: Record<CardColor, string> = {
  rose: 'Rose', moss: 'Moss', moon: 'Moon', ember: 'Ember',
};

function cardLabel(card: PlayingCard) {
  if (card.kind === 'number') return `${card.color ? COLOR_NAMES[card.color] : ''} ${card.value}`.trim();
  return `${card.color ? `${COLOR_NAMES[card.color]} ` : ''}${card.kind.replace('_', ' ')}`.trim();
}

function CardEmblem({ color }: { color: PlayingCard['color'] }) {
  if (color === 'rose') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g className="card-emblem-rose">
          <path d="M31 35c-2 9-3 17-2 24m2-15c-9-8-17-6-18 0 7 6 13 6 18 3m1-8c8-9 16-8 18-2-6 7-12 9-18 6" />
          <path d="M31 34c-12-1-18-8-14-15 5-8 12-4 15 1 5-10 14-9 16-2 2 8-5 14-17 16Z" />
          <path d="M30 32c-5-6-2-12 3-12 5 0 7 6 2 12m-5-2c7-3 12 1 9 6-3 4-9 2-9-4" />
        </g>
      </svg>
    );
  }
  if (color === 'moss') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g className="card-emblem-moss">
          <path d="M13 49C17 24 33 12 53 12 52 33 40 48 13 49Z" />
          <path d="M14 50c11-13 21-22 35-32m-19 17-2-12m11 4 9 1" />
        </g>
      </svg>
    );
  }
  if (color === 'moon') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <path className="card-emblem-moon" d="M43 10c-3 4-5 9-5 15 0 14 11 25 25 26-5 5-12 8-20 8-17 0-30-13-30-30S26-1 43 10Z" transform="translate(-5 0)" />
        <path className="card-emblem-star" d="m47 12 2 5 5 2-5 2-2 5-2-5-5-2 5-2 2-5Zm-28 29 1.5 3.5L24 46l-3.5 1.5L19 51l-1.5-3.5L14 46l3.5-1.5L19 41Z" />
      </svg>
    );
  }
  if (color === 'ember') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g className="card-emblem-ember">
          <path d="M31 5h3v12h-3zM31 47h3v12h-3zM5 31h12v3H5zm42 0h12v3H47zM12 12l2-2 9 9-2 2zm29 29 2-2 9 9-2 2zM50 12l2 2-9 9-2-2zM21 41l2 2-9 9-2-2z" />
          <circle cx="32" cy="32" r="12" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <path className="card-emblem-wild" d="M32 6 43 21 60 18 53 34 62 47 44 47 32 60 21 46 4 49 11 33 3 19 21 20 32 6Z" />
      <path className="card-emblem-wild-cut" d="m32 16 6 13 13 3-13 4-6 13-5-13-13-4 13-3 5-13Z" />
    </svg>
  );
}

export default function HeartAndHollow() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [state, setState] = useState<PublicState>({ game: null, history: [] });
  const [wildColor, setWildColor] = useState<CardColor>('rose');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!supabase) return;
    const { data, error: stateError } = await supabase.rpc('get_heart_hollow_state');
    if (stateError) setError(stateError.message);
    else setState(data as PublicState);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to open the games library.');
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
      .channel(`heart-hollow:${spaceId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'card_game_status',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadState(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [spaceId, loadState]);

  const activeGame = state.game?.status === 'active' ? state.game : null;
  const isMyTurn = activeGame?.current_player === session?.user.id;

  async function runAction(action: () => Promise<{ error: { message: string } | null }>, success: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    const result = await action();
    if (result.error) setError(result.error.message);
    else {
      setNotice(success);
      await loadState();
    }
    setBusy(false);
  }

  async function startGame() {
    if (!supabase) return;
    if (activeGame && !window.confirm('Abandon the current game and start a new one?')) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    if (activeGame) {
      const { error: abandonError } = await supabase.rpc('abandon_heart_hollow_game');
      if (abandonError) {
        setError(abandonError.message);
        setBusy(false);
        return;
      }
    }
    const { error: startError } = await supabase.rpc('start_heart_hollow_game');
    if (startError) setError(startError.message);
    else {
      setNotice('A new game has begun.');
      await loadState();
    }
    setBusy(false);
  }

  async function playCard(card: PlayingCard) {
    if (!supabase || !activeGame) return;
    const wild = card.kind === 'wild' || card.kind === 'wild_four';
    await runAction(
      async () => await supabase!.rpc('play_heart_hollow_card', {
          p_card_id: card.id,
          p_wild_color: wild ? wildColor : null,
        }),
      'Card played.',
    );
  }

  async function drawCards() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { data, error: drawError } = await supabase.rpc('draw_heart_hollow_cards');
    if (drawError) setError(drawError.message);
    else {
      setNotice(`Drew ${data} card${data === 1 ? '' : 's'}. Turn passed.`);
      await loadState();
    }
    setBusy(false);
  }

  if (loading) return <main role="status">Opening Heart & Hollow...</main>;

  return (
    <main className="card-game-page">
      <section className="card-game-panel">
        <header className="card-game-header">
          <div>
            <p className="game-eyebrow">A two-player color-and-number game</p>
            <h1>Heart & Hollow</h1>
            <p>Match a color or number. First hand empty wins.</p>
          </div>
          <button type="button" disabled={busy || !spaceId} onClick={() => void startGame()}>
            {activeGame ? 'Restart game' : 'New game'}
          </button>
        </header>

        {!spaceId ? (
          <p>Pair two accounts to play. <a href={`${import.meta.env.BASE_URL}pairing`}>Go to Pairing</a></p>
        ) : activeGame ? (
          <>
            <section className="card-game-status" aria-live="polite">
              <div><span>Your hand</span><strong>{activeGame.my_hand.length}</strong></div>
              <div><span>Partner hand</span><strong>{activeGame.opponent_count}</strong></div>
              <div><span>Draw pile</span><strong>{activeGame.draw_count}</strong></div>
              <p>{isMyTurn ? 'Your turn' : 'Waiting for your partner'}{activeGame.pending_draw > 0 ? ` · Draw ${activeGame.pending_draw}` : ''}</p>
            </section>

            <section className="card-table" aria-label="Card table">
              <div>
                <span className="card-table-label">Top card</span>
                {activeGame.top_card && <span className={`playing-card playing-card-${activeGame.top_card.color ?? 'wild'}`}>
                  <CardEmblem color={activeGame.top_card.color} />
                  <strong className="playing-card-label">{cardLabel(activeGame.top_card)}</strong>
                </span>}
              </div>
              <button className="draw-pile" type="button" disabled={busy || !isMyTurn} onClick={() => void drawCards()}>
                Draw {activeGame.pending_draw > 0 ? activeGame.pending_draw : 1}
                <small>{activeGame.draw_count} remaining</small>
              </button>
            </section>

            {isMyTurn && activeGame.my_hand.some((card) => card.kind === 'wild' || card.kind === 'wild_four') && (
              <label className="wild-color-picker">Wild color
                <select value={wildColor} onChange={(event) => setWildColor(event.target.value as CardColor)}>
                  {CARD_COLORS.map((color) => <option key={color} value={color}>{COLOR_NAMES[color]}</option>)}
                </select>
              </label>
            )}

            <section className="player-hand" aria-label="Your cards">
              <h2>Your hand</h2>
              <div className="player-hand-cards">
                {activeGame.my_hand.map((card) => (
                  <button
                    className={`playing-card playing-card-${card.color ?? 'wild'}`}
                    type="button"
                    disabled={busy || !isMyTurn}
                    key={card.id}
                    onClick={() => void playCard(card)}
                    aria-label={`Play ${cardLabel(card)}`}
                  >
                    <CardEmblem color={card.color} />
                    <strong className="playing-card-label">{cardLabel(card)}</strong>
                  </button>
                ))}
              </div>
            </section>
          </>
        ) : (
          <section className="game-ready">
            <p>{state.game?.status === 'completed' ? 'Your last game is complete.' : 'Ready for a round?'}</p>
            <button type="button" disabled={busy} onClick={() => void startGame()}>Start a two-player game</button>
          </section>
        )}

        {error && <p className="card-game-feedback" role="alert">{error}</p>}
        {notice && <p className="card-game-feedback" role="status">{notice}</p>}

        {state.history.length > 0 && (
          <section className="card-game-history">
            <h2>Recent games</h2>
            <ul>
              {state.history.map((item) => (
                <li key={item.game_id}>
                  <span>{item.status === 'completed' ? item.winner === session?.user.id ? 'You won' : 'Partner won' : item.status}</span>
                  <span>{item.status === 'completed' ? `${item.winner_score} points · ` : ''}{new Date(item.created_at).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </section>
    </main>
  );
}
