import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

type PairingMember = {
  space_id: string;
  space_name: string;
  pairing_locked: boolean;
  member_id: string;
  member_display_name: string | null;
  member_role: string;
};

type CreatedSpace = {
  space_id: string;
  invite_code: string;
  expires_at: string;
};

type CreatedInvite = {
  invite_code: string;
  expires_at: string;
};

function firstRow<T>(data: unknown): T | null {
  return Array.isArray(data) ? (data[0] as T | undefined) ?? null : null;
}

export default function Pairing() {
  const { session } = useAuth();
  const [members, setMembers] = useState<PairingMember[]>([]);
  const [spaceName, setSpaceName] = useState('Our Space');
  const [inviteCode, setInviteCode] = useState<string | null>(null);
  const [inviteExpiresAt, setInviteExpiresAt] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function loadSpace() {
    if (!supabase) {
      setError('Supabase is not configured.');
      setLoading(false);
      return;
    }

    setLoading(true);
    const { data, error: loadError } = await supabase.rpc('get_my_space');
    if (loadError) {
      setError(loadError.message);
    } else {
      setMembers((Array.isArray(data) ? data : []) as PairingMember[]);
      setError(null);
    }
    setLoading(false);
  }

  useEffect(() => {
    void loadSpace();
  }, []);

  async function handleCreateSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: createError } = await supabase.rpc('create_private_space', {
        p_space_name: spaceName.trim(),
      });
      if (createError) throw createError;

      const created = firstRow<CreatedSpace>(data);
      if (!created) throw new Error('The space was created, but no invite was returned.');

      setInviteCode(created.invite_code);
      setInviteExpiresAt(created.expires_at);
      setNotice('Space created. Share this one-time invite with your partner.');
      await loadSpace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create the space.');
    } finally {
      setBusy(false);
    }
  }

  async function handleCreateInvite() {
    if (!supabase || !members[0]) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: inviteError } = await supabase.rpc('create_pairing_invite', {
        p_space_id: members[0].space_id,
      });
      if (inviteError) throw inviteError;

      const invite = firstRow<CreatedInvite>(data);
      if (!invite) throw new Error('No invite code was returned.');
      setInviteCode(invite.invite_code);
      setInviteExpiresAt(invite.expires_at);
      setNotice('New invite created. Any previous unused invite is now invalid.');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create an invite.');
    } finally {
      setBusy(false);
    }
  }

  async function handleJoinSpace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { data, error: joinError } = await supabase.rpc('accept_pairing_invite', {
        p_invite_code: joinCode.trim(),
      });
      if (joinError) throw joinError;
      if (data !== true) throw new Error('That invite is invalid, expired, already used, or attempts are temporarily limited.');

      setJoinCode('');
      setNotice('You joined the shared space.');
      await loadSpace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join the space.');
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPairing() {
    if (!supabase || !members[0]) return;
    if (!window.confirm('Remove your partner and invalidate outstanding invites? Existing shared content will remain visible to the next person you invite.')) return;

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const { error: resetError } = await supabase.rpc('reset_pairing', {
        p_space_id: members[0].space_id,
      });
      if (resetError) throw resetError;

      setInviteCode(null);
      setInviteExpiresAt(null);
      setNotice('Pairing reset. You can create a new invite.');
      await loadSpace();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reset pairing.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <main role="status">Loading your shared space...</main>;

  const space = members[0];
  const myMembership = members.find((member) => member.member_id === session?.user.id);
  const isOwner = myMembership?.member_role === 'owner';

  return (
    <main style={{ maxWidth: 720, margin: '32px auto', padding: '0 16px' }}>
      <section className="card">
        <h1>Our Private Space</h1>
        {!space ? (
          <>
            <p>Create a space for the two of you, or join one with an invitation code.</p>
            <form onSubmit={handleCreateSpace}>
              <label htmlFor="space-name">Space name</label>
              <input
                id="space-name"
                maxLength={60}
                required
                value={spaceName}
                onChange={(event) => setSpaceName(event.target.value)}
              />
              <button type="submit" disabled={busy || !spaceName.trim()}>
                {busy ? 'Creating...' : 'Create space and invite'}
              </button>
            </form>
            <hr />
            <form onSubmit={handleJoinSpace}>
              <label htmlFor="invite-code">Invitation code</label>
              <input
                id="invite-code"
                autoComplete="off"
                maxLength={64}
                required
                value={joinCode}
                onChange={(event) => setJoinCode(event.target.value)}
              />
              <button type="submit" disabled={busy || !joinCode.trim()}>
                {busy ? 'Joining...' : 'Join a space'}
              </button>
            </form>
          </>
        ) : (
          <>
            <h2>{space.space_name}</h2>
            <ul>
              {members.map((member) => (
                <li key={member.member_id}>
                  {member.member_display_name || 'Evermore member'}
                  {member.member_id === session?.user.id ? ' (you)' : ''}
                </li>
              ))}
            </ul>
            {space.pairing_locked ? (
              <>
                <p role="status">This space is paired with two members.</p>
                {isOwner && (
                  <button type="button" disabled={busy} onClick={handleResetPairing}>
                    Reset pairing
                  </button>
                )}
              </>
            ) : isOwner ? (
              <>
                <p>Share a one-time invitation with your partner. It expires after 24 hours.</p>
                <button type="button" disabled={busy} onClick={handleCreateInvite}>
                  {busy ? 'Creating...' : inviteCode ? 'Create a new invite' : 'Generate invite code'}
                </button>
              </>
            ) : <p>Waiting for the space owner to finish pairing.</p>}
          </>
        )}

        {inviteCode && (
          <section aria-label="Invitation code">
            <h2>Invitation code</h2>
            <p><code>{inviteCode}</code></p>
            {inviteExpiresAt && <p>Expires {new Date(inviteExpiresAt).toLocaleString()}.</p>}
            <p>Share this code privately. It can only be used once.</p>
          </section>
        )}
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}
