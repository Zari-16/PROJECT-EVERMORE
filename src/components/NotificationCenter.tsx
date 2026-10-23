import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';

type NotificationItem = {
  id: string;
  notification_type: 'chat_message' | 'calendar_event';
  entity_id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

const COLUMNS = 'id,notification_type,entity_id,title,body,created_at,read_at';

export default function NotificationCenter() {
  const { session } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadNotifications = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error: loadError } = await supabase
      .from('evermore_notifications')
      .select(COLUMNS)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(20);
    if (loadError) setError(loadError.message);
    else {
      setItems((data ?? []) as NotificationItem[]);
      setError(null);
    }
  }, [session]);

  useEffect(() => {
    if (!supabase || !session) return;
    const client = supabase;
    const channel = client
      .channel(`notifications:${session.user.id}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'evermore_notifications',
        filter: `user_id=eq.${session.user.id}`,
      }, () => { void loadNotifications(); })
      .subscribe();
    void loadNotifications();
    return () => { void client.removeChannel(channel); };
  }, [session, loadNotifications]);

  async function markRead(item: NotificationItem) {
    if (item.read_at || !supabase) return;
    const readAt = new Date().toISOString();
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, read_at: readAt } : entry));
    const { error: updateError } = await supabase
      .from('evermore_notifications')
      .update({ read_at: readAt })
      .eq('id', item.id)
      .eq('user_id', session?.user.id);
    if (updateError) {
      setError(updateError.message);
      await loadNotifications();
    }
  }

  const unreadCount = items.filter((item) => !item.read_at).length;

  return (
    <div className="notification-center">
      <button
        className="notification-trigger"
        type="button"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((current) => !current)}
      >
        Alerts{unreadCount > 0 && <span className="notification-count">{unreadCount > 99 ? '99+' : unreadCount}</span>}
      </button>
      {open && (
        <section className="notification-panel" id="notification-panel" aria-label="Notifications">
          <header><h2>Notifications</h2><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}>Close</button></header>
          {error && <p role="alert">{error}</p>}
          {items.length === 0 ? <p className="notification-empty">Nothing new yet.</p> : (
            <ul>
              {items.map((item) => {
                const href = item.notification_type === 'calendar_event' ? '/calendar' : '/chat';
                return (
                  <li className={item.read_at ? '' : 'is-unread'} key={item.id}>
                    <Link to={href} onClick={() => { void markRead(item); setOpen(false); }}>
                      <strong>{item.title}</strong>
                      {item.body && <span>{item.body}</span>}
                      <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
                    </Link>
                    {!item.read_at && <button className="notification-mark-read" type="button" onClick={() => void markRead(item)}>Mark read</button>}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
