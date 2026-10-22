import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
      } else {
        nav('/');
      }
    } catch {
      setError('Unable to reach Supabase. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{maxWidth:520, margin:'40px auto'}}>
      <section className="card">
        <h2>Enter the Garden</h2>
        <p className="muted">Sign in with your email and password.</p>
        <form onSubmit={handleLogin}>
          <label>Email
            <input aria-label="email" type="email" autoComplete="email" required value={email} onChange={(e)=>setEmail(e.target.value)} />
          </label>
          <label>Password
            <input aria-label="password" type="password" autoComplete="current-password" required value={password} onChange={(e)=>setPassword(e.target.value)} />
          </label>
          <div style={{marginTop:12}}>
            <button disabled={loading} type="submit">{loading ? 'Signing in...' : 'Sign in'}</button>
          </div>
          {error && <div role="alert" style={{color:'var(--accent)'}}>{error}</div>}
        </form>
      </section>
    </main>
  );
}
