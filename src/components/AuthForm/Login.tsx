import React, { useState } from 'react';
import { supabase } from '../../lib/supabase';
import { Link, useNavigate } from 'react-router-dom';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const nav = useNavigate();

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
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

  async function handleResendConfirmation() {
    if (!supabase) {
      setError('Supabase is not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to your .env file.');
      return;
    }

    setLoading(true);
    setError(null);
    setNotice(null);
    try {
      const { error } = await supabase.auth.resend({
        type: 'signup',
        email,
        options: { emailRedirectTo: window.location.origin + import.meta.env.BASE_URL },
      });
      if (error) setError(error.message);
      else setNotice('If this account still needs confirmation, a new email has been sent.');
    } catch {
      setError('Unable to reach Supabase. Check your connection and try again.');
    } finally {
      setLoading(false);
    }
  }

  const needsConfirmation = error?.toLowerCase().includes('email not confirmed');

  return (
    <main className="auth-page auth-page-login">
      <section className="auth-layout">
        <div className="auth-intro">
          <span className="auth-sigil" aria-hidden="true" />
          <p className="auth-eyebrow">Your private sanctuary</p>
          <h1>Come back to our little world.</h1>
          <p>Pick up where the two of you left off, wherever you are.</p>
          <div className="auth-ornament" aria-hidden="true"><span /></div>
        </div>

        <section className="auth-form-panel">
          <header className="auth-form-heading">
            <p className="auth-eyebrow">Welcome back</p>
            <h2>Enter the garden</h2>
            <p>Sign in with your email and password.</p>
          </header>
          <form className="auth-form" onSubmit={handleLogin}>
            <label htmlFor="login-email">Email address</label>
            <input id="login-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />

            <label htmlFor="login-password">Password</label>
            <input id="login-password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />

            {error && <p role="alert" className="auth-message auth-message-error">{error}</p>}
            {notice && <p role="status" className="auth-message auth-message-success">{notice}</p>}

            <button className="auth-submit" disabled={loading} type="submit">
              {loading ? 'Opening the gate...' : 'Sign in'}
            </button>
          </form>
          {needsConfirmation && (
            <button className="auth-secondary-action" type="button" disabled={loading || !email} onClick={handleResendConfirmation}>
              {loading ? 'Sending...' : 'Resend confirmation email'}
            </button>
          )}
          <p className="auth-switch">New to Evermore? <Link to="/register">Create an account</Link></p>
        </section>
      </section>
    </main>
  );
}
