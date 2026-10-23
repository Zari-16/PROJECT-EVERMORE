import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type ChatMessage = {
  id: string;
  space_id: string;
  author: string;
  content: string | null;
  created_at: string;
  edited_at: string | null;
  deleted: boolean;
  metadata: { attachments?: ChatAttachment[] } | null;
  attachments?: ChatAttachment[];
};
type ChatAttachment = { path: string; file_name: string; mime_type: string; file_size: number; url?: string };
type ChatReaction = { message_id: string; user_id: string; reaction: 'heart' | 'laugh' | 'support' | 'wow' };

type SpaceMember = {
  space_id: string;
  space_name: string;
  member_id: string;
  member_display_name: string | null;
};

const PAGE_SIZE = 40;
const MESSAGE_COLUMNS = 'id,space_id,author,content,created_at,edited_at,deleted,metadata';
const REACTION_OPTIONS = [
  { value: 'heart', icon: '♥', label: 'Heart' },
  { value: 'laugh', icon: '☺', label: 'Laugh' },
  { value: 'support', icon: '✦', label: 'Support' },
  { value: 'wow', icon: '!', label: 'Wow' },
] as const;
const ALLOWED_ATTACHMENT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']);

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
  const [reactions, setReactions] = useState<ChatReaction[]>([]);
  const [draft, setDraft] = useState('');
  const [attachmentFiles, setAttachmentFiles] = useState<File[]>([]);
  const [partnerTyping, setPartnerTyping] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [sending, setSending] = useState(false);
  const [hasOlder, setHasOlder] = useState(false);
  const [connection, setConnection] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const localTypingTimerRef = useRef<number | null>(null);
  const partnerTypingTimerRef = useRef<number | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  async function hydrateMessages(rows: ChatMessage[]) {
    if (!supabase) return rows;
    const client = supabase;
    return Promise.all(rows.map(async (message) => {
      const attachments = message.metadata?.attachments ?? [];
      const signed = await Promise.all(attachments.map(async (attachment) => {
        const { data } = await client.storage.from('evermore-private').createSignedUrl(attachment.path, 3600);
        return { ...attachment, url: data?.signedUrl };
      }));
      return { ...message, attachments: signed };
    }));
  }

  async function loadReactions(messageIds: string[]) {
    if (!supabase || !messageIds.length) return;
    const { data, error: reactionError } = await supabase
      .from('message_reactions')
      .select('message_id,user_id,reaction')
      .in('message_id', messageIds);
    if (reactionError) setError(reactionError.message);
    else {
      const loadedIds = new Set(messageIds);
      setReactions((current) => [
        ...current.filter((reaction) => !loadedIds.has(reaction.message_id)),
        ...((data ?? []) as ChatReaction[]),
      ]);
    }
  }

  async function refreshUnread() {
    if (!supabase || !spaceId) return;
    const { data, error: unreadError } = await supabase.rpc('get_chat_unread_count', { p_space_id: spaceId });
    if (unreadError) setError(unreadError.message);
    else setUnreadCount(Number(data ?? 0));
  }

  function announceTyping() {
    if (!channelRef.current || !session) return;
    void channelRef.current.send({ type: 'broadcast', event: 'typing', payload: { user_id: session.user.id, typing: true } });
    if (localTypingTimerRef.current !== null) window.clearTimeout(localTypingTimerRef.current);
    localTypingTimerRef.current = window.setTimeout(() => {
      void channelRef.current?.send({ type: 'broadcast', event: 'typing', payload: { user_id: session.user.id, typing: false } });
    }, 1800);
  }
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
    const channel = client
      .channel(`messages:${spaceId}`, { config: { private: true } })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'messages',
        filter: `space_id=eq.${spaceId}`,
      }, (payload) => {
        const message = payload.new as ChatMessage;
        if (message?.id) {
          void hydrateMessages([message]).then((hydrated) => setMessages((current) => mergeMessages(current, hydrated)));
          void refreshUnread();
        }
      })
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'message_reactions',
      }, () => { void loadReactions(messagesRef.current.map((message) => message.id)); })
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.user_id === session?.user.id) return;
        setPartnerTyping(Boolean(payload?.typing));
        if (partnerTypingTimerRef.current !== null) window.clearTimeout(partnerTypingTimerRef.current);
        if (payload?.typing) partnerTypingTimerRef.current = window.setTimeout(() => setPartnerTyping(false), 2500);
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') setConnection('connected');
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
          setConnection('disconnected');
        } else setConnection('connecting');
      });
    channelRef.current = channel;

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
        const page = await hydrateMessages((data ?? []).reverse() as ChatMessage[]);
        setMessages((current) => mergeMessages(current, page));
        setHasOlder(page.length === PAGE_SIZE);
        setError(null);
        await Promise.all([loadReactions(page.map((message) => message.id)), refreshUnread()]);
      }
      setLoading(false);
    }

    void loadRecentMessages();
    return () => {
      active = false;
      channelRef.current = null;
      if (localTypingTimerRef.current !== null) window.clearTimeout(localTypingTimerRef.current);
      if (partnerTypingTimerRef.current !== null) window.clearTimeout(partnerTypingTimerRef.current);
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

    if (olderError) setError(olderError.message);
    else {
      const page = await hydrateMessages((data ?? []).reverse() as ChatMessage[]);
      setMessages((current) => mergeMessages(page, current));
      setHasOlder(page.length === PAGE_SIZE);
      await loadReactions(page.map((message) => message.id));
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
    const uploaded: ChatAttachment[] = [];
    for (const file of attachmentFiles) {
      if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
        setError(`${file.name} is not an allowed attachment type.`);
        if (uploaded.length) await supabase.storage.from('evermore-private').remove(uploaded.map((item) => item.path));
        setSending(false);
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} exceeds the 10 MB limit.`);
        if (uploaded.length) await supabase.storage.from('evermore-private').remove(uploaded.map((item) => item.path));
        setSending(false);
        return;
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${spaceId}/${session.user.id}/chat/${crypto.randomUUID()}-${safeName}`;
      const { error: uploadError } = await supabase.storage.from('evermore-private').upload(path, file, { contentType: file.type, upsert: false });
      if (uploadError) {
        setError(uploadError.message);
        if (uploaded.length) await supabase.storage.from('evermore-private').remove(uploaded.map((item) => item.path));
        setSending(false);
        return;
      }
      uploaded.push({ path, file_name: file.name, mime_type: file.type || 'application/octet-stream', file_size: file.size });
    }

    const { data, error: sendError } = await supabase
      .from('messages')
      .insert({ space_id: spaceId, author: session.user.id, content, metadata: { attachments: uploaded } })
      .select(MESSAGE_COLUMNS)
      .single();

    if (sendError) {
      setError(sendError.message);
      if (uploaded.length) await supabase.storage.from('evermore-private').remove(uploaded.map((item) => item.path));
    }
    else {
      const [hydrated] = await hydrateMessages([data as ChatMessage]);
      setMessages((current) => mergeMessages(current, [hydrated]));
      setDraft('');
      setAttachmentFiles([]);
      await refreshUnread();
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
    const attachmentPaths = messages.find((message) => message.id === messageId)?.attachments?.map((attachment) => attachment.path) ?? [];
    const { data, error: deleteError } = await supabase
      .from('messages')
      .update({ content: null, deleted: true, edited_at: new Date().toISOString() })
      .eq('id', messageId)
      .eq('author', session.user.id)
      .select(MESSAGE_COLUMNS)
      .single();

    if (deleteError) setError(deleteError.message);
    else {
      setMessages((current) => mergeMessages(current, [data as ChatMessage]));
      if (attachmentPaths.length) {
        const { error: storageError } = await supabase.storage.from('evermore-private').remove(attachmentPaths);
        if (storageError) setError(`Message deleted, but attachment cleanup failed: ${storageError.message}`);
      }
    }
  }

  async function toggleReaction(messageId: string, reaction: ChatReaction['reaction']) {
    if (!supabase || !session) return;
    const existing = reactions.some((item) => item.message_id === messageId && item.user_id === session.user.id && item.reaction === reaction);
    const result = existing
      ? await supabase.from('message_reactions').delete().eq('message_id', messageId).eq('user_id', session.user.id).eq('reaction', reaction)
      : await supabase.from('message_reactions').insert({ message_id: messageId, user_id: session.user.id, reaction });
    if (result.error) setError(result.error.message);
    else await loadReactions(messages.map((message) => message.id));
  }

  useEffect(() => {
    if (!supabase || !spaceId || loading || document.visibilityState !== 'visible') return;
    void supabase.rpc('mark_chat_read', { p_space_id: spaceId }).then(({ error: readError }) => {
      if (readError) setError(readError.message);
      else void refreshUnread();
    });
  }, [spaceId, loading, messages.length]);

  useEffect(() => {
    if (!supabase || !spaceId) return;
    const client = supabase;
    const updateUnread = () => {
      if (document.visibilityState !== 'visible') return;
      void client.rpc('get_chat_unread_count', { p_space_id: spaceId })
        .then(({ data, error: unreadError }) => {
          if (unreadError) setError(unreadError.message);
          else setUnreadCount(Number(data ?? 0));
        });
    };
    document.addEventListener('visibilitychange', updateUnread);
    return () => document.removeEventListener('visibilitychange', updateUnread);
  }, [spaceId]);

  if (loading) return <main role="status">Loading chat...</main>;

  const memberNames = new Map(members.map((member) => [member.member_id, member.member_display_name || 'Evermore member']));

  return (
    <main className="chat-page">
      <section className="chat-panel" aria-label="Shared chat">
        <header className="chat-header">
          <div>
            <h1>{spaceName || 'Our Chat'}</h1>
            <p>{members.map((member) => member.member_display_name || 'Evermore member').join(' and ')}</p>
          </div>
          <div className="chat-header-meta">
          {unreadCount > 0 && <span className="chat-unread-count" aria-label={`${unreadCount} unread messages`}>{unreadCount} unread</span>}
          <span className={`chat-connection chat-connection-${connection}`} role="status">
            {connection === 'connected' ? 'Live' : connection === 'connecting' ? 'Connecting...' : 'Reconnecting...'}
          </span>
          </div>
        </header>

        {error && <p className="chat-feedback" role="alert">{error}</p>}
        {notice && <p className="chat-feedback" role="status">{notice}</p>}

        {!spaceId ? (
          <p>Pair your account first. <Link to="/pairing">Go to Pairing</Link></p>
        ) : (
          <>
            <div className="chat-messages" aria-live="polite" aria-relevant="additions text">
              {hasOlder && (
                <button type="button" disabled={loadingOlder} onClick={loadOlderMessages}>
                  {loadingOlder ? 'Loading...' : 'Load older messages'}
                </button>
              )}
              {messages.length === 0 && <p className="chat-empty">No messages yet. Send the first one.</p>}
              {messages.map((message) => {
                const ownMessage = message.author === session?.user.id;
                return (
                  <article className={`chat-message ${ownMessage ? 'chat-message-own' : ''}`} key={message.id}>
                    <header>
                      <strong>{ownMessage ? 'You' : memberNames.get(message.author) || 'Partner'}</strong>
                      <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time>
                    </header>
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
                    {message.attachments?.map((attachment) => attachment.url && (
                      <a className="chat-attachment" key={attachment.path} href={attachment.url} target="_blank" rel="noreferrer">
                        {attachment.mime_type.startsWith('image/') ? <img src={attachment.url} alt={attachment.file_name} loading="lazy" /> : <span>{attachment.file_name}</span>}
                      </a>
                    ))}
                    {!message.deleted && <div className="chat-reactions" aria-label="Message reactions">
                      {REACTION_OPTIONS.map((item) => {
                        const matching = reactions.filter((reaction) => reaction.message_id === message.id && reaction.reaction === item.value);
                        return <button className={matching.some((reaction) => reaction.user_id === session?.user.id) ? 'is-reacted' : ''} type="button" key={item.value} aria-label={`${item.label} reaction`} aria-pressed={matching.some((reaction) => reaction.user_id === session?.user.id)} onClick={() => void toggleReaction(message.id, item.value)}>{item.icon}{matching.length > 0 && <span>{matching.length}</span>}</button>;
                      })}
                    </div>}
                    {!message.deleted && message.edited_at && <small>Edited</small>}
                    {ownMessage && !message.deleted && editingId !== message.id && (
                      <footer>
                        <button type="button" onClick={() => { setEditingId(message.id); setEditDraft(message.content ?? ''); }}>
                          Edit
                        </button>
                        <button type="button" onClick={() => void handleDelete(message.id)}>
                          Delete for both
                        </button>
                      </footer>
                    )}
                  </article>
                );
              })}
            </div>

            {partnerTyping && <p className="chat-typing" role="status">Your partner is typing...</p>}

            <form className="chat-composer" onSubmit={handleSend}>
              <label className="visually-hidden" htmlFor="chat-draft">Write a message</label>
              <textarea
                id="chat-draft"
                maxLength={4000}
                placeholder="Write a message..."
                required
                value={draft}
                onChange={(event) => { setDraft(event.target.value); announceTyping(); }}
              />
              <label className="chat-attachment-picker">
                Attach files
                <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" onChange={(event) => setAttachmentFiles(Array.from(event.target.files ?? []))} />
              </label>
              {attachmentFiles.length > 0 && <span className="chat-selected-files">{attachmentFiles.map((file) => file.name).join(', ')}</span>}
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
