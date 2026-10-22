import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL) {
  console.error('Missing VITE_SUPABASE_URL in environment');
}
if (!SUPABASE_ANON_KEY) {
  console.error('Missing VITE_SUPABASE_ANON_KEY in environment');
}

// Browser-safe client: only anonymous (publishable) key should be used here.
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  realtime: {
    params: {
      // reduce heartbeat traffic for conservative free-tier usage if desired
      // e.g. heartbeat: 60
    },
  },
});
