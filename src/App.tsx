import { useState } from 'react';
import { Routes, Route, Link } from 'react-router-dom';
import Login from './components/AuthForm/Login';
import Register from './components/AuthForm/Register';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './components/AuthProvider';
import { supabase } from './lib/supabase';
import Home from './pages/Home';
import Pairing from './pages/Pairing';
import Chat from './pages/Chat';
import Profile from './pages/Profile';
import Whiteboard from './pages/Whiteboard';

export default function App() {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    if (!supabase) return;

    const { error: signOutError } = await supabase.auth.signOut();
    setError(signOutError?.message ?? null);
  }

  return (
    <div>
      <nav style={{padding:12, display:'flex', gap:12}}>
        <Link to="/">Home</Link>
        {session ? (
          <>
            <Link to="/profile">Profile</Link>
            <Link to="/pairing">Pairing</Link>
            <Link to="/chat">Chat</Link>
            <Link to="/whiteboard">Whiteboard</Link>
            <button type="button" onClick={handleSignOut}>Sign out</button>
          </>
        ) : (
          <>
            <Link to="/login">Login</Link>
            <Link to="/register">Register</Link>
          </>
        )}
      </nav>
      {error && <p role="alert">{error}</p>}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<Home />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/pairing" element={<Pairing />} />
          <Route path="/chat" element={<Chat />} />
          <Route path="/whiteboard" element={<Whiteboard />} />
        </Route>
      </Routes>
    </div>
  );
}
