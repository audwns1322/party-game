import { createClient } from '@supabase/supabase-js';
// No Auth session: participant credentials are validated by Edge Functions.
export function createPublicClient(url: string, publishableKey: string) {
  return createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}
