import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type Tab = 'letters' | 'map' | 'quests';
type RealmLetter = {
  id: string;
  sender_id: string;
  recipient_id: string;
  title: string;
  body: string | null;
  reveal_at: string;
  opened_at: string | null;
  created_at: string;
  is_revealed: boolean;
};
type FutureMapItem = {
  id: string;
  created_by: string;
  title: string;
  description: string;
  target_date: string | null;
  category: string;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
};
type RealmQuest = {
  id: string;
  created_by: string;
  title: string;
  description: string;
  reward_points: number;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
};

const TABS: { id: Tab; label: string }[] = [
  { id: 'letters', label: 'Letters' },
  { id: 'map', label: 'Future Map' },
  { id: 'quests', label: 'Quest Board' },
];

function localDateTimeAfter(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setSeconds(0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatDate(value: string | null) {
  if (!value) return 'Whenever the time feels right';
  return new Date(value).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

export default function OurFuture() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('letters');
  const [letters, setLetters] = useState<RealmLetter[]>([]);
  const [mapItems, setMapItems] = useState<FutureMapItem[]>([]);
  const [quests, setQuests] = useState<RealmQuest[]>([]);
  const [openedLetterId, setOpenedLetterId] = useState<string | null>(null);
  const [letterForm, setLetterForm] = useState({ title: '', body: '', revealAt: localDateTimeAfter(24) });
  const [mapForm, setMapForm] = useState({ title: '', description: '', targetDate: '', category: 'Together' });
  const [questForm, setQuestForm] = useState({ title: '', description: '', points: '20' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    if (!supabase || !session) {
      setLoading(false);
      return;
    }
    if (!spaceId) return;

    const [letterResult, mapResult, questResult] = await Promise.all([
      supabase.rpc('get_realm_letters'),
      supabase.from('future_map_items')
        .select('id,created_by,title,description,target_date,category,completed_at,completed_by,created_at')
        .eq('space_id', spaceId)
        .order('target_date', { ascending: true, nullsFirst: false })
        .order('created_at', { ascending: false }),
      supabase.from('realm_quests')
        .select('id,created_by,title,description,reward_points,completed_at,completed_by,created_at')
        .eq('space_id', spaceId)
        .order('completed_at', { ascending: true, nullsFirst: true })
        .order('created_at', { ascending: false }),
    ]);

    const firstError = letterResult.error ?? mapResult.error ?? questResult.error;
    if (firstError) setError(firstError.message);
    else {
      setLetters((letterResult.data ?? []) as RealmLetter[]);
      setMapItems((mapResult.data ?? []) as FutureMapItem[]);
      setQuests((questResult.data ?? []) as RealmQuest[]);
      setError(null);
    }
    setLoading(false);
  }, [session, spaceId]);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to open Our Future.');
      setLoading(false);
      return;
    }
    let active = true;
    const client = supabase;
    async function loadSpace() {
      const { data, error: spaceError } = await client.rpc('get_my_space');
      if (!active) return;
      if (spaceError) {
        setError(spaceError.message);
        setLoading(false);
      }
      else {
        const rows = Array.isArray(data) ? data as { space_id: string }[] : [];
        const nextSpaceId = rows[0]?.space_id ?? null;
        setSpaceId(nextSpaceId);
        if (!nextSpaceId) setLoading(false);
      }
    }
    void loadSpace();
    return () => { active = false; };
  }, [session]);

  useEffect(() => { void loadData(); }, [loadData]);

  useEffect(() => {
    if (!supabase || !spaceId) return;
    const client = supabase;
    const channel = client
      .channel(`our-future:${spaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'realm_letters', filter: `space_id=eq.${spaceId}` }, () => { void loadData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'future_map_items', filter: `space_id=eq.${spaceId}` }, () => { void loadData(); })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'realm_quests', filter: `space_id=eq.${spaceId}` }, () => { void loadData(); })
      .subscribe();
    return () => { void client.removeChannel(channel); };
  }, [spaceId, loadData]);

  useEffect(() => {
    if (!spaceId) return;
    const interval = window.setInterval(() => { void loadData(); }, 30_000);
    return () => window.clearInterval(interval);
  }, [spaceId, loadData]);

  const openQuests = useMemo(() => quests.filter((quest) => !quest.completed_at), [quests]);
  const completedQuests = useMemo(() => quests.filter((quest) => quest.completed_at), [quests]);
  const myPoints = completedQuests.reduce((total, quest) => total + (quest.completed_by === session?.user.id ? quest.reward_points : 0), 0);
  const partnerPoints = completedQuests.reduce((total, quest) => total + (quest.completed_by && quest.completed_by !== session?.user.id ? quest.reward_points : 0), 0);

  async function submitLetter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !letterForm.revealAt) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase.rpc('send_realm_letter', {
      p_title: letterForm.title.trim(),
      p_body: letterForm.body.trim(),
      p_reveal_at: new Date(letterForm.revealAt).toISOString(),
    });
    if (saveError) setError(saveError.message);
    else {
      setLetterForm({ title: '', body: '', revealAt: localDateTimeAfter(24) });
      setNotice('Letter sealed and scheduled.');
      await loadData();
    }
    setBusy(false);
  }

  async function openLetter(letter: RealmLetter) {
    if (!supabase || !letter.is_revealed) return;
    if (letter.recipient_id === session?.user.id && !letter.opened_at) {
      setBusy(true);
      const { error: openError } = await supabase.rpc('open_realm_letter', { p_letter_id: letter.id });
      if (openError) {
        setError(openError.message);
        setBusy(false);
        return;
      }
      await loadData();
      setBusy(false);
    }
    setOpenedLetterId((current) => current === letter.id ? null : letter.id);
  }

  async function submitMapItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase.rpc('create_future_map_item', {
      p_title: mapForm.title.trim(),
      p_description: mapForm.description.trim(),
      p_target_date: mapForm.targetDate || null,
      p_category: mapForm.category,
    });
    if (saveError) setError(saveError.message);
    else {
      setMapForm({ title: '', description: '', targetDate: '', category: 'Together' });
      setNotice('Added to your Future Map.');
      await loadData();
    }
    setBusy(false);
  }

  async function completeMapItem(itemId: string) {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: completeError } = await supabase.rpc('complete_future_map_item', { p_item_id: itemId });
    if (completeError) setError(completeError.message);
    else await loadData();
    setBusy(false);
  }

  async function submitQuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase.rpc('create_realm_quest', {
      p_title: questForm.title.trim(),
      p_description: questForm.description.trim(),
      p_reward_points: Number(questForm.points),
    });
    if (saveError) setError(saveError.message);
    else {
      setQuestForm({ title: '', description: '', points: '20' });
      setNotice('Quest added to the board.');
      await loadData();
    }
    setBusy(false);
  }

  async function completeQuest(questId: string) {
    if (!supabase) return;
    setBusy(true);
    setError(null);
    const { error: completeError } = await supabase.rpc('complete_realm_quest', { p_quest_id: questId });
    if (completeError) setError(completeError.message);
    else await loadData();
    setBusy(false);
  }

  if (loading) return <main role="status">Opening Our Future...</main>;

  return (
    <main className="our-future-page">
      <section className="our-future-panel">
        <header className="our-future-header">
          <p className="games-eyebrow">Letters, plans, little adventures</p>
          <h1>Our Future</h1>
          <p>Keep a note for later, dream a little bigger, and make small plans together.</p>
        </header>

        <div className="our-future-tabs" role="tablist" aria-label="Our Future sections">
          {TABS.map((item) => (
            <button
              type="button"
              role="tab"
              id={`future-tab-${item.id}`}
              aria-selected={tab === item.id}
              aria-controls={`future-panel-${item.id}`}
              className={tab === item.id ? 'is-active' : ''}
              key={item.id}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {!spaceId ? <p className="our-future-empty">Pair your account to share this page. <Link to="/pairing">Go to Pairing</Link></p> : (
          <div className="our-future-tab-content" role="tabpanel" id={`future-panel-${tab}`} aria-labelledby={`future-tab-${tab}`}>
            {tab === 'letters' && (
              <section className="future-section">
                <form className="future-form" onSubmit={(event) => void submitLetter(event)}>
                  <div className="future-section-heading">
                    <h2>Write a letter for later</h2>
                    <p>Choose when it should arrive. Until then, it stays sealed for your partner.</p>
                  </div>
                  <label>Title<input required maxLength={120} value={letterForm.title} onChange={(event) => setLetterForm((current) => ({ ...current, title: event.target.value }))} /></label>
                  <label>Your letter<textarea required maxLength={20000} rows={5} value={letterForm.body} onChange={(event) => setLetterForm((current) => ({ ...current, body: event.target.value }))} /></label>
                  <label>Reveal date and time<input required type="datetime-local" value={letterForm.revealAt} onChange={(event) => setLetterForm((current) => ({ ...current, revealAt: event.target.value }))} /></label>
                  <button type="submit" disabled={busy}>{busy ? 'Sealing...' : 'Seal letter'}</button>
                </form>

                <div className="future-list-heading"><h2>Letters</h2><span>{letters.length}</span></div>
                {letters.length === 0 ? <p className="our-future-empty">No letters yet. Your first one can be for tomorrow.</p> : (
                  <ul className="future-list">
                    {letters.map((letter) => {
                      const isMine = letter.sender_id === session?.user.id;
                      const opened = openedLetterId === letter.id;
                      return (
                        <li className={`future-list-item${!letter.is_revealed ? ' is-sealed' : ''}`} key={letter.id}>
                          <div className="future-item-heading">
                            <div><p className="future-item-meta">{isMine ? 'Sent to your partner' : letter.opened_at ? 'Opened' : 'A letter for you'} · {formatDateTime(letter.reveal_at)}</p><h3>{letter.is_revealed ? letter.title : 'A sealed letter'}</h3></div>
                            {letter.is_revealed && <button type="button" disabled={busy} onClick={() => void openLetter(letter)}>{opened ? 'Close' : letter.opened_at ? 'Read again' : isMine ? 'Read letter' : 'Open letter'}</button>}
                          </div>
                          {!letter.is_revealed && <p className="future-locked-note">This letter will open when its time arrives.</p>}
                          {opened && letter.body && <p className="future-letter-body">{letter.body}</p>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
            )}

            {tab === 'map' && (
              <section className="future-section">
                <form className="future-form" onSubmit={(event) => void submitMapItem(event)}>
                  <div className="future-section-heading"><h2>Add to the Future Map</h2><p>Small hopes and faraway plans both belong here.</p></div>
                  <label>What would you like to do together?<input required maxLength={160} value={mapForm.title} onChange={(event) => setMapForm((current) => ({ ...current, title: event.target.value }))} /></label>
                  <label>A few details<textarea maxLength={3000} rows={3} value={mapForm.description} onChange={(event) => setMapForm((current) => ({ ...current, description: event.target.value }))} /></label>
                  <div className="future-form-row">
                    <label>When<input type="date" value={mapForm.targetDate} onChange={(event) => setMapForm((current) => ({ ...current, targetDate: event.target.value }))} /></label>
                    <label>Kind of plan<select value={mapForm.category} onChange={(event) => setMapForm((current) => ({ ...current, category: event.target.value }))}><option>Together</option><option>Place to visit</option><option>Something to learn</option><option>Little tradition</option><option>Big dream</option></select></label>
                  </div>
                  <button type="submit" disabled={busy}>{busy ? 'Adding...' : 'Add to map'}</button>
                </form>

                <div className="future-list-heading"><h2>Our plans</h2><span>{mapItems.filter((item) => !item.completed_at).length} ahead</span></div>
                {mapItems.length === 0 ? <p className="our-future-empty">Your map is waiting for its first pin.</p> : (
                  <ul className="future-list">
                    {mapItems.map((item) => (
                      <li className={`future-list-item${item.completed_at ? ' is-complete' : ''}`} key={item.id}>
                        <div className="future-item-heading">
                          <div><p className="future-item-meta">{item.category} · {formatDate(item.target_date)}</p><h3>{item.title}</h3>{item.description && <p>{item.description}</p>}</div>
                          {!item.completed_at && <button type="button" disabled={busy} onClick={() => void completeMapItem(item.id)}>We did it</button>}
                        </div>
                        {item.completed_at && <p className="future-item-meta">Made it happen {formatDate(item.completed_at)}</p>}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            )}

            {tab === 'quests' && (
              <section className="future-section">
                <div className="quest-scoreboard" aria-label="Quest points">
                  <div><strong>{myPoints}</strong><span>Your points</span></div>
                  <div><strong>{partnerPoints}</strong><span>Partner points</span></div>
                </div>
                <form className="future-form" onSubmit={(event) => void submitQuest(event)}>
                  <div className="future-section-heading"><h2>Post a little quest</h2><p>Make it something either of you can complete together or individually.</p></div>
                  <label>Quest<input required maxLength={160} value={questForm.title} onChange={(event) => setQuestForm((current) => ({ ...current, title: event.target.value }))} /></label>
                  <label>Details<textarea maxLength={3000} rows={3} value={questForm.description} onChange={(event) => setQuestForm((current) => ({ ...current, description: event.target.value }))} /></label>
                  <label>Reward points<input required type="number" min={1} max={1000} value={questForm.points} onChange={(event) => setQuestForm((current) => ({ ...current, points: event.target.value }))} /></label>
                  <button type="submit" disabled={busy}>{busy ? 'Posting...' : 'Post quest'}</button>
                </form>

                <div className="future-list-heading"><h2>Open quests</h2><span>{openQuests.length}</span></div>
                {openQuests.length === 0 ? <p className="our-future-empty">No quests on the board. Make up a tiny adventure.</p> : (
                  <ul className="future-list">
                    {openQuests.map((quest) => (
                      <li className="future-list-item" key={quest.id}>
                        <div className="future-item-heading">
                          <div><p className="future-item-meta">{quest.reward_points} points</p><h3>{quest.title}</h3>{quest.description && <p>{quest.description}</p>}</div>
                          <button type="button" disabled={busy} onClick={() => void completeQuest(quest.id)}>Claim reward</button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}

                {completedQuests.length > 0 && <>
                  <div className="future-list-heading"><h2>Completed</h2><span>{completedQuests.length}</span></div>
                  <ul className="future-list">
                    {completedQuests.map((quest) => <li className="future-list-item is-complete" key={quest.id}><div><p className="future-item-meta">{quest.reward_points} points · {quest.completed_by === session?.user.id ? 'You completed this' : 'Partner completed this'}</p><h3>{quest.title}</h3></div></li>)}
                  </ul>
                </>}
              </section>
            )}
          </div>
        )}

        {error && <p className="card-game-feedback" role="alert">{error}</p>}
        {notice && <p className="card-game-feedback" role="status">{notice}</p>}
      </section>
    </main>
  );
}
