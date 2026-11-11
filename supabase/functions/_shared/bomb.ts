import { hashToken } from './security.ts';
import type { Broadcast, Rpc } from './room.ts';
import { applyBombAction, settleBomb, type BombAction, type BombPlayer, type BombSecret, type BombState } from '../../../src/features/bomb-pass/onlineEngine.ts';

type Snapshot = { version: number; room_version: number; state: BombState; secret: BombSecret;
  me: string; host: string; players: BombPlayer[]; server_now: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<BombAction>(['settings','start','pass','next','finish','restart']);
const ERRORS: Record<string,number> = { INVALID_REQUEST:400, INVALID_SETTINGS:400, INVALID_ANSWER:400,
  DUPLICATE_ANSWER:409, ANSWER_LIMIT:409, PLAYER_COUNT:409, VERSION_CONFLICT:409,
  ROOM_LOCKED:409, PHASE_CONFLICT:409, GAME_FINISHED:409, HOST_ONLY:403, NOT_YOUR_TURN:403,
  ROOM_CLOSED:410, FORBIDDEN:403, UNKNOWN_ACTION:400 };
const reply = (status: number, content: object) => Response.json(content, { status,
  headers: { 'Cache-Control':'no-store', 'X-Content-Type-Options':'nosniff' } });
function sanitize(snapshot: Snapshot): Omit<Snapshot,'secret'> {
  const { secret: _secret, ...view } = snapshot;
  void _secret;
  return view;
}
function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  return reply(ERRORS[code]??503, { error: code in ERRORS ? code : 'TEMPORARILY_UNAVAILABLE' });
}

/** Same participant credentials + invalidation-only broadcast as other room games. */
export function bombHandler(rpc: Rpc, broadcast: Broadcast) {
  return async (request: Request) => {
    try {
      if (request.method !== 'POST') throw Error('INVALID_REQUEST');
      const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!token) throw Error('FORBIDDEN');
      const raw = await request.text();
      if (raw.length > 4096) throw Error('INVALID_REQUEST');
      let body: Record<string, unknown>;
      try { body = JSON.parse(raw); } catch { throw Error('INVALID_REQUEST'); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.room_id !== 'string' || !UUID.test(body.room_id)
        || typeof body.action !== 'string') throw Error('INVALID_REQUEST');
      const action = body.action;
      if (action !== 'snapshot' && !ACTIONS.has(action as BombAction)) throw Error('UNKNOWN_ACTION');
      if (action !== 'snapshot' && (!Number.isSafeInteger(body.expected_version) || (body.expected_version as number) < 1
        || typeof body.request_id !== 'string' || !UUID.test(body.request_id))) throw Error('INVALID_REQUEST');
      const payload = body.payload ?? {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw Error('INVALID_REQUEST');
      const actorHash = await hashToken(token);
      for (let attempt = 0; attempt < 4; attempt++) {
        const snapshot = await rpc('bomb_get',{ p_credential_hash: actorHash, p_room: body.room_id }) as Snapshot;
        const now = Date.parse(snapshot.server_now);
        const settled = settleBomb(snapshot.state,snapshot.secret,now);
        if (settled.changed) {
          try {
            const committed = await rpc('bomb_commit',{ p_credential_hash: actorHash, p_room: body.room_id,
              p_expected_version: snapshot.version, p_state: settled.state, p_secret: settled.secret }) as {version:number;room_version:number};
            await broadcast(body.room_id,committed.room_version).catch(()=>undefined);
            if (action !== 'snapshot') throw Error('PHASE_CONFLICT');
            return reply(200,sanitize({ ...snapshot, ...committed, state: settled.state, secret: settled.secret }));
          } catch(error) {
            if (error instanceof Error && error.message === 'VERSION_CONFLICT') continue;
            throw error;
          }
        }
        if (action === 'snapshot') return reply(200,sanitize(snapshot));
        if (snapshot.secret.receipts?.some(item => item.id === body.request_id && item.actor === snapshot.me))
          return reply(200,sanitize(snapshot));
        if (body.expected_version !== snapshot.version) throw Error('VERSION_CONFLICT');
        const result = applyBombAction(snapshot.state,snapshot.secret,action as BombAction,
          payload as Record<string,unknown>,snapshot.me,snapshot.host,snapshot.players,now);
        const recent = [...(snapshot.secret.receipts??[]).slice(-63),{ id:body.request_id as string,actor:snapshot.me }];
        const secret = { ...result.secret,receipts:recent };
        try {
          const committed = await rpc('bomb_commit',{ p_credential_hash: actorHash, p_room: body.room_id,
            p_expected_version:snapshot.version,p_state:result.state,p_secret:secret }) as {version:number;room_version:number};
          await broadcast(body.room_id,committed.room_version).catch(()=>undefined);
          return reply(200,sanitize({ ...snapshot, ...committed, state:result.state, secret }));
        } catch(error) {
          if (error instanceof Error && (error.message === 'VERSION_CONFLICT' || error.message === 'PHASE_CONFLICT')) continue;
          throw error;
        }
      }
      throw Error('VERSION_CONFLICT');
    } catch(error) { return errorResponse(error); }
  };
}
