import { ApiError, errorCode, type Rpc, type Broadcast } from './room.ts';
import { hashToken } from './security.ts';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CONFLICTS = new Set(['VERSION_CONFLICT','PHASE_CONFLICT','REQUEST_CONFLICT','ROUND_ACTIVE','PLAYER_COUNT','PLAYERS_OFFLINE','ALREADY_SUBMITTED','ALREADY_ACKNOWLEDGED','DISCUSSION_NOT_OVER','DISCUSSION_OVER','ALREADY_VOTED']);
export function gameCommandHandler(rpc: Rpc, broadcast: Broadcast) {
  return async (request: Request): Promise<Response> => {
    const reply = (status: number, value: object) => Response.json(value, { status, headers: { 'Cache-Control':'no-store','X-Content-Type-Options':'nosniff' } });
    try {
      if (request.method !== 'POST') return reply(405, { error:'METHOD_NOT_ALLOWED' });
      const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
      if (!token) return reply(401, { error:'UNAUTHORIZED' });
      const text = await request.text();
      if (text.length > 4096) throw new ApiError('INVALID_REQUEST');
      let input;
      try { input = JSON.parse(text); } catch { throw new ApiError('INVALID_REQUEST'); }
      if (!input || typeof input !== 'object' || Array.isArray(input)
        || typeof input.room_id !== 'string' || typeof input.request_id !== 'string' || !UUID.test(input.room_id) || !UUID.test(input.request_id)
        || !Number.isInteger(input.expected_version) || input.expected_version < 1 || input.expected_version > 2147483647
        || !['LOBBY','COLLECT_WORDS','REVEAL_ROLE','HINT','DISCUSS','PAUSED_HOST','VOTE_1','VOTE_RUNOFF','REVEAL_VOTE','FINAL_RESULT'].includes(input.expected_phase)
        || !['start_round','submit_word','ack_role','cancel_round','finish_hint','pause','resume','start_vote','submit_vote','return_lobby'].includes(input.action)) throw new ApiError('INVALID_REQUEST');
      const payload = input.payload ?? {};
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError('INVALID_REQUEST');
      if (input.action === 'submit_vote') {
        if (typeof payload.round_id !== 'string' || !UUID.test(payload.round_id) || ![1,2].includes(payload.ballot_no)) throw new ApiError('INVALID_REQUEST');
        if (typeof payload.target_id !== 'string' || !UUID.test(payload.target_id)) throw new ApiError('INVALID_TARGET');
      }
      if (input.action === 'submit_word') {
        if (typeof payload.word !== 'string') throw new ApiError('INVALID_WORD');
        const word = payload.word.normalize('NFC').trim();
        if ([...word.replace(/\s/gu,'')].length < 2 || [...word].length > 30 || /[\p{Cc}\p{Cf}\p{Cs}]/u.test(word)) throw new ApiError('INVALID_WORD');
        payload.word = word;
      }
      const result = await rpc('game_command', {
        p_credential_hash:await hashToken(token), p_room:input.room_id, p_action:input.action, p_payload:payload,
        p_expected_version:input.expected_version, p_expected_phase:input.expected_phase, p_request_id:input.request_id,
      }) as { version:number; changed:boolean };
      if (result.changed) await broadcast(input.room_id,result.version).catch(() => undefined);
      return reply(200, {version:result.version});
    } catch (error) {
      const code = error instanceof ApiError ? error.code : errorCode(error);
      const status = CONFLICTS.has(code) ? 409 : ['HOST_ONLY','FORBIDDEN','NOT_ROUND_PLAYER','NOT_YOUR_TURN'].includes(code) ? 403
        : code === 'ROOM_CLOSED' ? 410 : ['INVALID_REQUEST','INVALID_WORD','INVALID_TARGET'].includes(code) ? 400 : 503;
      return reply(status, {error:code});
    }
  };
}
