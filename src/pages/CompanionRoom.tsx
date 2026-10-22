import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type Member = {
  space_id: string;
  member_id: string;
  member_display_name: string | null;
};

type TaskStatus = 'not_started' | 'in_progress' | 'completed' | 'cancelled';
type TaskPriority = 'low' | 'normal' | 'high';
type SharedTask = {
  id: string;
  space_id: string;
  created_by: string;
  assigned_to: string | null;
  title: string;
  description: string;
  due_at: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
};
type TaskForm = {
  title: string;
  description: string;
  due_at: string;
  priority: TaskPriority;
  status: TaskStatus;
  assigned_to: string;
};
type FocusType = 'focus' | 'short_break' | 'long_break';
type FocusSession = {
  session_id: string;
  space_id: string;
  title: string;
  session_type: FocusType;
  duration_seconds: number;
  status: 'running' | 'paused' | 'completed' | 'cancelled';
  started_at: string;
  paused_at: string | null;
  paused_seconds: number;
  ended_at: string | null;
  created_at: string;
  server_now: string;
};

const EMPTY_FORM: TaskForm = {
  title: '',
  description: '',
  due_at: '',
  priority: 'normal',
  status: 'not_started',
  assigned_to: '',
};
const TASK_COLUMNS = 'id,space_id,created_by,assigned_to,title,description,due_at,priority,status,created_at,updated_at';

function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function formatClock(seconds: number) {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return `${String(Math.floor(safeSeconds / 60)).padStart(2, '0')}:${String(safeSeconds % 60).padStart(2, '0')}`;
}

export default function CompanionRoom() {
  const { session } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [tasks, setTasks] = useState<SharedTask[]>([]);
  const [focusSessions, setFocusSessions] = useState<FocusSession[]>([]);
  const [focusTitle, setFocusTitle] = useState('Focus together');
  const [focusType, setFocusType] = useState<FocusType>('focus');
  const [focusMinutes, setFocusMinutes] = useState(25);
  const [focusLoading, setFocusLoading] = useState(true);
  const [clockNow, setClockNow] = useState(Date.now());
  const [serverClockOffset, setServerClockOffset] = useState(0);
  const [form, setForm] = useState<TaskForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const completingSessionId = useRef<string | null>(null);

  const spaceId = members[0]?.space_id ?? null;

  const loadTasks = useCallback(async () => {
    if (!supabase || !spaceId) {
      setTasks([]);
      setLoading(false);
      return;
    }

    const { data, error: tasksError } = await supabase
      .from('shared_tasks')
      .select(TASK_COLUMNS)
      .eq('space_id', spaceId)
      .order('due_at', { ascending: true, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (tasksError) setError(tasksError.message);
    else {
      setTasks((data ?? []) as SharedTask[]);
      setError(null);
    }
    setLoading(false);
  }, [spaceId]);

  const loadFocusSessions = useCallback(async () => {
    if (!supabase || !spaceId) {
      setFocusSessions([]);
      setFocusLoading(false);
      return;
    }
    const { data, error: focusError } = await supabase.rpc('get_focus_room_state');
    if (focusError) setError(focusError.message);
    else {
      const rows = (Array.isArray(data) ? data : []) as FocusSession[];
      setFocusSessions(rows);
      if (rows[0]?.server_now) setServerClockOffset(new Date(rows[0].server_now).getTime() - Date.now());
    }
    setFocusLoading(false);
  }, [spaceId]);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to open the Companion Room.');
      setLoading(false);
      return;
    }

    let active = true;
    const client = supabase;
    async function loadMembers() {
      const { data, error: membersError } = await client.rpc('get_my_space');
      if (!active) return;
      if (membersError) setError(membersError.message);
      else setMembers((Array.isArray(data) ? data : []) as Member[]);
      setLoading(false);
    }

    void loadMembers();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!supabase || !spaceId) return;

    setLoading(true);
    const client = supabase;
    let active = true;
    const channel = client
      .channel(`shared-tasks:${spaceId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'shared_tasks',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadTasks(); })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'focus_sessions',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadFocusSessions(); })
      .subscribe();

    void loadTasks().then(() => { if (active) setLoading(false); });
    void loadFocusSessions();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [spaceId, loadTasks, loadFocusSessions]);

  const activeFocusSession = focusSessions.find((item) => item.status === 'running' || item.status === 'paused') ?? null;

  useEffect(() => {
    if (!activeFocusSession || activeFocusSession.status !== 'running') return;
    const intervalId = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(intervalId);
  }, [activeFocusSession?.session_id, activeFocusSession?.status]);

  const focusNow = clockNow + serverClockOffset;
  const focusElapsed = activeFocusSession
    ? Math.max(0, (Date.parse(activeFocusSession.status === 'paused' && activeFocusSession.paused_at
      ? activeFocusSession.paused_at
      : activeFocusSession.server_now) - Date.parse(activeFocusSession.started_at)) / 1000 - activeFocusSession.paused_seconds)
    : 0;
  const focusRemaining = activeFocusSession
    ? Math.max(0, activeFocusSession.duration_seconds - (activeFocusSession.status === 'running'
      ? (focusNow - Date.parse(activeFocusSession.started_at)) / 1000 - activeFocusSession.paused_seconds
      : focusElapsed))
    : 0;

  const finishFocusSession = useCallback(async (sessionId: string, cancel: boolean) => {
    if (!supabase) return;
    const { error: finishError } = await supabase.rpc('finish_focus_session', {
      p_session_id: sessionId,
      p_cancel: cancel,
    });
    if (finishError) setError(finishError.message);
    else {
      completingSessionId.current = null;
      await loadFocusSessions();
      setNotice(cancel ? 'Focus session ended.' : 'Focus session complete.');
    }
  }, [loadFocusSessions]);

  useEffect(() => {
    if (!activeFocusSession || activeFocusSession.status !== 'running' || focusRemaining > 0) return;
    if (completingSessionId.current === activeFocusSession.session_id) return;
    completingSessionId.current = activeFocusSession.session_id;
    void finishFocusSession(activeFocusSession.session_id, false);
  }, [activeFocusSession, focusRemaining, finishFocusSession]);

  async function startFocusSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !spaceId) return;
    setError(null);
    setNotice(null);
    const { error: startError } = await supabase.rpc('start_focus_session', {
      p_title: focusTitle.trim() || 'Focus together',
      p_session_type: focusType,
      p_duration_minutes: focusMinutes,
    });
    if (startError) setError(startError.message);
    else {
      completingSessionId.current = null;
      setNotice('Shared focus session started.');
      await loadFocusSessions();
    }
  }

  async function toggleFocusPause() {
    if (!supabase || !activeFocusSession) return;
    const rpcName = activeFocusSession.status === 'running' ? 'pause_focus_session' : 'resume_focus_session';
    const { error: toggleError } = await supabase.rpc(rpcName, { p_session_id: activeFocusSession.session_id });
    if (toggleError) setError(toggleError.message);
    else await loadFocusSessions();
  }

  function updateForm<K extends keyof TaskForm>(key: K, value: TaskForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startEdit(task: SharedTask) {
    setEditingId(task.id);
    setForm({
      title: task.title,
      description: task.description,
      due_at: task.due_at ? toLocalInput(task.due_at) : '',
      priority: task.priority,
      status: task.status,
      assigned_to: task.assigned_to ?? '',
    });
    setError(null);
    setNotice(null);
  }

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !spaceId || !session) return;
    const title = form.title.trim();
    if (!title) return;

    setSaving(true);
    setError(null);
    setNotice(null);
    const values = {
      assigned_to: form.assigned_to || null,
      title,
      description: form.description.trim(),
      due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
      priority: form.priority,
      status: form.status,
    };
    const result = editingId
      ? await supabase.from('shared_tasks').update(values).eq('id', editingId)
      : await supabase.from('shared_tasks').insert({ ...values, space_id: spaceId, created_by: session.user.id });

    if (result.error) setError(result.error.message);
    else {
      setNotice(editingId ? 'Task updated.' : 'Task added.');
      resetForm();
      await loadTasks();
    }
    setSaving(false);
  }

  async function updateTaskStatus(task: SharedTask, status: TaskStatus) {
    if (!supabase) return;
    const { error: updateError } = await supabase.from('shared_tasks').update({ status }).eq('id', task.id);
    if (updateError) setError(updateError.message);
    else await loadTasks();
  }

  async function deleteTask(task: SharedTask) {
    if (!supabase || !window.confirm(`Delete “${task.title}”?`)) return;
    const { error: deleteError } = await supabase.from('shared_tasks').delete().eq('id', task.id);
    if (deleteError) setError(deleteError.message);
    else {
      setTasks((current) => current.filter((item) => item.id !== task.id));
      setNotice('Task deleted.');
      if (editingId === task.id) resetForm();
    }
  }

  if (loading) return <main role="status">Loading Companion Room...</main>;

  const assigneeNames = new Map(members.map((member) => [member.member_id, member.member_display_name || 'Partner']));
  const taskStatusOrder: Record<TaskStatus, number> = {
    not_started: 0,
    in_progress: 1,
    completed: 2,
    cancelled: 3,
  };
  const orderedTasks = [...tasks].sort((left, right) =>
    taskStatusOrder[left.status] - taskStatusOrder[right.status]
    || (left.due_at ?? '9999').localeCompare(right.due_at ?? '9999')
    || right.created_at.localeCompare(left.created_at),
  );

  return (
    <main className="companion-page">
      <section className="companion-panel">
        <header className="companion-header">
          <div>
            <p className="companion-eyebrow">Together, Even When Apart</p>
            <h1>Companion Room</h1>
            <p>One shared list for plans, little goals, and things to do for each other.</p>
          </div>
          <span role="status">{members.length > 1 ? 'Paired' : 'Waiting for your partner'}</span>
        </header>

        {!spaceId ? (
          <p>Pair your account to start a shared list. <Link to="/pairing">Go to Pairing</Link></p>
        ) : (
          <>
            <section className="focus-session-section" aria-live="polite">
              <header className="focus-session-header">
                <div>
                  <p className="companion-eyebrow">Shared focus</p>
                  <h2>Settle in together</h2>
                </div>
                <span className="focus-session-sync">Synced across devices</span>
              </header>

              {focusLoading ? <p role="status">Checking shared timer...</p> : activeFocusSession ? (
                <div className="focus-active">
                  <div className="focus-timer-copy">
                    <p>{activeFocusSession.session_type.replace('_', ' ')} · {activeFocusSession.title}</p>
                    <strong className="focus-clock" aria-label={`${Math.floor(focusRemaining / 60)} minutes ${focusRemaining % 60} seconds remaining`}>
                      {formatClock(focusRemaining)}
                    </strong>
                    <div className="focus-progress" role="progressbar" aria-label="Focus session progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(100 - focusRemaining / activeFocusSession.duration_seconds * 100)}>
                      <span style={{ width: `${Math.max(0, Math.min(100, 100 - focusRemaining / activeFocusSession.duration_seconds * 100))}%` }} />
                    </div>
                    <small>{activeFocusSession.status === 'paused' ? 'Paused for both of you' : 'In session'}</small>
                  </div>
                  <div className="focus-controls">
                    <button type="button" onClick={() => void toggleFocusPause()}>
                      {activeFocusSession.status === 'paused' ? 'Resume' : 'Pause'}
                    </button>
                    <button type="button" onClick={() => {
                      if (window.confirm('End this shared focus session for both of you?')) {
                        void finishFocusSession(activeFocusSession.session_id, true);
                      }
                    }}>End session</button>
                  </div>
                </div>
              ) : (
                <form className="focus-start-form" onSubmit={startFocusSession}>
                  <label htmlFor="focus-title">Session name</label>
                  <input id="focus-title" maxLength={120} value={focusTitle} onChange={(event) => setFocusTitle(event.target.value)} />
                  <label htmlFor="focus-type">Session type</label>
                  <select id="focus-type" value={focusType} onChange={(event) => {
                    const nextType = event.target.value as FocusType;
                    setFocusType(nextType);
                    if (nextType === 'focus' && focusMinutes > 180) setFocusMinutes(25);
                    if (nextType !== 'focus' && focusMinutes > 60) setFocusMinutes(5);
                  }}>
                    <option value="focus">Focus</option>
                    <option value="short_break">Short break</option>
                    <option value="long_break">Long break</option>
                  </select>
                  <label htmlFor="focus-duration">Minutes</label>
                  <input
                    id="focus-duration"
                    type="number"
                    min="1"
                    max={focusType === 'focus' ? 180 : 60}
                    value={focusMinutes}
                    onChange={(event) => setFocusMinutes(Number(event.target.value))}
                  />
                  <button type="submit" disabled={!focusTitle.trim() || focusMinutes < 1 || focusMinutes > (focusType === 'focus' ? 180 : 60)}>
                    Start shared session
                  </button>
                </form>
              )}

              {!focusLoading && focusSessions.some((item) => item.status === 'completed' || item.status === 'cancelled') && (
                <details className="focus-history">
                  <summary>Recent sessions</summary>
                  <ul>
                    {focusSessions.filter((item) => item.status === 'completed' || item.status === 'cancelled').slice(0, 5).map((item) => (
                      <li key={item.session_id}>
                        <span>{item.title}</span>
                        <span>{item.session_type.replace('_', ' ')} · {item.status} · {new Date(item.created_at).toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </section>

            <section className="task-form-section">
              <h2>{editingId ? 'Edit task' : 'Add a task'}</h2>
              <form className="task-form" onSubmit={handleSave}>
                <label htmlFor="task-title">Task</label>
                <input id="task-title" required maxLength={160} value={form.title} onChange={(event) => updateForm('title', event.target.value)} />

                <label htmlFor="task-description">Details</label>
                <textarea id="task-description" maxLength={5000} value={form.description} onChange={(event) => updateForm('description', event.target.value)} />

                <label htmlFor="task-due">Due date</label>
                <input id="task-due" type="datetime-local" value={form.due_at} onChange={(event) => updateForm('due_at', event.target.value)} />

                <label htmlFor="task-priority">Priority</label>
                <select id="task-priority" value={form.priority} onChange={(event) => updateForm('priority', event.target.value as TaskPriority)}>
                  <option value="low">Low</option>
                  <option value="normal">Normal</option>
                  <option value="high">High</option>
                </select>

                <label htmlFor="task-assignee">Assigned to</label>
                <select id="task-assignee" value={form.assigned_to} onChange={(event) => updateForm('assigned_to', event.target.value)}>
                  <option value="">Both of us</option>
                  {members.map((member) => (
                    <option value={member.member_id} key={member.member_id}>
                      {member.member_id === session?.user.id ? 'Me' : member.member_display_name || 'Partner'}
                    </option>
                  ))}
                </select>

                {editingId && (
                  <>
                    <label htmlFor="task-status">Status</label>
                    <select id="task-status" value={form.status} onChange={(event) => updateForm('status', event.target.value as TaskStatus)}>
                      <option value="not_started">Not started</option>
                      <option value="in_progress">In progress</option>
                      <option value="completed">Completed</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </>
                )}

                <div className="task-form-actions">
                  <button type="submit" disabled={saving || !form.title.trim()}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Add task'}</button>
                  {editingId && <button type="button" disabled={saving} onClick={resetForm}>Cancel</button>}
                </div>
              </form>
            </section>

            <section className="shared-tasks-list" aria-live="polite">
              <h2>Shared tasks</h2>
              {orderedTasks.length === 0 ? <p>No tasks yet. Add your first one above.</p> : orderedTasks.map((task) => (
                <article className={`shared-task shared-task-${task.status}`} key={task.id}>
                  <div className="shared-task-main">
                    <div className="shared-task-tags">
                      <span className={`task-priority task-priority-${task.priority}`}>{task.priority}</span>
                      <span>{task.status.replace('_', ' ')}</span>
                    </div>
                    <h3>{task.title}</h3>
                    {task.description && <p>{task.description}</p>}
                    <p className="shared-task-meta">
                      {task.assigned_to ? `Assigned to ${assigneeNames.get(task.assigned_to) ?? 'a member'}` : 'Shared'}
                      {task.due_at && ` · Due ${new Date(task.due_at).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="shared-task-actions">
                    <label>
                      <span className="visually-hidden">Status for {task.title}</span>
                      <select value={task.status} onChange={(event) => void updateTaskStatus(task, event.target.value as TaskStatus)}>
                        <option value="not_started">Not started</option>
                        <option value="in_progress">In progress</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
                    </label>
                    <button type="button" onClick={() => startEdit(task)}>Edit</button>
                    {task.created_by === session?.user.id && <button type="button" onClick={() => void deleteTask(task)}>Delete</button>}
                  </div>
                </article>
              ))}
            </section>
          </>
        )}

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}
