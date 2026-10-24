// M1 room API handlers. Pure: database and broadcast are injected so the same code runs in
// Edge Functions and in the PGlite integration tests.
import { hashToken, newToken } from './security.ts';

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
export type Broadcast = (roomId: string, version: number) => Promise<void>;

const KNOWN: Record<string, number> = {
  INVALID_REQUEST: 400, INVALID_NICKNAME: 400, INVALID_CODE: 400, INVALID_SETTINGS: 400, UNKNOWN_ACTION: 400,
  UNAUTHORIZED: 401, FORBIDDEN: 403, HOST_ONLY: 403, RECOVERY_FAILED: 403, ROOM_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405, ROOM_FULL: 409, NICKNAME_TAKEN: 409, VERSION_CONFLICT: 409, ROOM_CLOSED: 410,
};
export class ApiError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
/** Map a database error message to a public error code; anything unknown becomes 503 (fail closed). */
export function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === 'object' && error && 'message' in error ? String((error as { message: unknown }).message) : '';
  return message in KNOWN ? message : 'TEMPORARILY_UNAVAILABLE';
}
const reply = (status: number, body: object) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
const fail = (code: string) => reply(KNOWN[code] ?? 503, { error: code });

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Control, zero-width and bidi-override characters (built from code points to keep the source ASCII).
const CONTROL = new RegExp(`[${[[0x00, 0x1f], [0x7f, 0x9f], [0x200b, 0x200f], [0x2028, 0x202e], [0x2066, 0x2069], [0xfeff, 0xfeff]]
  .map(([a, b]) => `\\u${a.toString(16).padStart(4, '0')}-\\u${b.toString(16).padStart(4, '0')}`).join('')}]`);

export function normalizeNickname(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('INVALID_NICKNAME');
  const nickname = value.normalize('NFC').trim().replace(/\s+/g, ' ');
  const length = [...nickname].length;
  if (length < 2 || length > 16 || CONTROL.test(nickname)) throw new ApiError('INVALID_NICKNAME');
  return nickname;
}
export function normalizeCode(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{6}$/.test(value.trim())) throw new ApiError('INVALID_CODE');
  return value.trim();
}

// Recovery code: 128 random bits as 26 Crockford base32 characters, shown as groups of 4.
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function newRecoveryCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  let bits = 0, value = 0, out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte; bits += 8;
    while (bits >= 5) { out += ALPHABET[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join('-');
}
export function normalizeRecoveryCode(value: unknown): string {
  if (typeof value !== 'string') throw new ApiError('RECOVERY_FAILED');
  const code = value.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (!/^[0-9A-HJKMNP-TV-Z]{26}$/.test(code)) throw new ApiError('RECOVERY_FAILED');
  return code;
}

async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.method !== 'POST') throw new ApiError('METHOD_NOT_ALLOWED');
  const text = await request.text();
  if (text.length > 4096) throw new ApiError('INVALID_REQUEST');
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  } catch { /* fall through */ }
  throw new ApiError('INVALID_REQUEST');
}
function bearer(request: Request): string {
  const token = request.headers.get('Authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if (!token) throw new ApiError('UNAUTHORIZED');
  return token;
}
function roomId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new ApiError('INVALID_REQUEST');
  return value;
}
async function notify(broadcast: Broadcast, room: string, version: unknown) {
  // Best effort: clients also poll, so a failed hint never fails the command.
  if (typeof version === 'number') await broadcast(room, version).catch(() => undefined);
}
function guard(run: (request: Request) => Promise<Response>) {
  return async (request: Request) => {
    try { return await run(request); } catch (error) { return fail(error instanceof ApiError ? error.code : errorCode(error)); }
  };
}

type Issued = { room_id: string; code: string; player_id: string; version: number };
/** Issue a fresh session token + recovery code; only their hashes reach the database. */
async function issue(run: (credentialHash: string, recoveryHash: string) => Promise<Issued>, broadcast: Broadcast) {
  const token = newToken();
  const recovery = newRecoveryCode();
  const issued = await run(await hashToken(token), await hashToken(normalizeRecoveryCode(recovery)));
  await notify(broadcast, issued.room_id, issued.version);
  return reply(200, { room_id: issued.room_id, code: issued.code, player_id: issued.player_id, token, recovery_code: recovery });
}

export function createRoomHandler(rpc: Rpc, broadcast: Broadcast) {
  return guard(async (request) => {
    const input = await body(request);
    const nickname = normalizeNickname(input.nickname);
    return issue(async (p_credential_hash, p_recovery_hash) => await rpc('room_create', { p_nickname: nickname, p_credential_hash, p_recovery_hash }) as Issued, broadcast);
  });
}
export function joinRoomHandler(rpc: Rpc, broadcast: Broadcast) {
  return guard(async (request) => {
    const input = await body(request);
    const code = normalizeCode(input.room_code);
    const nickname = normalizeNickname(input.nickname);
    return issue(async (p_credential_hash, p_recovery_hash) => await rpc('room_join', { p_code: code, p_nickname: nickname, p_credential_hash, p_recovery_hash }) as Issued, broadcast);
  });
}
export function recoverHandler(rpc: Rpc, broadcast: Broadcast) {
  return guard(async (request) => {
    const input = await body(request);
    const code = normalizeCode(input.room_code);
    const recoveryHash = await hashToken(normalizeRecoveryCode(input.recovery_code));
    return issue(async (p_credential_hash, p_new_recovery_hash) => await rpc('player_recover', { p_code: code, p_recovery_hash: recoveryHash, p_credential_hash, p_new_recovery_hash }) as Issued, broadcast);
  });
}
export function snapshotRoomHandler(rpc: Rpc) {
  return guard(async (request) => {
    if (request.method !== 'GET') throw new ApiError('METHOD_NOT_ALLOWED');
    const token = bearer(request);
    const room = roomId(new URL(request.url).searchParams.get('room_id'));
    const snapshot = await rpc('room_snapshot', { p_credential_hash: await hashToken(token), p_room: room });
    if (!snapshot) throw new ApiError('FORBIDDEN');
    return reply(200, snapshot as object);
  });
}
const ACTIONS = new Set(['heartbeat', 'update_settings', 'leave', 'close_room']);
export function commandHandler(rpc: Rpc, broadcast: Broadcast) {
  return guard(async (request) => {
    const token = bearer(request);
    const input = await body(request);
    const room = roomId(input.room_id);
    if (typeof input.action !== 'string' || !ACTIONS.has(input.action)) throw new ApiError('UNKNOWN_ACTION');
    if (typeof input.request_id !== 'string' || !UUID.test(input.request_id)) throw new ApiError('INVALID_REQUEST');
    const expected = input.expected_version;
    if (input.action !== 'heartbeat' && !Number.isSafeInteger(expected)) throw new ApiError('INVALID_REQUEST');
    const payload = input.payload ?? {};
    if (typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError('INVALID_REQUEST');
    const result = await rpc('room_command', { p_credential_hash: await hashToken(token), p_room: room, p_action: input.action, p_payload: payload, p_expected_version: expected ?? null }) as { version: number; changed: boolean };
    if (result.changed) await notify(broadcast, room, result.version);
    return reply(200, { version: result.version });
  });
}
