import type { SupabaseClient } from '@supabase/supabase-js';
export function parseVersionEvent(value: unknown, roomId: string): { room_id: string; version: number } | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'room_id,version' || record.room_id !== roomId || !Number.isSafeInteger(record.version) || (record.version as number) < 0) return null;
  return { room_id: roomId, version: record.version as number };
}
// Broadcast is an untrusted invalidation hint. It never changes game state.
// The caller must re-fetch an authenticated server snapshot and handle reconnects.
export function subscribeToRoomVersion(client: SupabaseClient, roomId: string, invalidate: () => void) {
  // Anonymous Presence carries no identity or secrets; even forged leaves cannot pause the server.
  const channel = client.channel(`room:${roomId}`,{config:{presence:{key:crypto.randomUUID()}}}).on('broadcast', { event: 'version' }, ({ payload }) => {
    if (parseVersionEvent(payload, roomId)) invalidate();
  }).on('presence',{event:'sync'},invalidate).subscribe((status) => {
    if (status === 'SUBSCRIBED') { void channel.track({}); invalidate(); }
  });
  return () => client.removeChannel(channel);
}
