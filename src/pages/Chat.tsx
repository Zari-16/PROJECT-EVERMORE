import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';
import { playSound } from '../lib/sound';

type ChatMessage = {
  id: string;
  space_id: string;
  author: string;
  content: string | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  reply_to: string | null;
};

type SpaceMember = {
  space_id: string;
  space_name: string;
  member_id: string;
  member_display_name: string | null;
};

const PAGE_SIZE = 40;
const MESSAGE_COLUMNS = 'id,space_id,author,content,created_at,edited_at,deleted,reply_to';

function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id),
  );
}

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? (data[0] as T | undefined) ?? null : null;
}

export default function Chat() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [spaceName, setSpaceName] = useState('');
  const [members, setMembers] = useState<SpaceMember[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const didInitialScrollRef = useRef(false);
  const followLatestRef = useRef(true);
  const previousScrollHeightRef = useRef<number | null>(null);

  useLayoutEffect(() => {
    const container = messagesContainerRef.current;
    if (!container || loading) return;

    if (previousScrollHeightRef.current !== null) {
      container.scrollTop += container.scrollHeight - previousScrollHeightRef.current;
      previousScrollHeightRef.current = null;
      return;
    }
    if (!didInitialScrollRef.current || followLatestRef.current) {
      container.scrollTop = container.scrollHeight;
      didInitialScrollRef.current = true;
      followLatestRef.current = true;
    }
  }, [messages, loading]);
  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to open chat.');
      setLoading(false);
      return;
    }

    const client = supabase;
    let active = true;
    async function loadSpace() {
      const { data, error: spaceError } = await client.rpc('get_my_space');
      if (!active) return;
      if (spaceError) {
        setError(spaceError.message);
      } else if (!Array.isArray(data) || data.length === 0) {
        setError('Pair your account in the Pairing page before using chat.');
      } else {
        const rows = data as SpaceMember[];
        setMembers(rows);
        setSpaceId(rows[0].space_id);
        setSpaceName(rows[0].space_name);
        setError(null);
      }
      setLoading(false);
    }

    void loadSpace();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    if (!supabase || !spaceId) return;

    setLoading(true);
    let active = true;
    const client = supabase;
    const currentUserId = session?.user.id;
    const channel = client
      .channel(`messages:${spaceId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `space_id=eq.${spaceId}`,
      }, (payload) => {
        const message = payload.new as ChatMessage;
        if (!message?.id) return;
        if (payload.eventType === 'INSERT' && message.author !== currentUserId) {
          const parent = message.reply_to ? messagesRef.current.find((item) => item.id === message.reply_to) : undefined;
          void playSound(parent?.author === currentUserId ? 'replyPing' : 'messageReceived');
        }
        setMessages((current) => mergeMessages(current, [message]));
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('disconnected');
        } else setConnection('connecting');
      });

    async function loadRecentMessages() {
      const { data, error: messagesError } = await client
        .from('messages')
        .select(MESSAGE_COLUMNS)
        .eq('space_id', spaceId)
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(PAGE_SIZE);

      if (!active) return;
      if (messagesError) {
        setError(messagesError.message);
      } else {
        const page = (data ?? []).reverse() as ChatMessage[];
        setMessages((current) => mergeMessages(current, page));
        setHasOlder(page.length === PAGE_SIZE);
        setError(null);
      }
      setLoading(false);
    }

    void loadRecentMessages();
    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [spaceId]);

  async function loadOlderMessages() {
    if (!supabase || !spaceId || !messages.length || loadingOlder) return;

    const oldest = messages[0];
    setLoadingOlder(true);
    const { data, error: olderError } = await supabase
      .from('messages')
      .select(MESSAGE_COLUMNS)
      .eq('space_id', spaceId)
      .lt('created_at', oldest.created_at)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PAGE_SIZE);

    if (olderError) {
      previousScrollHeightRef.current = null;
      setError(olderError.message);
    }
    else {
      const page = (data ?? []).reverse() as ChatMessage[];
      previousScrollHeightRef.current = messagesContainerRef.current?.scrollHeight ?? null;
      setMessages((current) => mergeMessages(page, current));
      setHasOlder(page.length === PAGE_SIZE);
      setError(null);
    }
    setLoadingOlder(false);
  }

  async function handleSend(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !spaceId || !session) return;

    const content = draft.trim();
    if (!content || content.length > 4000) return;

    setSending(true);
    setError(null);
    setNotice(null);
    const { data, error: sendError } = await supabase
      .from('messages')
      .insert({ space_id: spaceId, author: session.user.id, content, reply_to: replyingTo?.id ?? null })
      .select(MESSAGE_COLUMNS)
      .single();

    if (sendError) setError(sendError.message);
    else {
      followLatestRef.current = true;
      setMessages((current) => mergeMessages(current, [data as ChatMessage]));
      setDraft('');
      setReplyingTo(null);
      void playSound('messageSent');
    }
    setSending(false);
  }

  async function handleEdit(event: FormEvent<HTMLFormElement>, messageId: string) {
    event.preventDefault();
    if (!supabase || !session) return;

    const content = editDraft.trim();
    if (!content || content.length > 4000) return;

    setError(null);
    const { data, error: editError } = await supabase
      .from('messages')
      .update({ content, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('author', session.user.id)
      .select(MESSAGE_COLUMNS)
      .single();

    if (editError) setError(editError.message);
    else {
      setMessages((current) => mergeMessages(current, [data as ChatMessage]));
      setEditingId(null);
      setEditDraft('');
    }
  }

  async function handleDelete(messageId: string) {
    if (!supabase || !session) return;
    if (!window.confirm('Delete this message for both people?')) return;

    setError(null);
    const { data, error: deleteError } = await supabase
      .from('messages')
      .update({ content: null, deleted: true, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('author', session.user.id)
      .select(MESSAGE_COLUMNS)
      .single();

    if (deleteError) setError(deleteError.message);
    else setMessages((current) => mergeMessages(current, [data as ChatMessage]));
  }

  function jumpToMessage(messageId: string) {
    const element = document.getElementById(`chat-message-${messageId}`);
    if (!element) {
      setNotice('That message is older than what is loaded. Use Load older messages to find it.');
      return;
    }
    followLatestRef.current = false;
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setHighlightedId(messageId);
    window.setTimeout(() => setHighlightedId(null), 1600);
  }

  if (loading) return <main role="status">Loading chat...</main>;

  const memberNames = new Map(members.map((member) => [member.member_id, member.member_display_name || 'Evermore member']));
  const authorLabel = (authorId: string) => authorId === session?.user.id ? 'You' : memberNames.get(authorId) || 'Partner';

  return (
    <main className="chat-page">
      <section className="chat-panel" aria-label="Shared chat">
        <header className="chat-header">
          <div>
            <h1>{spaceName || 'Our Chat'}</h1>
            <p>{members.map((member) => member.member_display_name || 'Evermore member').join(' and ')}</p>
          </div>
          <span className={`chat-connection chat-connection-${connection}`} role="status">
            {connection === 'connected' ? 'Live' : connection === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
          </span>
        </header>

        {error && <p className="chat-feedback" role="alert">{error}</p>}
        {notice && <p className="chat-feedback" role="status">{notice}</p>}

        {!spaceId ? (
          <p>Pair your account first. <Link to="/pairing">Go to Pairing</Link></p>
        ) : (
          <>
            <div
              ref={messagesContainerRef}
              className="chat-messages"
              aria-live="polite"
              aria-relevant="additions text"
              onScroll={(event) => {
                const element = event.currentTarget;
                followLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
              }}
            >
              {hasOlder && (
                <button type="button" disabled={loadingOlder} onClick={loadOlderMessages}>
                  {loadingOlder ? 'Loading...' : 'Load older messages'}
                </button>
              )}
              {messages.length === 0 && <p className="chat-empty">No messages yet. Send the first one.</p>}
              {messages.map((message) => {
                const ownMessage = message.author === session?.user.id;
                return (
                  <article
                    className={`chat-message ${ownMessage ? 'chat-message-own' : ''}${highlightedId === message.id ? ' is-highlighted' : ''}`}
                    id={`chat-message-${message.id}`}
                    key={message.id}
                  >
                    <header>
                      <strong>{authorLabel(message.author)}</strong>
                      <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time>
                    </header>
                    {message.reply_to && (() => {
                      const parent = messages.find((item) => item.id === message.reply_to);
                      return (
                        <button type="button" className="chat-quote" onClick={() => jumpToMessage(message.reply_to as string)}>
                          <strong>{parent ? authorLabel(parent.author) : 'Earlier message'}</strong>
                          <span>{parent ? (parent.deleted ? 'Message deleted' : parent.content) : 'Open to find the original'}</span>
                        </button>
                      );
                    })()}
                    {message.deleted ? (
                      <p className="chat-deleted">Message deleted</p>
                    ) : editingId === message.id ? (
                      <form onSubmit={(event) => handleEdit(event, message.id)}>
                        <textarea
                          aria-label="Edit message"
                          maxLength={4000}
                          required
                          value={editDraft}
                          onChange={(event) => setEditDraft(event.target.value)}
                        />
                        <button type="submit" disabled={!editDraft.trim()}>Save edit</button>
                        <button type="button" onClick={() => setEditingId(null)}>Cancel</button>
                      </form>
                    ) : (
                      <p>{message.content}</p>
                    )}
                    {!message.deleted && message.edited_at && <small>Edited</small>}
                    {!message.deleted && editingId !== message.id && (
                      <footer>
                        <button type="button" onClick={() => { setReplyingTo(message); document.getElementById('chat-draft')?.focus(); }}>
                          Reply
                        </button>
                        {ownMessage && (
                          <>
                            <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.content ?? ''); }}>
                              Edit
                            </button>
                            <button type="button" onClick={() => void handleDelete(message.id)}>
                              Delete for both
                            </button>
                          </>
                        )}
                      </footer>
                    )}
                  </article>
                );
              })}
            </div>

            <form className="chat-composer" onSubmit={handleSend}>
              {replyingTo && (
                <div className="chat-reply-bar">
                  <span>Replying to <strong>{authorLabel(replyingTo.author)}</strong>: {replyingTo.content}</span>
                  <button type="button" aria-label="Cancel reply" onClick={() => setReplyingTo(null)}>Cancel</button>
                </div>
              )}
              <label className="visually-hidden" htmlFor="chat-draft">Write a message</label>
              <textarea
                id="chat-draft"
                maxLength={4000}
                placeholder="Write a message..."
                required
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
              />
              <button type="submit" disabled={sending || !draft.trim() || connection === 'disconnected'}>
                {sending ? 'Sending...' : 'Send'}
              </button>
              <small>{draft.length}/4000</small>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
