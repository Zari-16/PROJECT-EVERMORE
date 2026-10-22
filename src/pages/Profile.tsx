import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../components/AuthProvider';
import { supabase } from '../lib/supabase';

export default function Profile() {
  const { session } = useAuth();
  const [displayName, setDisplayName] = useState('');
  const [profileExists, setProfileExists] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase || !session) {
      setLoading(false);
      return;
    }

    const client = supabase;
    const userId = session.user.id;
    let active = true;
    async function loadProfile() {
      const { data, error: loadError } = await client
        .from('profiles')
        .select('display_name')
        .eq('id', userId)
        .maybeSingle();

      if (!active) return;
      if (loadError) {
        setError(loadError.message);
      } else if (!data) {
        setError('Profile not found. Apply migrations/003_profiles.sql in Supabase, then reload.');
      } else {
        setDisplayName(data.display_name ?? '');
        setProfileExists(true);
      }
      setLoading(false);
    }

    void loadProfile();
    return () => { active = false; };
  }, [session]);

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || !session || !profileExists) return;

    const name = displayName.trim();
    if (!name) {
      setError('Enter a display name.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);
    const { error: saveError } = await supabase
      .from('profiles')
      .update({ display_name: name })
      .eq('id', session.user.id);
    setSaving(false);

    if (saveError) setError(saveError.message);
    else {
      setDisplayName(name);
      setNotice('Profile saved.');
    }
  }

  if (loading) return <main role="status">Loading profile...</main>;

  return (
    <main style={{ maxWidth: 520, margin: '40px auto' }}>
      <section className="card">
        <h1>Your Profile</h1>
        <p>{session?.user.email}</p>
        <form onSubmit={handleSave}>
          <label htmlFor="display-name">Display name</label>
          <input
            id="display-name"
            autoComplete="nickname"
            maxLength={40}
            required
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
          />
          <button type="submit" disabled={saving || loading || !profileExists}>
            {saving ? 'Saving...' : 'Save profile'}
          </button>
        </form>
        {error && <p role="alert">{error}</p>}
        {notice && <p role="status">{notice}</p>}
      </section>
    </main>
  );
}
