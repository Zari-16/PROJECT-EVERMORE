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
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
    } else {
      // redirect to profile setup if new user, else home
      nav('/');
    }
  }

  return (
    <main style={{maxWidth:520, margin:'40px auto'}}>
      <section className="card">
        <h2>Enter the Garden</h2>
        <p className="muted">Sign in with your email and password.</p>
        <form onSubmit={handleLogin}>
          <label>Email
            <input aria-label="email" value={email} onChange={(e)=>setEmail(e.target.value)} />
          </label>
          <label>Password
            <input aria-label="password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} />
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
