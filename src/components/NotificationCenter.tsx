import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';
import { playSound } from '../lib/sound';

type NotificationItem = {
  id: string;
  notification_type: 'chat_message' | 'calendar_event';
  entity_id: string;
  title: string;
  body: string;
  created_at: string;
  read_at: string | null;
};

const NOTIFICATION_COLUMNS = 'id,notification_type,entity_id,title,body,created_at,read_at';

export default function NotificationCenter() {
  const { session } = useAuth();
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const itemRefs = useRef(new Map<string, HTMLLIElement>());
  const markReadRef = useRef<(id: string) => void>(() => {});

  const loadNotifications = useCallback(async () => {
    if (!supabase || !session) return;
    const { data, error: loadError } = await supabase
      .from('evermore_notifications')
      .select(NOTIFICATION_COLUMNS)
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(30);
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
        event: 'INSERT', schema: 'public', table: 'evermore_notifications',
        filter: `user_id=eq.${session.user.id}`,
      }, (payload) => {
        const onChatTab = window.location.pathname.startsWith('/chat');
        const type = (payload.new as { notification_type?: string }).notification_type;
        if (!(onChatTab && type === 'chat_message')) void playSound('alert');
        void loadNotifications();
      })
      .on('postgres_changes', {
        event: 'UPDATE', schema: 'public', table: 'evermore_notifications',
        filter: `user_id=eq.${session.user.id}`,
      }, () => { void loadNotifications(); })
      .subscribe();
    void loadNotifications();
    return () => { void client.removeChannel(channel); };
  }, [session, loadNotifications]);

  const markRead = useCallback(async (id: string) => {
    if (!supabase || !session) return;
    const item = items.find((entry) => entry.id === id);
    if (!item || item.read_at) return;
    const readAt = new Date().toISOString();
    setItems((current) => current.map((entry) => entry.id === id ? { ...entry, read_at: readAt } : entry));
    const { error: updateError } = await supabase
      .from('evermore_notifications')
      .update({ read_at: readAt })
      .eq('id', id)
      .eq('user_id', session.user.id);
    if (updateError) {
      setError(updateError.message);
      await loadNotifications();
    }
  }, [items, session, loadNotifications]);
  markReadRef.current = (id) => { void markRead(id); };

  useEffect(() => {
    if (!open || !panelRef.current || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting && entry.intersectionRatio >= 0.7) {
          const notificationId = (entry.target as HTMLLIElement).dataset.notificationId;
          if (notificationId) markReadRef.current(notificationId);
        }
      }
    }, { root: panelRef.current, threshold: 0.7 });
    for (const element of itemRefs.current.values()) observer.observe(element);
    return () => observer.disconnect();
  }, [open, items]);

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
        <section className="notification-panel" id="notification-panel" aria-label="Notifications" ref={panelRef}>
          <header><h2>Notifications</h2><button type="button" aria-label="Close notifications" onClick={() => setOpen(false)}>Close</button></header>
          {error && <p role="alert">{error}</p>}
          {items.length === 0 ? <p className="notification-empty">Nothing new yet.</p> : (
            <ul>
              {items.map((item) => {
                const href = item.notification_type === 'calendar_event' ? '/calendar' : '/chat';
                return (
                  <li
                    className={item.read_at ? '' : 'is-unread'}
                    data-notification-id={item.id}
                    key={item.id}
                    ref={(element) => { if (element) itemRefs.current.set(item.id, element); else itemRefs.current.delete(item.id); }}
                  >
                    <Link to={href} onClick={() => { markReadRef.current(item.id); setOpen(false); }}>
                      <strong>{item.title}</strong>
                      {item.body && <span>{item.body}</span>}
                      <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
                    </Link>
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
