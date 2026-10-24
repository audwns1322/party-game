// Deno-only wiring: service_role client, RPC adapter, Realtime REST broadcast, CORS.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import type { Broadcast, Rpc } from './room.ts';
import { withCors } from './security.ts';

const url = Deno.env.get('SUPABASE_URL')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const client = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

export const rpc: Rpc = async (fn, args) => {
  const { data, error } = await client.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};

// Public, secret-free invalidation hint. Receivers re-fetch their authenticated snapshot.
export const broadcast: Broadcast = async (roomId, version) => {
  const response = await fetch(`${url}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ topic: `room:${roomId}`, event: 'version', payload: { room_id: roomId, version }, private: false }] }),
  });
  if (!response.ok) throw new Error('BROADCAST_FAILED');
};

const origins = (Deno.env.get('APP_ALLOWED_ORIGINS') ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',');
export function serve(handler: (request: Request) => Promise<Response>, methods: string) {
  Deno.serve(withCors(handler, origins, methods));
}
