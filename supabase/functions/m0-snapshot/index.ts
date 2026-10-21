import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { snapshotHandler, withCors } from '../_shared/security.ts';
const client = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
Deno.serve(withCors(snapshotHandler(async (hash, roomId) => {
  const { data, error } = await client.rpc('m0_snapshot', { p_hash: hash, p_room: roomId });
  if (error) throw new Error('Snapshot lookup failed');
  return data;
}), (Deno.env.get('APP_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',')));
