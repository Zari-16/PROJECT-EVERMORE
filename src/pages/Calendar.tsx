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
  recurrence: 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
  recurrence_until: string | null;
  reminder_minutes: number | null;
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
  recurrence: CalendarEvent['recurrence'];
  recurrence_until: string;
  reminder_minutes: string;
};

const EMPTY_FORM: EventForm = {
  title: '',
  description: '',
  category: 'Date idea',
  starts_at: '',
  color: '#773f91',
  visibility: 'private',
  recurrence: 'none',
  recurrence_until: '',
  reminder_minutes: '',
};
const EVENT_COLUMNS = 'id,space_id,created_by,title,description,category,starts_at,color,visibility,recurrence,recurrence_until,reminder_minutes,updated_at';

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

function occursOnDate(event: CalendarEvent, day: Date) {
  const start = new Date(event.starts_at);
  const dayKey = localDateKey(day);
  const startKey = localDateKey(start);
  if (dayKey < startKey || (event.recurrence_until && dayKey > event.recurrence_until)) return false;
  if (dayKey === startKey || event.recurrence === 'daily') return true;
  if (event.recurrence === 'none') return false;
  if (event.recurrence === 'weekly') return day.getDay() === start.getDay();
  if (event.recurrence === 'monthly') {
    const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
    return day.getDate() === Math.min(start.getDate(), lastDay);
  }
  if (day.getMonth() !== start.getMonth()) return false;
  const lastDay = new Date(day.getFullYear(), day.getMonth() + 1, 0).getDate();
  return day.getDate() === Math.min(start.getDate(), lastDay);
}

function nextOccurrence(event: CalendarEvent, after: Date): Date | null {
  const start = new Date(event.starts_at);
  if (event.recurrence === 'none') return start > after ? start : null;
  const candidate = new Date(start);
  const originalDay = start.getDate();
  for (let count = 0; count < 5000 && candidate <= after; count += 1) {
    if (event.recurrence === 'daily') candidate.setDate(candidate.getDate() + 1);
    else if (event.recurrence === 'weekly') candidate.setDate(candidate.getDate() + 7);
    else if (event.recurrence === 'monthly') {
      candidate.setDate(1);
      candidate.setMonth(candidate.getMonth() + 1);
      candidate.setDate(Math.min(originalDay, new Date(candidate.getFullYear(), candidate.getMonth() + 1, 0).getDate()));
    } else {
      candidate.setFullYear(candidate.getFullYear() + 1);
      if (candidate.getMonth() !== start.getMonth()) candidate.setDate(0);
    }
  }
  if (event.recurrence_until && localDateKey(candidate) > event.recurrence_until) return null;
  return candidate > after ? candidate : null;
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
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission | 'unsupported'>(() =>
    typeof Notification === 'undefined' ? 'unsupported' : Notification.permission,
  );

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
      recurrence: event.recurrence,
      recurrence_until: event.recurrence_until ?? '',
      reminder_minutes: event.reminder_minutes === null ? '' : String(event.reminder_minutes),
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
      recurrence: form.recurrence,
      recurrence_until: form.recurrence === 'none' ? null : form.recurrence_until || null,
      reminder_minutes: form.reminder_minutes === '' ? null : Number(form.reminder_minutes),
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
  for (const day of calendarDays) {
    const key = localDateKey(day);
    const dayEvents = events.filter((event) => occursOnDate(event, day));
    if (dayEvents.length) eventsByDate.set(key, dayEvents);
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

  async function enableBrowserReminders() {
    if (typeof Notification === 'undefined') {
      setNotificationPermission('unsupported');
      return;
    }
    setNotificationPermission(await Notification.requestPermission());
  }

  useEffect(() => {
    if (notificationPermission !== 'granted' || !session) return;
    const checkReminders = () => {
      const now = new Date();
      for (const event of events) {
        if (event.reminder_minutes === null) continue;
        const occurrence = nextOccurrence(event, new Date(now.getTime() - event.reminder_minutes * 60_000));
        if (!occurrence) continue;
        const reminderAt = occurrence.getTime() - event.reminder_minutes * 60_000;
        if (now.getTime() < reminderAt || now.getTime() >= occurrence.getTime()) continue;
        const key = `evermore:calendar-reminder:${session.user.id}:${event.id}:${occurrence.toISOString()}`;
        if (window.localStorage.getItem(key)) continue;
        new Notification(event.title, { body: `Coming up ${occurrence.toLocaleString()}` });
        window.localStorage.setItem(key, 'sent');
      }
    };
    checkReminders();
    const timer = window.setInterval(checkReminders, 30_000);
    return () => window.clearInterval(timer);
  }, [events, notificationPermission, session]);

  return (
    <main className="calendar-page">
      <section className="calendar-panel">
        <header className="calendar-header">
          <div>
            <h1>Shared Calendar</h1>
            <p>Personal notes stay yours; shared events are visible to both partners.</p>
          </div>
          {notificationPermission === 'default' && <button type="button" onClick={() => void enableBrowserReminders()}>Enable browser reminders</button>}
          {notificationPermission === 'denied' && <span className="calendar-reminder-note">Browser reminders are blocked in site settings.</span>}
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

            <label htmlFor="event-recurrence">Repeat</label>
            <select id="event-recurrence" value={form.recurrence} onChange={(event) => updateForm('recurrence', event.target.value as EventForm['recurrence'])}>
              <option value="none">Does not repeat</option>
              <option value="daily">Every day</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
            </select>

            {form.recurrence !== 'none' && <>
              <label htmlFor="event-recurrence-until">Repeat until (optional)</label>
              <input id="event-recurrence-until" type="date" min={form.starts_at.slice(0, 10)} value={form.recurrence_until} onChange={(event) => updateForm('recurrence_until', event.target.value)} />
            </>}

            <label htmlFor="event-reminder">Reminder</label>
            <select id="event-reminder" value={form.reminder_minutes} onChange={(event) => updateForm('reminder_minutes', event.target.value)}>
              <option value="">No reminder</option>
              <option value="0">At event time</option>
              <option value="5">5 minutes before</option>
              <option value="10">10 minutes before</option>
              <option value="15">15 minutes before</option>
              <option value="30">30 minutes before</option>
              <option value="60">1 hour before</option>
              <option value="1440">1 day before</option>
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
                  {' · '}{event.category}{' · '}{event.visibility === 'shared' ? 'Shared' : 'Private'}{event.recurrence !== 'none' ? ` · ${event.recurrence}` : ''}{event.reminder_minutes !== null ? ' · reminder set' : ''}
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
