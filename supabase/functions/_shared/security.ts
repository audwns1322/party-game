export type PersonalSnapshot = { room_id: string; player_id: string; role: 'citizen' | 'liar'; word: string | null; version: number };
export type Lookup = (hash: string, roomId: string) => Promise<PersonalSnapshot | null>;
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function newToken(): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
}
export function snapshotHandler(lookup: Lookup) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    if (request.method !== 'GET') return reply(405, { error: 'METHOD_NOT_ALLOWED' });
    const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
    const roomId = new URL(request.url).searchParams.get('room_id');
    if (!token) return reply(401, { error: 'UNAUTHORIZED' });
    if (!roomId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(roomId)) return reply(400, { error: 'INVALID_ROOM' });
    try {
      const snapshot = await lookup(await hashToken(token), roomId);
      if (!snapshot) return reply(403, { error: 'FORBIDDEN' });
      // Explicit allowlist: repository additions cannot leak into responses.
      return reply(200, { room_id: snapshot.room_id, player_id: snapshot.player_id, role: snapshot.role, word: snapshot.role === 'citizen' ? snapshot.word : null, version: snapshot.version });
    } catch { return reply(503, { error: 'TEMPORARILY_UNAVAILABLE' }); }
  };
}
export type VersionEvent = { room_id: string; version: number };
export function publicVersionEvent(roomId: string, version: number): VersionEvent {
  if (!/^[0-9a-f-]{36}$/i.test(roomId) || !Number.isSafeInteger(version) || version < 0) throw new Error('Invalid event');
  return { room_id: roomId, version };
}

export function withCors(handler: (request: Request) => Promise<Response>, allowedOrigins: string[]) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    if (origin && !allowedOrigins.includes(origin)) return Response.json({ error: 'ORIGIN_DENIED' }, { status: 403 });
    const headers = new Headers({ 'Vary': 'Origin', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type' });
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    const response = await handler(request);
    headers.forEach((value, key) => response.headers.set(key, value));
    return response;
  };
}
