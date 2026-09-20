const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
const supabaseUrl = env.VITE_SUPABASE_URL || 'https://lydwpejysaqkjkhwlgib.supabase.co';
const supabaseKey = env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5ZHdwZWp5c2Fxa2praHdsZ2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3OTkwNTMsImV4cCI6MjA5ODM3NTA1M30.MA22Exy9Su2A2lnf09IWyi1EphSzUFUhij_M0mXk4Tg';

// Clean up any legacy cross-tab Supabase auth keys from localStorage to prevent cross-tab contamination
if (typeof window !== 'undefined' && window.localStorage) {
  try {
    Object.keys(window.localStorage).forEach((key) => {
      if (key.startsWith('sb-') && key.endsWith('-auth-token')) {
        window.localStorage.removeItem(key);
      }
    });
  } catch (e) {
    console.warn('Unable to clear legacy localStorage auth keys:', e);
  }
}

// Resolve from window.supabase (loaded via CDN)
const createClient = window.supabase ? window.supabase.createClient : null;

// Configure Supabase client with sessionStorage so authentication state is strictly isolated per browser tab
export const supabase = createClient
  ? createClient(supabaseUrl, supabaseKey, {
      auth: {
        storage: typeof window !== 'undefined' ? window.sessionStorage : undefined,
        storageKey: 'vm_sb_auth_token',
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
      },
    })
  : null;