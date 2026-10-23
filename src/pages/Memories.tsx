import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type Memory = {
  id: string;
  space_id: string | null;
  created_by: string;
  title: string;
  body: string;
  memory_date: string | null;
  category: string;
  visibility: 'private' | 'shared';
  created_at: string;
  updated_at: string;
};
type MemoryAttachment = {
  id: string;
  memory_id: string;
  storage_path: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  created_by: string;
  created_at: string;
  url?: string;
};

type SpaceRow = { space_id: string };
type MemoryForm = {
  title: string;
  body: string;
  memory_date: string;
  category: string;
  visibility: 'private' | 'shared';
};

const EMPTY_FORM: MemoryForm = {
  title: '',
  body: '',
  memory_date: '',
  category: 'Moment',
  visibility: 'private',
};
const MEMORY_COLUMNS = 'id,space_id,created_by,title,body,memory_date,category,visibility,created_at,updated_at';
const MEMORY_FILE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'text/plain']);

export default function Memories() {
  const { session } = useAuth();
  const [spaceId, setSpaceId] = useState<string | null>(null);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [attachments, setAttachments] = useState<Record<string, MemoryAttachment[]>>({});
  const [form, setForm] = useState<MemoryForm>(EMPTY_FORM);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [openedMemoryId, setOpenedMemoryId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAttachments = useCallback(async (rows: Memory[]) => {
    if (!supabase || rows.length === 0) {
      setAttachments({});
      return true;
    }
    const client = supabase;
    const { data, error: attachmentError } = await client.rpc('get_memory_attachments', {
      p_memory_ids: rows.map((memory) => memory.id),
    });
    if (attachmentError) {
      setError(attachmentError.message);
      return false;
    }
    const signedRows = await Promise.all(((data ?? []) as MemoryAttachment[]).map(async (attachment) => {
      const { data: signed } = await client.storage.from('evermore-private').createSignedUrl(attachment.storage_path, 3600);
      return { ...attachment, url: signed?.signedUrl };
    }));
    const grouped: Record<string, MemoryAttachment[]> = {};
    for (const attachment of signedRows) {
      (grouped[attachment.memory_id] ??= []).push(attachment);
    }
    setAttachments(grouped);
    return true;
  }, []);

  const loadMemories = useCallback(async () => {
    if (!supabase || !session) return;

    let query = supabase.from('memories').select(MEMORY_COLUMNS);
    if (spaceId) query = query.or(`created_by.eq.${session.user.id},space_id.eq.${spaceId}`);
    else query = query.eq('created_by', session.user.id);

    const { data, error: loadError } = await query
      .order('memory_date', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false });

    if (loadError) setError(loadError.message);
    else {
      const rows = (data ?? []) as Memory[];
      setMemories(rows);
      const attachmentsLoaded = await loadAttachments(rows);
      if (attachmentsLoaded) setError(null);
    }
    setLoading(false);
  }, [session, spaceId, loadAttachments]);

  useEffect(() => {
    if (!supabase || !session) {
      setError('Sign in to open the Memory Garden.');
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
        const rows = (Array.isArray(data) ? data : []) as SpaceRow[];
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
      .channel(`memories:${session.user.id}:${spaceId ?? 'personal'}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'memories',
        filter: `created_by=eq.${session.user.id}`,
      }, () => { void loadMemories(); });

    if (spaceId) {
      channel.on('postgres_changes', {
        event: '*', schema: 'public', table: 'memories',
        filter: `space_id=eq.${spaceId}`,
      }, () => { void loadMemories(); });
    }
    channel.on('postgres_changes', {
      event: '*', schema: 'public', table: 'memory_attachments',
    }, () => { void loadMemories(); });
    channel = channel.subscribe();

    async function refresh() {
      await loadMemories();
      if (active) setLoading(false);
    }
    void refresh();

    return () => {
      active = false;
      void client.removeChannel(channel);
    };
  }, [session, spaceId, loadMemories]);

  const categories = useMemo(() => ['All', ...new Set(memories.map((memory) => memory.category))], [memories]);
  const visibleMemories = useMemo(() => {
    const term = search.trim().toLocaleLowerCase();
    return memories.filter((memory) => {
      const matchesCategory = categoryFilter === 'All' || memory.category === categoryFilter;
      const matchesSearch = !term || `${memory.title} ${memory.body}`.toLocaleLowerCase().includes(term);
      return matchesCategory && matchesSearch;
    });
  }, [memories, search, categoryFilter]);

  function updateForm<K extends keyof MemoryForm>(key: K, value: MemoryForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function startEdit(memory: Memory) {
    setEditingId(memory.id);
    setOpenedMemoryId(memory.id);
    setForm({
      title: memory.title,
      body: memory.body,
      memory_date: memory.memory_date ?? '',
      category: memory.category,
      visibility: memory.visibility,
    });
    setError(null);
    setNotice(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpenedMemoryId(null);
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session) return;

    const title = form.title.trim();
    const body = form.body.trim();
    if (!title || !body) return;
    if (form.visibility === 'shared' && !spaceId) {
      setError('Pair your account before sharing a memory.');
      return;
    }

    const values = {
      title,
      body,
      memory_date: form.memory_date || null,
      category: form.category.trim() || 'Moment',
      visibility: form.visibility,
      space_id: form.visibility === 'shared' ? spaceId : null,
    };

    setSaving(true);
    setError(null);
    setNotice(null);
    const result = editingId
      ? await supabase.from('memories').update(values).eq('id', editingId).eq('created_by', session.user.id)
      : await supabase.from('memories').insert({ ...values, created_by: session.user.id });

    if (result.error) setError(result.error.message);
    else {
      setNotice(editingId ? 'Memory updated.' : 'Memory saved.');
      setEditingId(null);
      setForm(EMPTY_FORM);
      await loadMemories();
    }
    setSaving(false);
  }

  async function handleDelete(memory: Memory) {
    if (!supabase || !session) return;
    if (!window.confirm(`Delete “${memory.title}”?`)) return;

    const memoryAttachments = attachments[memory.id] ?? [];
    const { error: deleteError } = await supabase
      .from('memories')
      .delete()
      .eq('id', memory.id)
      .eq('created_by', session.user.id);
    if (deleteError) setError(deleteError.message);
    else {
      if (memoryAttachments.length) {
        const { error: storageError } = await supabase.storage.from('evermore-private').remove(memoryAttachments.map((attachment) => attachment.storage_path));
        if (storageError) setError(`Memory deleted, but attachment cleanup failed: ${storageError.message}`);
      }
      setNotice('Memory deleted.');
      setMemories((current) => current.filter((item) => item.id !== memory.id));
      if (editingId === memory.id) cancelEdit();
      else if (openedMemoryId === memory.id) setOpenedMemoryId(null);
    }
  }

  async function uploadAttachments(memory: Memory, files: FileList | null) {
    if (!supabase || !session || !files?.length) return;
    const uploadedPaths: string[] = [];
    let uploadFailed = false;
    setSaving(true);
    setError(null);
    setNotice(null);
    for (const file of Array.from(files)) {
      if (!MEMORY_FILE_TYPES.has(file.type)) {
        setError(`${file.name} is not an allowed file type.`);
        uploadFailed = true;
        break;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError(`${file.name} exceeds the 10 MB limit.`);
        uploadFailed = true;
        break;
      }
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const folder = memory.space_id ?? 'private';
      const path = `${folder}/${session.user.id}/memories/${crypto.randomUUID()}-${safeName}`;
      const { error: storageError } = await supabase.storage.from('evermore-private').upload(path, file, { contentType: file.type, upsert: false });
      if (storageError) {
        setError(storageError.message);
        uploadFailed = true;
        break;
      }
      uploadedPaths.push(path);
      const { error: metadataError } = await supabase.from('memory_attachments').insert({
        memory_id: memory.id,
        created_by: session.user.id,
        storage_path: path,
        file_name: file.name,
        mime_type: file.type,
        file_size: file.size,
      });
      if (metadataError) {
        setError(metadataError.message);
        uploadFailed = true;
        break;
      }
    }
    if (uploadFailed && uploadedPaths.length) {
      await supabase.from('memory_attachments').delete().in('storage_path', uploadedPaths);
      await supabase.storage.from('evermore-private').remove(uploadedPaths);
    } else if (!uploadFailed && uploadedPaths.length) {
      setNotice('Attachment added to memory.');
      await loadMemories();
    }
    setSaving(false);
  }

  async function removeAttachment(attachment: MemoryAttachment) {
    if (!supabase || !session || !window.confirm(`Remove ${attachment.file_name}?`)) return;
    setSaving(true);
    const { error: storageError } = await supabase.storage.from('evermore-private').remove([attachment.storage_path]);
    if (storageError) setError(storageError.message);
    else {
      const { error: rowError } = await supabase.from('memory_attachments').delete().eq('id', attachment.id).eq('created_by', session.user.id);
      if (rowError) setError(rowError.message);
      else await loadMemories();
    }
    setSaving(false);
  }

  function exportMemories() {
    const content = JSON.stringify(memories.map((memory) => ({
      ...memory,
      attachments: (attachments[memory.id] ?? []).map(({ file_name, mime_type, file_size, created_at }) => ({ file_name, mime_type, file_size, created_at })),
    })), null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'evermore-memories.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  if (loading) return <main role="status">Opening your Memory Garden...</main>;

  return (
    <main className="memories-page">
      <section className="memories-panel">
        <header className="memories-header">
          <div>
            <p className="memories-eyebrow">A place for moments worth keeping</p>
            <h1>Memory Garden</h1>
          </div>
        </header>

        <section className="memory-form-section">
          <h2>{editingId ? 'Edit memory' : 'Save a memory'}</h2>
          <form className="memory-form" onSubmit={handleSave}>
            <label htmlFor="memory-title">Title</label>
            <input id="memory-title" required maxLength={160} value={form.title} onChange={(event) => updateForm('title', event.target.value)} />

            <label htmlFor="memory-body">Your memory</label>
            <textarea id="memory-body" required maxLength={10000} value={form.body} onChange={(event) => updateForm('body', event.target.value)} />

            <label htmlFor="memory-date">Date</label>
            <input id="memory-date" type="date" value={form.memory_date} onChange={(event) => updateForm('memory_date', event.target.value)} />

            <label htmlFor="memory-category">Category</label>
            <select id="memory-category" value={form.category} onChange={(event) => updateForm('category', event.target.value)}>
              <option>Moment</option>
              <option>Visit</option>
              <option>Milestone</option>
              <option>Letter</option>
              <option>Question</option>
              <option>Celebration</option>
              <option>Everyday</option>
              <option>Other</option>
            </select>

            <label htmlFor="memory-visibility">Visibility</label>
            <select id="memory-visibility" value={form.visibility} onChange={(event) => updateForm('visibility', event.target.value as MemoryForm['visibility'])}>
              <option value="private">Private to me</option>
              {spaceId && <option value="shared">Shared with partner</option>}
            </select>

            <div className="memory-form-actions">
              <button type="submit" disabled={saving || !form.title.trim() || !form.body.trim()}>
                {saving ? 'Saving...' : editingId ? 'Save changes' : 'Save memory'}
              </button>
              {editingId && <button type="button" disabled={saving} onClick={cancelEdit}>Cancel</button>}
            </div>
          </form>
        </section>

        <section className="memories-library">
          <header className="memories-library-header">
            <h2>Our collection</h2>
            <button type="button" disabled={!memories.length} onClick={exportMemories}>Export JSON</button>
            <label>
              <span className="visually-hidden">Search memories</span>
              <input type="search" placeholder="Search memories" value={search} onChange={(event) => setSearch(event.target.value)} />
            </label>
            <label>
              <span className="visually-hidden">Filter by category</span>
              <select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
                {categories.map((category) => <option key={category}>{category}</option>)}
              </select>
            </label>
          </header>
          {visibleMemories.length === 0 ? <p>No memories match this view yet.</p> : (
            <div className="memory-timeline">
              {visibleMemories.map((memory) => (
                <article className={`memory-envelope${openedMemoryId === memory.id ? ' memory-envelope-open' : ''}`} key={memory.id}>
                  <button
                    className="memory-envelope-face"
                    type="button"
                    aria-expanded={openedMemoryId === memory.id}
                    aria-controls={`memory-letter-${memory.id}`}
                    onClick={() => setOpenedMemoryId((current) => current === memory.id ? null : memory.id)}
                  >
                    <span className="memory-seal" aria-hidden="true" />
                    <span className="memory-envelope-heading">
                      <span className="memory-entry-meta">
                        <span>{memory.category}</span>
                        <span>{memory.visibility === 'shared' ? 'Shared' : 'Private'}</span>
                        {memory.memory_date && <time dateTime={memory.memory_date}>{new Date(`${memory.memory_date}T12:00:00`).toLocaleDateString()}</time>}
                      </span>
                      <strong>{memory.title}</strong>
                    </span>
                    <span className="memory-envelope-action">{openedMemoryId === memory.id ? 'Close' : 'Open'}</span>
                  </button>
                  {openedMemoryId === memory.id && (
                    <div className="memory-letter" id={`memory-letter-${memory.id}`}>
                      <p>{memory.body}</p>
                      {attachments[memory.id]?.length > 0 && <ul className="memory-attachments">
                        {attachments[memory.id].map((attachment) => (
                          <li key={attachment.id}>
                            <a href={attachment.url} target="_blank" rel="noreferrer">{attachment.file_name}</a>
                            {attachment.created_by === session?.user.id && <button type="button" disabled={saving} onClick={() => void removeAttachment(attachment)}>Remove</button>}
                          </li>
                        ))}
                      </ul>}
                      {memory.created_by === session?.user.id && (
                        <footer>
                          <button type="button" onClick={() => startEdit(memory)}>Edit</button>
                          <button type="button" onClick={() => void handleDelete(memory)}>Delete</button>
                          <label className="memory-attachment-add">Attach files<input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf,text/plain" disabled={saving} onChange={(event) => { void uploadAttachments(memory, event.target.files); event.currentTarget.value = ''; }} /></label>
                        </footer>
                      )}
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}
