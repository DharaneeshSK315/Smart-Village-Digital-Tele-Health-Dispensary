import { createClient } from '@supabase/supabase-js'

// Hardcoded credentials for static environments like GitHub Pages
const supabaseUrl = 'https://lydwpejysaqkjkhwlgib.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc2MiOiJzdXBhYmFzZSIsInJlZiI6Imx5ZHdwZWp5c2Fxa2praHdsZ2liIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MTk3NDg1MTYsImV4cCI6MjAzNTMyNDUxNn0.8c5f5U05iB939Z_FvL3O1xG7_N9zQoNq-n6c5Z-X8o0';

export const supabase = createClient(supabaseUrl, supabaseKey);