import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';

export default function Register() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const nav = useNavigate();

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const { error } = await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL }});
      if (error) setError(error.message);
      else setInfo('Check your email for a verification link. After verifying, sign in.');
    } catch {
      setError('Unable to reach Supabase. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="auth-page auth-page-register">
      <section className="auth-layout">
        <div className="auth-intro">
          <span className="auth-sigil" aria-hidden="true" />
          <p className="auth-eyebrow">A world for two</p>
          <h1>Begin your story together.</h1>
          <p>Save the small moments, the faraway visits, and all the things still ahead.</p>
          <div className="auth-ornament" aria-hidden="true"><span /></div>
        </div>

        <section className="auth-form-panel">
          <header className="auth-form-heading">
            <p className="auth-eyebrow">A key to your realm</p>
            <h2>Create an account</h2>
            <p>Start with an email address and a password.</p>
          </header>
          <form className="auth-form" onSubmit={handleRegister}>
            <label htmlFor="register-email">Email address</label>
            <input id="register-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />

            <label htmlFor="register-password">Password</label>
            <input id="register-password" type="password" autoComplete="new-password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} />
            <small className="auth-field-hint">Use at least 8 characters.</small>

            {info && <p role="status" className="auth-message auth-message-success">{info}</p>}
            {error && <p role="alert" className="auth-message auth-message-error">{error}</p>}

            <button className="auth-submit" disabled={loading} type="submit">
              {loading ? 'Preparing your invitation...' : 'Create account'}
            </button>
          </form>
          <p className="auth-switch">Already have an account? <Link to="/login">Sign in</Link></p>
        </section>
      </section>
    </main>
  );
}
