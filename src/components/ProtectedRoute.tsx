import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './AuthProvider';
import { supabase } from '../lib/supabase';

export default function ProtectedRoute() {
  const { session, loading } = useAuth();
  const location = useLocation();

  if (!supabase) {
    return <main role="alert">Supabase is not configured. Add the required values to your .env file.</main>;
  }

  if (loading) {
    return <main role="status">Checking your session...</main>;
  }

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  return <Outlet />;
}
