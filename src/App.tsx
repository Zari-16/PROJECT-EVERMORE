import { lazy, Suspense, useState } from 'react';
import { Routes, Route, Link, NavLink } from 'react-router-dom';
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
import Questions from './pages/Questions';
import Calendar from './pages/Calendar';
import Memories from './pages/Memories';
import CompanionRoom from './pages/CompanionRoom';
import FantasyAtmosphere from './components/FantasyAtmosphere';
import Games from './pages/Games';

const Sudoku = lazy(() => import('./pages/Sudoku'));
const HeartAndHollow = lazy(() => import('./pages/HeartAndHollow'));
const Ludo = lazy(() => import('./pages/Ludo'));
const TruthOrDare = lazy(() => import('./pages/TruthOrDare'));

export default function App() {
  const { session } = useAuth();
  const [error, setError] = useState<string | null>(null);

  async function handleSignOut() {
    if (!supabase) return;

    const { error: signOutError } = await supabase.auth.signOut();
    setError(signOutError?.message ?? null);
  }

  return (
    <div className="app-shell">
      <FantasyAtmosphere />
      <header className="site-header">
        <Link className="site-brand" to="/" aria-label="Project Evermore home">
          <span className="site-brand-mark" aria-hidden="true" />
          <span className="site-brand-copy">
            <strong>Evermore</strong>
            <small>Our private realm</small>
          </span>
        </Link>
        <nav className="site-navigation" aria-label="Main navigation">
          {session ? (
            <>
              <NavLink to="/" end className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Home</NavLink>
              <NavLink to="/profile" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Profile</NavLink>
              <NavLink to="/pairing" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Pairing</NavLink>
              <NavLink to="/chat" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Chat</NavLink>
              <NavLink to="/whiteboard" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Whiteboard</NavLink>
              <NavLink to="/questions" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Questions</NavLink>
              <NavLink to="/calendar" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Calendar</NavLink>
              <NavLink to="/memories" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Memory Garden</NavLink>
              <NavLink to="/room" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Companion Room</NavLink>
              <NavLink to="/games" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Games</NavLink>
            </>
          ) : (
            <>
              <NavLink to="/login" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Login</NavLink>
              <NavLink to="/register" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Register</NavLink>
            </>
          )}
        </nav>
        {session && <button className="site-signout" type="button" onClick={handleSignOut}>Sign out</button>}
      </header>
      {error && <p role="alert">{error}</p>}
      <div className="app-route-content">
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route element={<ProtectedRoute />}>
            <Route path="/" element={<Home />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/pairing" element={<Pairing />} />
            <Route path="/chat" element={<Chat />} />
            <Route path="/whiteboard" element={<Whiteboard />} />
            <Route path="/questions" element={<Questions />} />
            <Route path="/calendar" element={<Calendar />} />
            <Route path="/memories" element={<Memories />} />
            <Route path="/room" element={<CompanionRoom />} />
            <Route path="/games" element={<Games />} />
            <Route path="/games/sudoku" element={<Suspense fallback={<main role="status">Opening Sudoku...</main>}><Sudoku /></Suspense>} />
            <Route path="/games/heart-and-hollow" element={<Suspense fallback={<main role="status">Opening Heart &amp; Hollow...</main>}><HeartAndHollow /></Suspense>} />
            <Route path="/games/ludo" element={<Suspense fallback={<main role="status">Opening Ludo...</main>}><Ludo /></Suspense>} />
            <Route path="/games/truth-or-dare" element={<Suspense fallback={<main role="status">Opening Truth or Dare...</main>}><TruthOrDare /></Suspense>} />
          </Route>
        </Routes>
      </div>
    </div>
  );
}
