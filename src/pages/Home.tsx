import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ThemeContext } from '../components/ThemeProvider';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type QuestionPreview = {
  question_date: string;
  prompt: string;
  category: string;
  progression_year: number;
  journey_day: number;
};

type CalendarPreview = {
  id: string;
  title: string;
  category: string;
  starts_at: string;
  color: string;
  visibility: 'private' | 'shared';
};

type TaskPreview = {
  id: string;
  title: string;
  due_at: string | null;
  status: string;
  priority: string;
};

type BoardOperation = {
  id: string;
  author: string;
  op: unknown;
  created_at: string;
};

type SpaceMember = {
  space_id: string;
  member_id: string;
  member_display_name: string | null;
};

const THEMES = [
  ['lavender', 'Lavender'],
  ['rose', 'Roseblood'],
  ['celestial', 'Celestial Blue'],
  ['blush-beige', 'Blush & Beige'],
  ['verdant', 'Verdant'],
] as const;

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? (data[0] as T | undefined) ?? null : null;
}

function drawPreview(context: CanvasRenderingContext2D, operation: unknown, width: number, height: number) {
  if (!operation || typeof operation !== 'object') return;
  const drawing = operation as Record<string, unknown>;
  if (drawing.type === 'clear') {
    context.globalCompositeOperation = 'source-over';
    context.fillStyle = '#fff';
    context.fillRect(0, 0, width, height);
    return;
  }
  if (!['stroke', 'erase'].includes(String(drawing.type)) || !Array.isArray(drawing.points)) return;
  if (typeof drawing.color !== 'string' || typeof drawing.width !== 'number') return;
  const points = drawing.points as unknown[];
  if (points.length < 2) return;
  const first = points[0] as number[];
  if (!Array.isArray(first) || first.length !== 2) return;

  context.save();
  context.globalCompositeOperation = drawing.type === 'erase' ? 'destination-out' : 'source-over';
  context.strokeStyle = drawing.color;
  context.lineWidth = Math.max(1, drawing.width * 0.55);
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(first[0] * width, first[1] * height);
  for (const value of points.slice(1)) {
    const point = value as number[];
    if (Array.isArray(point) && point.length === 2) context.lineTo(point[0] * width, point[1] * height);
  }
  context.stroke();
  context.restore();
}

export default function Home() {
  const { theme, mode, setTheme, setMode } = useContext(ThemeContext);
  const { session } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [question, setQuestion] = useState<QuestionPreview | null>(null);
  const [events, setEvents] = useState<CalendarPreview[]>([]);
  const [tasks, setTasks] = useState<TaskPreview[]>([]);
  const [boardId, setBoardId] = useState<string | null>(null);
  const [boardOps, setBoardOps] = useState<BoardOperation[]>([]);
  const [loadingAccount, setLoadingAccount] = useState(true);
  const [loadingDashboard, setLoadingDashboard] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [quickPanelOpen, setQuickPanelOpen] = useState(false);
  const quickPanelRef = useRef<HTMLElement>(null);
  const quickPanelTriggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!supabase || !session) {
      setLoadingAccount(false);
      return;
    }

    let active = true;
    const client = supabase;
    const userId = session.user.id;
    async function loadAccount() {
      const [profileResult, spaceResult] = await Promise.all([
        client.from('profiles').select('display_name').eq('id', userId).maybeSingle(),
        client.rpc('get_my_space'),
      ]);
      if (!active) return;

      if (profileResult.error) setError(profileResult.error.message);
      else setDisplayName(profileResult.data?.display_name ?? '');
      if (spaceResult.error) setError(spaceResult.error.message);
      else {
        const rows = (Array.isArray(spaceResult.data) ? spaceResult.data : []) as SpaceMember[];
        setMembers(rows);
        setSpaceId(rows[0]?.space_id ?? null);
      }
      setLoadingAccount(false);
    }

    void loadAccount();
    return () => { active = false; };
  }, [session]);

  const loadDashboard = useCallback(async () => {
    if (!supabase || !session || !spaceId) {
      setLoadingDashboard(false);
      return;
    }

    const client = supabase;
    setLoadingDashboard(true);
    const now = new Date().toISOString();
    const [questionResult, sharedEvents, personalEvents, taskResult, boardResult] = await Promise.all([
      client.rpc('get_today_question'),
      client.from('calendar_events').select('id,title,category,starts_at,color,visibility')
        .eq('space_id', spaceId).eq('visibility', 'shared').gte('starts_at', now)
        .order('starts_at').limit(5),
      client.from('calendar_events').select('id,title,category,starts_at,color,visibility')
        .eq('created_by', session.user.id).eq('visibility', 'private').gte('starts_at', now)
        .order('starts_at').limit(5),
      client.from('shared_tasks').select('id,title,due_at,status,priority')
        .eq('space_id', spaceId).in('status', ['not_started', 'in_progress'])
        .order('due_at', { ascending: true, nullsFirst: false }).limit(5),
      client.rpc('get_or_create_shared_whiteboard'),
    ]);

    const errors: string[] = [];
    if (questionResult.error) errors.push(`Question: ${questionResult.error.message}`);
    else setQuestion(firstRow<QuestionPreview>(questionResult.data));

    if (sharedEvents.error) errors.push(`Shared events: ${sharedEvents.error.message}`);
    if (personalEvents.error) errors.push(`Personal events: ${personalEvents.error.message}`);
    if (!sharedEvents.error && !personalEvents.error) {
      setEvents([...((sharedEvents.data ?? []) as CalendarPreview[]), ...((personalEvents.data ?? []) as CalendarPreview[])]
        .sort((left, right) => left.starts_at.localeCompare(right.starts_at))
        .slice(0, 5));
    }

    if (taskResult.error) errors.push(`Tasks: ${taskResult.error.message}`);
    else setTasks((taskResult.data ?? []) as TaskPreview[]);

    const board = firstRow<{ board_id: string }>(boardResult.data);
    if (boardResult.error) errors.push(`Whiteboard: ${boardResult.error.message}`);
    else if (board) {
      setBoardId(board.board_id);
      const { data, error: operationsError } = await client
        .from('whiteboard_operations')
        .select('id,author,op,created_at')
        .eq('board_id', board.board_id)
        .order('created_at', { ascending: false })
        .limit(300);
      if (operationsError) errors.push(`Whiteboard preview: ${operationsError.message}`);
      else setBoardOps(((data ?? []) as BoardOperation[]).reverse());
    }

    setError(errors.length ? errors.join(' · ') : null);
    setLoadingDashboard(false);
  }, [session, spaceId]);

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (!supabase || !spaceId || !boardId) return;

    const client = supabase;
    const refresh = () => { void loadDashboard(); };
    const channel = client
      .channel(`home:${spaceId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events', filter: `space_id=eq.${spaceId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'calendar_events', filter: `created_by=eq.${session?.user.id}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'shared_tasks', filter: `space_id=eq.${spaceId}` }, refresh)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'whiteboard_operations', filter: `board_id=eq.${boardId}` }, refresh)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'question_answers', filter: `space_id=eq.${spaceId}` }, refresh)
      .subscribe();

    return () => { void client.removeChannel(channel); };
  }, [spaceId, boardId, session?.user.id, loadDashboard]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const draw = () => {
      const bounds = canvas.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      const scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(bounds.width * scale);
      canvas.height = Math.round(bounds.height * scale);
      const context = canvas.getContext('2d');
      if (!context) return;
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.fillStyle = '#fff';
      context.fillRect(0, 0, bounds.width, bounds.height);
      for (const item of boardOps) drawPreview(context, item.op, bounds.width, bounds.height);
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [boardOps]);

  useEffect(() => {
    if (!quickPanelOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    quickPanelRef.current?.querySelector<HTMLElement>('button, a, input, select')?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setQuickPanelOpen(false);
        quickPanelTriggerRef.current?.focus();
        return;
      }
      if (event.key !== 'Tab' || !quickPanelRef.current) return;

      const focusable = [...quickPanelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])',
      )];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [quickPanelOpen]);

  if (loadingAccount) return <main role="status">Opening your space...</main>;

  const greetingName = displayName || session?.user.email?.split('@')[0] || 'there';
  const today = new Date();
  const memberNames = members.map((member) => member.member_display_name || 'Evermore member');
  const latestBoardOp = boardOps[boardOps.length - 1];

  return (
    <main className="home-dashboard">
      <header className="home-welcome">
        <div>
          <p className="home-eyebrow">Your shared world</p>
          <h1>Welcome back, {greetingName}</h1>
          <p>{today.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}{memberNames.length > 1 ? ` · Together with ${memberNames.filter((_, index) => members[index].member_id !== session?.user.id).join(', ')}` : ''}</p>
        </div>
        <div className="home-settings">
          <label>Theme
            <select value={theme} onChange={(event) => setTheme(event.target.value)}>
              {THEMES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
            </select>
          </label>
          <label>Mode
            <select value={mode} onChange={(event) => setMode(event.target.value as 'light' | 'dark')}>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <button
            ref={quickPanelTriggerRef}
            className="home-quick-access-trigger"
            type="button"
            aria-haspopup="dialog"
            aria-expanded={quickPanelOpen}
            onClick={() => setQuickPanelOpen(true)}
          >
            Tasks & pages
          </button>
        </div>
      </header>

      {!spaceId ? (
        <section className="home-unpaired">
          <h2>Your room is ready when you are</h2>
          <p>Pair your partner’s account to bring shared questions, tasks, events, and drawings together here.</p>
          <Link to="/pairing">Open Pairing</Link>
        </section>
      ) : (
        <>
          <div className="home-dashboard-grid">
            <section className="home-section home-question">
              <div className="home-section-heading">
                <div>
                  <p className="home-eyebrow">{question ? `Year ${question.progression_year} · Day ${question.journey_day}` : 'Today'}</p>
                  <h2>Our Little Question</h2>
                </div>
                <Link to="/questions">Open</Link>
              </div>
              {loadingDashboard && !question ? <p>Loading today’s question...</p> : question ? <p className="home-question-prompt">{question.prompt}</p> : <p>No question is available yet.</p>}
            </section>

            <section className="home-section home-agenda">
              <div className="home-section-heading">
                <div>
                  <p className="home-eyebrow">Coming up</p>
                  <h2>Calendar</h2>
                </div>
                <Link to="/calendar">Open</Link>
              </div>
              {events.length === 0 ? <p className="home-empty">Nothing scheduled yet.</p> : (
                <ul className="home-agenda-list">
                  {events.map((event) => (
                    <li key={event.id}>
                      <span className="home-event-color" style={{ backgroundColor: event.color }} aria-hidden="true" />
                      <div><strong>{event.title}</strong><span>{new Date(event.starts_at).toLocaleString()} · {event.visibility === 'shared' ? 'Shared' : 'Private'}</span></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="home-section home-tasks">
              <div className="home-section-heading">
                <div>
                  <p className="home-eyebrow">Together, even when apart</p>
                  <h2>Shared tasks</h2>
                </div>
                <Link to="/room">Open</Link>
              </div>
              {tasks.length === 0 ? <p className="home-empty">No active tasks yet.</p> : (
                <ul className="home-task-list">
                  {tasks.map((task) => (
                    <li key={task.id}>
                      <span className={`home-task-priority home-task-priority-${task.priority}`} aria-hidden="true" />
                      <div><strong>{task.title}</strong><span>{task.due_at ? `Due ${new Date(task.due_at).toLocaleString()}` : 'No due date'} · {task.status.replace('_', ' ')}</span></div>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="home-section home-whiteboard">
              <div className="home-section-heading">
                <div>
                  <p className="home-eyebrow">Last shared mark</p>
                  <h2>Whiteboard</h2>
                </div>
                <Link to="/whiteboard">Open</Link>
              </div>
              {boardId ? (
                <>
                  <canvas ref={canvasRef} className="home-board-preview" aria-label="Preview of your shared whiteboard" />
                  <p className="home-empty">{latestBoardOp ? `Updated ${new Date(latestBoardOp.created_at).toLocaleString()}` : 'Your shared canvas is ready.'}</p>
                </>
              ) : <p className="home-empty">Your shared canvas is ready when you are.</p>}
            </section>
          </div>
          {loadingDashboard && <p className="home-loading" role="status">Refreshing your shared space...</p>}
          {error && <p className="home-error" role="alert">{error}</p>}
        </>
      )}

      <button
        className={`home-tools-scrim${quickPanelOpen ? ' is-open' : ''}`}
        type="button"
        aria-label="Close tasks and pages panel"
        tabIndex={quickPanelOpen ? 0 : -1}
        onClick={() => {
          setQuickPanelOpen(false);
          quickPanelTriggerRef.current?.focus();
        }}
      />
      <aside
        ref={quickPanelRef}
        className={`home-tools-drawer${quickPanelOpen ? ' is-open' : ''}`}
        role="dialog"
        aria-modal={quickPanelOpen}
        aria-label="Tasks and all pages"
        aria-hidden={!quickPanelOpen}
      >
        <header className="home-tools-header">
          <div>
            <p className="home-eyebrow">Your shared world</p>
            <h2>Quick access</h2>
          </div>
          <button type="button" aria-label="Close panel" onClick={() => {
            setQuickPanelOpen(false);
            quickPanelTriggerRef.current?.focus();
          }}>Close</button>
        </header>
        <nav className="home-tools-links" aria-label="All pages">
          <Link to="/" onClick={() => setQuickPanelOpen(false)}>Home</Link>
          <Link to="/profile" onClick={() => setQuickPanelOpen(false)}>Profile & settings</Link>
          <Link to="/pairing" onClick={() => setQuickPanelOpen(false)}>Private space</Link>
          <Link to="/chat" onClick={() => setQuickPanelOpen(false)}>Our Chat</Link>
          <Link to="/whiteboard" onClick={() => setQuickPanelOpen(false)}>Shared Whiteboard</Link>
          <Link to="/questions" onClick={() => setQuickPanelOpen(false)}>Our Little Questions</Link>
          <Link to="/calendar" onClick={() => setQuickPanelOpen(false)}>Shared Calendar</Link>
          <Link to="/memories" onClick={() => setQuickPanelOpen(false)}>Memory Garden</Link>
          <Link to="/room" onClick={() => setQuickPanelOpen(false)}>Companion Room</Link>
        </nav>
        <section className="home-tools-tasks">
          <div className="home-section-heading">
            <h2>Active tasks</h2>
            <Link to="/room" onClick={() => setQuickPanelOpen(false)}>All tasks</Link>
          </div>
          {tasks.length === 0 ? <p className="home-empty">Nothing to do together yet.</p> : (
            <ul className="home-task-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <span className={`home-task-priority home-task-priority-${task.priority}`} aria-hidden="true" />
                  <div>
                    <strong>{task.title}</strong>
                    <span>{task.due_at ? `Due ${new Date(task.due_at).toLocaleString()}` : task.status.replace('_', ' ')}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </main>
  );
}
