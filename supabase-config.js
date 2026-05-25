// ── Supabase Configuration ─────────────────────────────────────────────────────
// These values are public (anon key is safe for client-side use with RLS).
// Get them from: https://app.supabase.com → Project Settings → API

const SUPABASE_URL = "https://huwdlteowjpqgrzaqmpc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_3kJIv_o-6w_UFp9mXtezvg_k5jqYsRT";

// Initialize Supabase client
let supabaseClient = null;
if (SUPABASE_URL && SUPABASE_ANON_KEY) {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });
}