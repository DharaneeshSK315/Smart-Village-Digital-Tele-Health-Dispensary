const supabaseUrl = 'https://lydwpejysaqkjkhwlgib.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5ZHdwZWp5c2Fxa2praHdsZ2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3OTkwNTMsImV4cCI6MjA5ODM3NTA1M30.MA22Exy9Su2A2lnf09IWyi1EphSzUFUhij_M0mXk4Tg';

// Resolve from window.supabase (loaded via CDN)
const createClient = window.supabase ? window.supabase.createClient : null;

export const supabase = createClient ? createClient(supabaseUrl, supabaseKey) : null;