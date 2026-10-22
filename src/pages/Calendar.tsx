import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type CalendarEvent = {
  id: string;
  space_id: string | null;
  created_by: string;
  title: string;
  description: string;
  category: string;
  starts_at: string;
  color: string;
  visibility: 'private' | 'shared';
  updated_at: string;
};

type SpaceMember = { space_id: string };

type EventForm = {
  title: string;
  description: string;
  category: string;
  starts_at: string;
  color: string;
  visibility: 'private' | 'shared';
};

const EMPTY_FORM: EventForm = {
  title: '',
  description: '',
  category: 'Date idea',
  starts_at: '',
  color: '#773f91',
  visibility: 'private',
};
const EVENT_COLUMNS = 'id,space_id,created_by,title,description,category,starts_at,color,visibility,updated_at';

function localDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateKeyToLocalDate(key: string) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

function getCalendarDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - mondayOffset);
  return Array.from({ length: 42 }, (_, index) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + index));
}

function getThemeAccent() {
  const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(accent) ? accent : '#773f91';
}

function toLocalInput(value: string) {
  const date = new Date(value);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

export default function Calendar() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [form, setForm] = useState<EventForm>(() => ({ ...EMPTY_FORM, color: getThemeAccent() }));
  const [editingId, setEditingId] = useState<string | null>(null);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(() => localDateKey(new Date()));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadEvents = useCallback(async () => {
    if (!supabase || !session) return;

    let query = supabase.from('calendar_events').select(EVENT_COLUMNS);
    if (spaceId) query = query.or(`created_by.eq.${session.user.id},space_id.eq.${spaceId}`);
    else query = query.eq('created_by', session.user.id);

    const { data, error: loadError } = await query
      .order('starts_at', { ascending: true });
    if (loadError) setError(loadError.message);
    else {
      setEvents((data ?? []) as CalendarEvent[]);
      setError(null);
    }
    setLoading(false);
  }, [session, spaceId]);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to open the calendar.');
      setLoading(false);
      return;
    }

    const client = supabase;
    let active = true;
    async function loadSpace() {
      const { data, error: spaceError } = await client.rpc('get_my_space');
      if (!active) return;
      if (spaceError) setError(spaceError.message);
      else {
        const rows = (Array.isArray(data) ? data : []) as SpaceMember[];
        setSpaceId(rows[0]?.space_id ?? null);
      }
    }

    void loadSpace();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!supabase || !session) return;

    let active = true;
    const client = supabase;
    let channel = client
      .channel(`calendar:${session.user.id}:${spaceId ?? 'personal'}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'calendar_events',
        filter: `created_by=eq.${session.user.id}`,
      }, () => { void loadEvents(); });

    if (spaceId) {
      channel.on('postgres_changes', {
        event: '*', schema: 'public', table: 'calendar_events',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadEvents(); });
    }
    channel = channel.subscribe();

    async function refresh() {
      await loadEvents();
      if (active) setLoading(false);
    }
    void refresh();

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [session, spaceId, loadEvents]);

  function updateForm<K extends keyof EventForm>(key: K, value: EventForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startEdit(event: CalendarEvent) {
    setEditingId(event.id);
    setForm({
      title: event.title,
      description: event.description,
      category: event.category,
      starts_at: toLocalInput(event.starts_at),
      color: event.color,
      visibility: event.visibility,
    });
    const eventDate = new Date(event.starts_at);
    setSelectedDate(localDateKey(eventDate));
    setCalendarMonth(new Date(eventDate.getFullYear(), eventDate.getMonth(), 1));
    setError(null);
    setNotice(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, color: getThemeAccent() });
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session) return;

    const title = form.title.trim();
    const description = form.description.trim();
    const startsAt = new Date(form.starts_at);
    if (!title || Number.isNaN(startsAt.getTime())) {
      setError('Enter a title and valid date and time.');
      return;
    }
    if (form.visibility === 'shared' && !spaceId) {
      setError('Pair your account before creating a shared event.');
      return;
    }

    const values = {
      title,
      description,
      category: form.category,
      starts_at: startsAt.toISOString(),
      color: form.color,
      visibility: form.visibility,
      space_id: form.visibility === 'shared' ? spaceId : null,
    };

    setSaving(true);
    setError(null);
    setNotice(null);
    const result = editingId
      ? await supabase.from('calendar_events').update(values).eq('id', editingId).eq('created_by', session.user.id)
      : await supabase.from('calendar_events').insert({ ...values, created_by: session.user.id });

    if (result.error) setError(result.error.message);
    else {
      setNotice(editingId ? 'Event updated.' : 'Event saved.');
      setEditingId(null);
      setForm({ ...EMPTY_FORM, color: getThemeAccent() });
      await loadEvents();
    }
    setSaving(false);
  }

  async function handleDelete(event: CalendarEvent) {
    if (!supabase || !session) return;
    if (!window.confirm(`Delete “${event.title}”?`)) return;

    const { error: deleteError } = await supabase
      .from('calendar_events')
      .delete()
      .eq('id', event.id)
      .eq('created_by', session.user.id);
    if (deleteError) setError(deleteError.message);
    else {
      setNotice('Event deleted.');
      setEvents((current) => current.filter((item) => item.id !== event.id));
      if (editingId === event.id) cancelEdit();
    }
  }

  if (loading) return <main role="status">Loading calendar...</main>;

  const calendarDays = getCalendarDays(calendarMonth);
  const eventsByDate = new Map<string, CalendarEvent[]>();
  for (const event of events) {
    const key = localDateKey(new Date(event.starts_at));
    eventsByDate.set(key, [...(eventsByDate.get(key) ?? []), event]);
  }
  const selectedEvents = eventsByDate.get(selectedDate) ?? [];
  const todayKey = localDateKey(new Date());
  const monthLabel = calendarMonth.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  function selectCalendarDate(date: Date) {
    const key = localDateKey(date);
    setSelectedDate(key);
    setCalendarMonth(new Date(date.getFullYear(), date.getMonth(), 1));
    if (!editingId) setForm((current) => ({ ...current, starts_at: `${key}T12:00` }));
  }

  function moveCalendarMonth(amount: number) {
    setCalendarMonth((current) => new Date(current.getFullYear(), current.getMonth() + amount, 1));
  }

  return (
    <main className="calendar-page">
      <section className="calendar-panel">
        <header className="calendar-header">
          <div>
            <h1>Shared Calendar</h1>
            <p>Personal notes stay yours; shared events are visible to both partners.</p>
          </div>
        </header>

        <section className="calendar-month" aria-label="Monthly calendar">
          <div className="calendar-month-toolbar">
            <h2>{monthLabel}</h2>
            <div>
              <button type="button" aria-label="Previous month" onClick={() => moveCalendarMonth(-1)}>Previous</button>
              <button type="button" onClick={() => selectCalendarDate(new Date())}>Today</button>
              <button type="button" aria-label="Next month" onClick={() => moveCalendarMonth(1)}>Next</button>
            </div>
          </div>
          <div className="calendar-month-grid" role="grid" aria-label={monthLabel}>
            {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((weekday) => (
              <div className="calendar-weekday" role="columnheader" key={weekday}>{weekday}</div>
            ))}
            {calendarDays.map((day) => {
              const key = localDateKey(day);
              const dayEvents = eventsByDate.get(key) ?? [];
              const inMonth = day.getMonth() === calendarMonth.getMonth();
              return (
                <button
                  type="button"
                  role="gridcell"
                  aria-selected={selectedDate === key}
                  aria-label={`${day.toLocaleDateString()}${dayEvents.length ? `, ${dayEvents.length} events` : ''}`}
                  className={`calendar-day${inMonth ? '' : ' calendar-day-outside'}${selectedDate === key ? ' calendar-day-selected' : ''}${key === todayKey ? ' calendar-day-today' : ''}`}
                  key={key}
                  onClick={() => selectCalendarDate(day)}
                >
                  <span className="calendar-day-number">{day.getDate()}</span>
                  <span className="calendar-day-events">
                    {dayEvents.slice(0, 2).map((event) => (
                      <span
                        className="calendar-event-chip"
                        style={{ borderLeftColor: event.color }}
                        title={`${event.title} · ${event.visibility === 'shared' ? 'Shared' : 'Private'}`}
                        key={event.id}
                      >
                        {event.title}
                      </span>
                    ))}
                    {dayEvents.length > 2 && <span className="calendar-event-overflow">+{dayEvents.length - 2} more</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="calendar-selected-day" aria-live="polite">
          <h2>{dateKeyToLocalDate(selectedDate).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          {selectedEvents.length === 0 ? <p>No events on this day.</p> : selectedEvents.map((event) => (
            <p className="calendar-selected-event" key={event.id}>
              <span className="calendar-color-dot" style={{ backgroundColor: event.color }} aria-hidden="true" />
              <time dateTime={event.starts_at}>{new Date(event.starts_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</time>
              {' · '}{event.title}{' · '}{event.visibility === 'shared' ? 'Shared' : 'Private'}
            </p>
          ))}
        </section>

        <section className="calendar-form-section">
          <h2>{editingId ? 'Edit event' : 'Add an event'}</h2>
          <form className="calendar-form" onSubmit={handleSave}>
            <label htmlFor="event-title">Title</label>
            <input id="event-title" required maxLength={120} value={form.title} onChange={(event) => updateForm('title', event.target.value)} />

            <label htmlFor="event-description">Notes</label>
            <textarea id="event-description" maxLength={5000} value={form.description} onChange={(event) => updateForm('description', event.target.value)} />

            <label htmlFor="event-category">Category</label>
            <select id="event-category" value={form.category} onChange={(event) => updateForm('category', event.target.value)}>
              <option>Date idea</option>
              <option>Birthday</option>
              <option>Anniversary</option>
              <option>Visit</option>
              <option>Reminder</option>
              <option>Milestone</option>
              <option>Other</option>
            </select>

            <label htmlFor="event-start">Date and time</label>
            <input id="event-start" type="datetime-local" required value={form.starts_at} onChange={(event) => updateForm('starts_at', event.target.value)} />

            <label htmlFor="event-color">Event color</label>
            <input id="event-color" type="color" value={form.color} onChange={(event) => updateForm('color', event.target.value)} />

            <label htmlFor="event-visibility">Visibility</label>
            <select id="event-visibility" value={form.visibility} onChange={(event) => updateForm('visibility', event.target.value as EventForm['visibility'])}>
              <option value="private">Private to me</option>
              {spaceId && <option value="shared">Shared with partner</option>}
            </select>

            <div className="calendar-form-actions">
              <button type="submit" disabled={saving}>{saving ? 'Saving...' : editingId ? 'Save changes' : 'Add event'}</button>
              {editingId && <button type="button" disabled={saving} onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </section>

        <section className="calendar-list" aria-live="polite">
          <h2>Agenda</h2>
          {events.length === 0 ? <p>No events yet. Add one above.</p> : events.map((event) => (
            <article className="calendar-event" key={event.id}>
              <div className="calendar-event-main">
                <p className="calendar-event-meta">
                  <time dateTime={event.starts_at}>{new Date(event.starts_at).toLocaleString()}</time>
                  {' · '}{event.category}{' · '}{event.visibility === 'shared' ? 'Shared' : 'Private'}
                </p>
                <h3>{event.title}</h3>
                {event.description && <p>{event.description}</p>}
              </div>
              {event.created_by === session?.user.id && (
                <div className="calendar-event-actions">
                  <button type="button" onClick={() => startEdit(event)}>Edit</button>
                  <button type="button" onClick={() => void handleDelete(event)}>Delete</button>
                </div>
              )}
            </article>
          ))}
        </section>

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}
