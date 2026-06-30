import { createClient } from '@supabase/supabase-js'

// Safely access env vars to support both Vite local server and raw browsers (like GitHub Pages)
const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};

const supabaseUrl = env.VITE_SUPABASE_URL;
const supabaseKey = env.VITE_SUPABASE_ANON_KEY;

// Verify if the credentials have been configured with real values
const isConfigured = supabaseUrl && 
                     supabaseKey && 
                     supabaseUrl !== 'your_copied_project_url' && 
                     supabaseKey !== 'your_copied_anon_key';

export const supabase = isConfigured ? createClient(supabaseUrl, supabaseKey) : null;