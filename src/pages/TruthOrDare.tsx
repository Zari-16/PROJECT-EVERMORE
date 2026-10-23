import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type TruthDareGameState = {
  players: string[];
  phase: 'spin' | 'selected' | 'drawn';
  selected_player: string | null;
  prompt_type: 'truth' | 'dare' | null;
  prompt_text: string | null;
  round_number: number;
  last_action: string;
};
type TruthDareGame = {
  id: string;
  space_id: string;
  game_state: TruthDareGameState;
  status: 'active' | 'abandoned';
};
type TruthDarePayload = { game: TruthDareGame | null; my_id: string };

function pause(duration: number) {
  return new Promise((resolve) => window.setTimeout(resolve, duration));
}

export default function TruthOrDare() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [state, setState] = useState<TruthDarePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [spinning, setSpinning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadState = useCallback(async () => {
    if (!supabase) return;
    const { data, error: stateError } = await supabase.rpc('get_truth_dare_state');
    if (stateError) setError(stateError.message);
    else setState(data as TruthDarePayload);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to play.');
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
      .channel(`truth-dare:${spaceId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'truth_dare_games',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadState(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [spaceId, loadState]);

  const game = state?.game?.status === 'active' ? state.game : null;
  const gameState = game?.game_state;
  const players = gameState?.players ?? [];
  const myId = session?.user.id;
  const selectedPlayer = gameState?.selected_player;
  const selectedIndex = players.findIndex((player) => player === selectedPlayer);
  const isSelectedPlayer = selectedPlayer === myId;
  const playerLabel = (playerId: string | null | undefined) => playerId === myId ? 'You' : 'Your partner';

  async function startGame() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: startError } = await supabase.rpc('start_truth_dare_game');
    if (startError) setError(startError.message);
    else await loadState();
    setBusy(false);
  }

  async function spinBottle() {
    if (!supabase) return;
    setBusy(true);
    setSpinning(true);
    setError(null);
    const started = Date.now();
    const { error: spinError } = await supabase.rpc('spin_truth_dare_bottle');
    await pause(Math.max(0, 1600 - (Date.now() - started)));
    if (spinError) setError(spinError.message);
    else await loadState();
    setSpinning(false);
    setBusy(false);
  }

  async function readyForPrompt() {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: readyError } = await supabase.rpc('ready_truth_dare_prompt');
    if (readyError) setError(readyError.message);
    else await loadState();
    setBusy(false);
  }

  async function finishTurn(skipped: boolean) {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: finishError } = await supabase.rpc('finish_truth_dare_turn', { p_skipped: skipped });
    if (finishError) setError(finishError.message);
    else await loadState();
    setBusy(false);
  }

  async function endGame() {
    if (!supabase || !window.confirm('End this game for both of you?')) return;
    setBusy(true);
    setError(null);
    const { error: endError } = await supabase.rpc('end_truth_dare_game');
    if (endError) setError(endError.message);
    else await loadState();
    setBusy(false);
  }

  if (loading) return <main role="status">Opening the bottle game...</main>;

  return (
    <main className="truth-dare-page">
      <section className="truth-dare-panel">
        <header className="truth-dare-header">
          <div>
            <p className="games-eyebrow">A tiny game of chance</p>
            <h1>Truth or Dare, with a twist</h1>
            <p>The bottle picks who goes. Then the game picks truth or dare. Sweet, silly, and never spicy.</p>
          </div>
          {gameState && (
            <div className="truth-dare-header-actions">
              <p className="truth-dare-round">Round {gameState.round_number}</p>
              <button type="button" className="truth-dare-end" disabled={busy} onClick={() => void endGame()}>End game</button>
            </div>
          )}
        </header>

        {!spaceId ? (
          <p>Pair two accounts to play. <Link to="/pairing">Go to Pairing</Link></p>
        ) : !game ? (
          <section className="truth-dare-ready-panel">
            <div className="truth-dare-seats" aria-label="Two players">
              <div><span aria-hidden="true">✿</span><strong>You</strong></div>
              <div><span aria-hidden="true">☾</span><strong>Your partner</strong></div>
            </div>
            <p>Take turns spinning. The chosen player decides when they are ready for a prompt.</p>
            <button type="button" disabled={busy} onClick={() => void startGame()}>
              {busy ? 'Setting the table...' : 'Start our game'}
            </button>
          </section>
        ) : (
          <>
            <div className="truth-dare-stage">
              <div className={`truth-dare-seat${selectedIndex === 0 ? ' is-selected' : ''}`}>
                <span aria-hidden="true">✿</span>
                <strong>{playerLabel(players[0] ?? null)}</strong>
                {selectedIndex === 0 && <small>Chosen</small>}
              </div>
              <div className="truth-dare-bottle-wrap">
                <div className={`truth-dare-bottle${spinning ? ' is-spinning' : ''}${selectedIndex >= 0 && !spinning ? ` points-${selectedIndex}` : ''}`} aria-label={spinning ? 'Bottle spinning' : selectedIndex >= 0 ? `Bottle chose ${playerLabel(selectedPlayer)}` : 'Bottle ready'} role="img">
                  <span className="truth-dare-bottle-neck" />
                  <span className="truth-dare-bottle-body"><span>✦</span></span>
                </div>
              </div>
              <div className={`truth-dare-seat${selectedIndex === 1 ? ' is-selected' : ''}`}>
                <span aria-hidden="true">☾</span>
                <strong>{playerLabel(players[1] ?? null)}</strong>
                {selectedIndex === 1 && <small>Chosen</small>}
              </div>
            </div>

            {gameState?.phase === 'spin' && (
              <section className="truth-dare-turn-panel">
                <p>{gameState.last_action || 'Ready when you are.'}</p>
                <button type="button" disabled={busy} onClick={() => void spinBottle()}>
                  {spinning ? 'Spinning...' : 'Spin the bottle'}
                </button>
              </section>
            )}

            {gameState?.phase === 'selected' && (
              <section className="truth-dare-turn-panel" aria-live="polite">
                <h2>{isSelectedPlayer ? 'The bottle chose you!' : 'The bottle chose your partner!'}</h2>
                <p>{isSelectedPlayer ? 'Take a breath, then press Ready for your random prompt.' : 'Your partner will press Ready when they are set.'}</p>
                {isSelectedPlayer && <button type="button" disabled={busy} onClick={() => void readyForPrompt()}>{busy ? 'Choosing...' : 'Ready'}</button>}
              </section>
            )}

            {gameState?.phase === 'drawn' && (
              <section className={`truth-dare-prompt${gameState.prompt_type === 'dare' ? ' is-dare' : ''}`} aria-live="polite">
                <p className="truth-dare-prompt-type">{gameState.prompt_type === 'truth' ? 'A little truth' : 'A playful dare'}</p>
                <h2>{gameState.prompt_text}</h2>
                <p>{isSelectedPlayer ? 'Finish it or skip it, no pressure.' : `${playerLabel(selectedPlayer)} is up this round.`}</p>
                {isSelectedPlayer && (
                  <div className="truth-dare-actions">
                    <button type="button" disabled={busy} onClick={() => void finishTurn(false)}>Done</button>
                    <button className="truth-dare-skip" type="button" disabled={busy} onClick={() => void finishTurn(true)}>Skip prompt</button>
                  </div>
                )}
              </section>
            )}
          </>
        )}

        {error && <p className="card-game-feedback" role="alert">{error}</p>}
        {gameState && <p className="truth-dare-footnote">No photos, no pressure. Either player can skip anything.</p>}
      </section>
    </main>
  );
}
