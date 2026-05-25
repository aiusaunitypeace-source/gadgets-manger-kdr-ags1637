// ── Supabase Configuration ─────────────────────────────────────────────────────
// These values are public (anon key is safe for client-side use with RLS).
// Replace with your own Supabase project credentials.
// Get them from: https://app.supabase.com → Project Settings → API

const SUPABASE_URL = "";
const SUPABASE_ANON_KEY = "";

// Initialize Supabase client
let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
}