import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Verify if the credentials have been configured with real values
const isConfigured = supabaseUrl && 
                     supabaseKey && 
                     supabaseUrl !== 'your_copied_project_url' && 
                     supabaseKey !== 'your_copied_anon_key';

export const supabase = isConfigured ? createClient(supabaseUrl, supabaseKey) : null;