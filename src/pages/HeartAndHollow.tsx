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
        <g className="card-emblem-lines card-emblem-rose-lines">
          <path d="M32 31c-10-4-13-12-8-17 5-5 12 0 8 14 5-13 13-16 17-10 4 7-3 13-16 15 14-1 20 5 16 11-4 7-12 3-17-9 4 13 0 21-7 18-7-3-5-12 7-19-12 8-21 6-20-2 1-8 10-9 20-1Z" />
          <circle cx="32" cy="31" r="3" />
          <path d="M32 39c-1 7-1 13 0 20" />
          <path d="M31 49c-7-7-13-7-16-2 4 6 9 7 16 2Zm1 6c6-6 12-6 15-1-4 5-9 6-15 1Z" />
        </g>
      </svg>
    );
  }
  if (color === 'moss') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g className="card-emblem-lines card-emblem-moss-lines">
          <path d="M10 52C10 27 25 11 54 10 53 36 37 52 10 52Z" />
          <path d="M11 52c12-15 25-28 42-41M25 38l-2-12m12 2 1-11m0 25 12-1" />
        </g>
      </svg>
    );
  }
  if (color === 'moon') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g className="card-emblem-lines card-emblem-moon-lines">
          <path d="M43 8C26 11 16 25 19 40c3 16 20 24 35 16-8 1-16-2-21-8-8-9-8-23 0-32 3-4 6-6 10-8Z" />
          <path d="m47 11 1 4 4 1-4 1-1 4-1-4-4-1 4-1 1-4Zm-29 31 1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3Z" />
        </g>
      </svg>
    );
  }
  if (color === 'ember') {
    return (
      <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
        <g className="card-emblem-lines card-emblem-ember-lines">
          <circle cx="32" cy="32" r="12" />
          <path d="M32 5v10m0 34v10M5 32h10m34 0h10M13 13l7 7m24 24 7 7m0-38-7 7m-24 24-7 7" />
        </g>
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
      <g className="card-emblem-lines card-emblem-wild-lines">
        <path d="M32 7 41 23 58 32 41 41 32 57 23 41 6 32 23 23 32 7Z" />
        <path d="M32 19v26M19 32h26M24 24l16 16m0-16L24 40" />
      </g>
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
