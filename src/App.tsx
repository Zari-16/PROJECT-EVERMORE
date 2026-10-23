import { lazy, Suspense, useState } from 'react';
import { Routes, Route, Link, NavLink } from 'react-router-dom';
import Login from './components/AuthForm/Login';
import Register from './components/AuthForm/Register';
import ProtectedRoute from './components/ProtectedRoute';
import { useAuth } from './components/AuthProvider';
import { supabase } from './lib/supabase';
import Home from './pages/Home';
import Pairing from './pages/Pairing';
import Profile from './pages/Profile';
import FantasyAtmosphere from './components/FantasyAtmosphere';

const Chat = lazy(() => import('./pages/Chat'));
const Whiteboard = lazy(() => import('./pages/Whiteboard'));
const Questions = lazy(() => import('./pages/Questions'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Memories = lazy(() => import('./pages/Memories'));
const CompanionRoom = lazy(() => import('./pages/CompanionRoom'));
const Games = lazy(() => import('./pages/Games'));
const Sudoku = lazy(() => import('./pages/Sudoku'));
const HeartAndHollow = lazy(() => import('./pages/HeartAndHollow'));
const Ludo = lazy(() => import('./pages/Ludo'));
const TruthOrDare = lazy(() => import('./pages/TruthOrDare'));
const Snake = lazy(() => import('./pages/Snake'));
const OurFuture = lazy(() => import('./pages/OurFuture'));
const NotificationCenter = lazy(() => import('./components/NotificationCenter'));

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
              <NavLink to="/future" className={({ isActive }) => `site-nav-link${isActive ? ' is-active' : ''}`}>Our Future</NavLink>
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
        {session && <div className="site-header-actions"><Suspense fallback={null}><NotificationCenter /></Suspense><button className="site-signout" type="button" onClick={handleSignOut}>Sign out</button></div>}
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
            <Route path="/chat" element={<Suspense fallback={<main role="status">Opening chat...</main>}><Chat /></Suspense>} />
            <Route path="/whiteboard" element={<Suspense fallback={<main role="status">Opening the whiteboard...</main>}><Whiteboard /></Suspense>} />
            <Route path="/questions" element={<Suspense fallback={<main role="status">Opening questions...</main>}><Questions /></Suspense>} />
            <Route path="/calendar" element={<Suspense fallback={<main role="status">Opening calendar...</main>}><Calendar /></Suspense>} />
            <Route path="/memories" element={<Suspense fallback={<main role="status">Opening Memory Garden...</main>}><Memories /></Suspense>} />
            <Route path="/future" element={<Suspense fallback={<main role="status">Opening Our Future...</main>}><OurFuture /></Suspense>} />
            <Route path="/room" element={<Suspense fallback={<main role="status">Opening Companion Room...</main>}><CompanionRoom /></Suspense>} />
            <Route path="/games" element={<Suspense fallback={<main role="status">Opening games...</main>}><Games /></Suspense>} />
            <Route path="/games/sudoku" element={<Suspense fallback={<main role="status">Opening Sudoku...</main>}><Sudoku /></Suspense>} />
            <Route path="/games/heart-and-hollow" element={<Suspense fallback={<main role="status">Opening Heart &amp; Hollow...</main>}><HeartAndHollow /></Suspense>} />
            <Route path="/games/ludo" element={<Suspense fallback={<main role="status">Opening Ludo...</main>}><Ludo /></Suspense>} />
            <Route path="/games/truth-or-dare" element={<Suspense fallback={<main role="status">Opening Truth or Dare...</main>}><TruthOrDare /></Suspense>} />
            <Route path="/games/snake" element={<Suspense fallback={<main role="status">Opening Snake...</main>}><Snake /></Suspense>} />
          </Route>
        </Routes>
      </div>
    </div>
  );
}
