// M1 room API handlers. Pure: database and broadcast are injected so the same code runs in
// Edge Functions and in the PGlite integration tests.
import { hashToken, newToken } from './security.ts';

export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<unknown>;
export type Broadcast = (roomId: string, version: number) => Promise<void>;

const KNOWN: Record<string, number> = {
  INVALID_REQUEST: 400, INVALID_NICKNAME: 400, INVALID_CODE: 400, INVALID_SETTINGS: 400, UNKNOWN_ACTION: 400,
  CANNOT_KICK_SELF: 400, UNAUTHORIZED: 401, FORBIDDEN: 403, HOST_ONLY: 403, RECOVERY_FAILED: 403, ROOM_LOCKED: 403,
  ROOM_NOT_FOUND: 404, PLAYER_NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405, ROOM_FULL: 409, NICKNAME_TAKEN: 409, VERSION_CONFLICT: 409, ROOM_CLOSED: 410,
  RATE_LIMITED: 429,
  PLAYER_COUNT: 409, PLAYERS_OFFLINE: 409, ROUND_ACTIVE: 409, PHASE_CONFLICT: 409,
  REQUEST_CONFLICT: 409, ALREADY_SUBMITTED: 409, ALREADY_ACKNOWLEDGED: 409,
  NOT_ROUND_PLAYER: 403, INVALID_WORD: 400,
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
// Built from code points so the source stays ASCII (some tooling rewrites \u escapes).
const cp = (n: number) => `\\u{${n.toString(16)}}`;
const charClass = (ranges: Array<[number, number]>) => new RegExp(`[${ranges.map(([a, b]) => `${cp(a)}-${cp(b)}`).join('')}]`, 'u');
// Control, invisible, filler and bidi characters. ZWJ (0x200d) is handled separately (emoji sequences only).
const INVISIBLE = charClass([[0x00, 0x1f], [0x7f, 0x9f], [0xad, 0xad], [0x34f, 0x34f], [0x61c, 0x61c], [0x115f, 0x1160],
  [0x17b4, 0x17b5], [0x180b, 0x180f], [0x200b, 0x200c], [0x200e, 0x200f], [0x2028, 0x202e], [0x2060, 0x206f],
  [0x2800, 0x2800], [0x3164, 0x3164], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfff8], [0xe0000, 0xe007f]]);
const BAD_ZWJ = new RegExp(`(?<!\\p{Extended_Pictographic}${cp(0xfe0f)}?)${cp(0x200d)}|${cp(0x200d)}(?!\\p{Extended_Pictographic})`, 'u');
const LATIN = /\p{Script=Latin}/u;
const CYRILLIC_GREEK = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
// Look-alike folding for the uniqueness key (Cyrillic/Greek homoglyphs, 0/O, 1/l/I).
const FOLD = new Map<string, string>([
  [0x430, 'a'], [0x435, 'e'], [0x43e, 'o'], [0x440, 'p'], [0x441, 'c'], [0x443, 'y'], [0x445, 'x'], [0x456, 'l'],
  [0x458, 'j'], [0x455, 's'], [0x501, 'd'], [0x4bb, 'h'], [0x4cf, 'l'], [0x3b1, 'a'], [0x3bf, 'o'], [0x3c1, 'p'],
  [0x3bd, 'v'], [0x3b9, 'l'], [0x3ba, 'k'], [0x3c4, 't'], [0x3c5, 'u'], [0x3c7, 'x'], [0x3b5, 'e'],
].map(([c, to]) => [String.fromCodePoint(c as number), to as string]));
const graphemes = (value: string) => [...new Intl.Segmenter('ko', { granularity: 'grapheme' }).segment(value)].length;

export type Nickname = { display: string; key: string };
/** NFKC display name (2-16 visible characters) plus a confusable-folded key used for uniqueness. */
export function normalizeNickname(value: unknown): Nickname {
  if (typeof value !== 'string') throw new ApiError('INVALID_NICKNAME');
  const display = value.normalize('NFKC').trim().replace(/\s+/g, ' ');
  const hasLoneSurrogate = [...display].some((ch) => { const c = ch.codePointAt(0)!; return c >= 0xd800 && c <= 0xdfff; });
  const length = graphemes(display);
  if (length < 2 || length > 16 || [...display].length > 64 || hasLoneSurrogate || INVISIBLE.test(display) || BAD_ZWJ.test(display)) {
    throw new ApiError('INVALID_NICKNAME');
  }
  if (LATIN.test(display) && CYRILLIC_GREEK.test(display)) throw new ApiError('INVALID_NICKNAME');
  const key = [...display.toLowerCase()].map((ch) => FOLD.get(ch) ?? ch).join('')
    .replace(/[01i|]/g, (ch) => (ch === '0' ? 'o' : 'l')).replace(/ /g, '');
  return { display, key };
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

/** [max hits, window seconds] per bucket. Generous for real groups, tight for scripts. */
export const LIMITS = {
  createPerIp: [10, 600], joinPerIp: [30, 600], joinPerRoom: [60, 600], recoverPerIp: [10, 600], recoverPerRoom: [30, 600],
} as const satisfies Record<string, readonly [number, number]>;
/** First hop of X-Forwarded-For (set by the Supabase edge), hashed so raw IPs are never stored. */
async function ipBucket(request: Request, kind: string): Promise<string> {
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown';
  return `${kind}:ip:${(await hashToken(`party-game-rl:${ip}`)).slice(0, 32)}`;
}
async function limit(rpc: Rpc, bucket: string, [max, windowSeconds]: readonly [number, number]) {
  if (!(await rpc('rate_hit', { p_bucket: bucket, p_limit: max, p_window_seconds: windowSeconds }))) throw new ApiError('RATE_LIMITED');
}

type Issued = { room_id: string; code: string; player_id: string; version: number };
/** Issue a fresh session token + recovery code; only their hashes reach the database. */
async function issue(run: (credentialHash: string, recoveryHash: string) => Promise<Issued>, broadcast: Broadcast | null) {
  const token = newToken();
  const recovery = newRecoveryCode();
  const issued = await run(await hashToken(token), await hashToken(normalizeRecoveryCode(recovery)));
  if (broadcast) await notify(broadcast, issued.room_id, issued.version);
  return reply(200, { room_id: issued.room_id, code: issued.code, player_id: issued.player_id, token, recovery_code: recovery });
}

export function createRoomHandler(rpc: Rpc, broadcast: Broadcast) {
  return guard(async (request) => {
    const input = await body(request);
    const nickname = normalizeNickname(input.nickname);
    await limit(rpc, await ipBucket(request, 'create'), LIMITS.createPerIp);
    return issue(async (p_credential_hash, p_recovery_hash) => await rpc('room_create', { p_nickname: nickname.display, p_nickname_key: nickname.key, p_credential_hash, p_recovery_hash }) as Issued, broadcast);
  });
}
export function joinRoomHandler(rpc: Rpc, broadcast: Broadcast) {
  return guard(async (request) => {
    const input = await body(request);
    const code = normalizeCode(input.room_code);
    const nickname = normalizeNickname(input.nickname);
    await limit(rpc, await ipBucket(request, 'join'), LIMITS.joinPerIp);
    await limit(rpc, `join:room:${code}`, LIMITS.joinPerRoom);
    return issue(async (p_credential_hash, p_recovery_hash) => await rpc('room_join', { p_code: code, p_nickname: nickname.display, p_nickname_key: nickname.key, p_credential_hash, p_recovery_hash }) as Issued, broadcast);
  });
}
// Recovery changes nothing other players can see, so it sends no version hint.
export function recoverHandler(rpc: Rpc) {
  return guard(async (request) => {
    const input = await body(request);
    const code = normalizeCode(input.room_code);
    const recoveryHash = await hashToken(normalizeRecoveryCode(input.recovery_code));
    await limit(rpc, await ipBucket(request, 'recover'), LIMITS.recoverPerIp);
    await limit(rpc, `recover:room:${code}`, LIMITS.recoverPerRoom);
    return issue(async (p_credential_hash, p_new_recovery_hash) => await rpc('player_recover', { p_code: code, p_recovery_hash: recoveryHash, p_credential_hash, p_new_recovery_hash }) as Issued, null);
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
const ACTIONS = new Set(['heartbeat', 'update_settings', 'lock', 'kick', 'leave', 'close_room']);
const MAX_INT = 2147483647;
export function commandHandler(rpc: Rpc, broadcast: Broadcast) {
  return guard(async (request) => {
    const token = bearer(request);
    const input = await body(request);
    const room = roomId(input.room_id);
    if (typeof input.action !== 'string' || !ACTIONS.has(input.action)) throw new ApiError('UNKNOWN_ACTION');
    if (typeof input.request_id !== 'string' || !UUID.test(input.request_id)) throw new ApiError('INVALID_REQUEST');
    // heartbeat ignores the version; every other command must name the version it saw (1..int4 max).
    const expected = input.action === 'heartbeat' ? null : input.expected_version;
    if (expected !== null && !(Number.isInteger(expected) && (expected as number) >= 1 && (expected as number) <= MAX_INT)) throw new ApiError('INVALID_REQUEST');
    const payload = input.payload ?? {};
    if (typeof payload !== 'object' || Array.isArray(payload)) throw new ApiError('INVALID_REQUEST');
    const result = await rpc('room_command', { p_credential_hash: await hashToken(token), p_room: room, p_action: input.action, p_payload: payload, p_expected_version: expected }) as { version: number; changed: boolean };
    if (result.changed) await notify(broadcast, room, result.version);
    return reply(200, { version: result.version });
  });
}
