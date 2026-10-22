import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { useNavigate } from 'react-router-dom';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { data, error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + '/' }});
    setLoading(false);
    if (error) setError(error.message);
    else setInfo('Check your email for a verification link. After verifying, sign in.');
  }

  return (
    <main style={{maxWidth:520, margin:'40px auto'}}>
      <section className="card">
        <h2>Create an Account</h2>
        <form onSubmit={handleRegister}>
          <label>Email
            <input aria-label="email" value={email} onChange={(e)=>setEmail(e.target.value)} />
          </label>
          <label>Password
            <input aria-label="password" type="password" value={password} onChange={(e)=>setPassword(e.target.value)} />
          </label>
          <div style={{marginTop:12}}>
            <button disabled={loading} type="submit">{loading ? 'Creating...' : 'Create account'}</button>
          </div>
        </form>
        {info && <div role="status" style={{color:'var(--primary)'}}>{info}</div>}
        {error && <div role="alert" style={{color:'var(--accent)'}}>{error}</div>}
      </section>
    </main>
  );
}
