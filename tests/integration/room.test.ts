// M1 room lifecycle through the real Edge handlers + the real migration on embedded PostgreSQL.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commandHandler, createRoomHandler, joinRoomHandler, LIMITS, recoverHandler, snapshotRoomHandler, type Rpc } from '../../supabase/functions/_shared/room';

const db = new PGlite();
const rpc: Rpc = async (fn, args) => {
  const keys = Object.keys(args);
  const params = keys.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  await db.exec('set role service_role');
  try {
    const { rows } = await db.query<{ r: unknown }>(`select public.${fn}(${keys.map((k, i) => `${k} => $${i + 1}`).join(', ')}) as r`, params);
    return rows[0].r;
  } finally { await db.exec('reset role'); }
};
const sent: Array<[string, number]> = [];
const broadcast = async (room: string, version: number) => { sent.push([room, version]); };
const api = { create: createRoomHandler(rpc, broadcast), join: joinRoomHandler(rpc, broadcast), recover: recoverHandler(rpc), snapshot: snapshotRoomHandler(rpc), command: commandHandler(rpc, broadcast) };
type Session = { room_id: string; code: string; player_id: string; token: string; recovery_code: string };
// Each request comes from a random client IP unless one is given, so rate limits do not interfere with other tests.
const randomIp = () => `10.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;
const post = (body: object, token?: string, ip = randomIp()) => new Request('https://fn.test', { method: 'POST', headers: { 'x-forwarded-for': `${ip}, 10.0.0.1`, ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const create = async (nickname = '방장') => (await (await api.create(post({ nickname }))).json()) as Session;
const join = (code: string, nickname: string) => api.join(post({ room_code: code, nickname }));
const snapshot = (s: { token: string }, room: string) => api.snapshot(new Request(`https://fn.test?room_id=${room}`, { headers: { Authorization: `Bearer ${s.token}` } }));
const command = (s: { token: string }, room: string, action: string, expected_version?: number, payload?: object) => api.command(post({ room_id: room, action, payload, expected_version, request_id: randomUUID() }, s.token));
const version = async (s: Session) => ((await (await snapshot(s, s.room_id)).json()) as { room: { version: number } }).room.version;

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(() => { sent.length = 0; });

describe('database permissions', () => {
  it('denies anon/authenticated on private tables and every room RPC', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      try {
        await expect(db.query('select * from app_private.rooms')).rejects.toThrow(/permission denied/);
        await expect(db.query('select * from app_private.players')).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_create('닉네임', '닉네임', repeat('a',64), repeat('b',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_join('000000', '닉네임', '닉네임', repeat('a',64), repeat('b',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.player_recover('000000', repeat('a',64), repeat('b',64), repeat('c',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_snapshot(repeat('a',64), gen_random_uuid())")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_command(repeat('a',64), gen_random_uuid(), 'leave', '{}', 1)")).rejects.toThrow(/permission denied/);
      } finally { await db.exec('reset role'); }
    }
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from pg_class where relnamespace='app_private'::regnamespace and relkind='r' and relrowsecurity");
    expect(rows[0].n).toBe(9);
  });
});

describe('create / join / capacity', () => {
  it('creates a room and returns only the owner session; snapshot hides credentials', async () => {
    const host = await create();
    expect(host.code).toMatch(/^\d{6}$/);
    expect(host.token).toMatch(/^[a-f0-9]{64}$/);
    expect(host.recovery_code.replace(/-/g, '')).toHaveLength(26);
    const res = await snapshot(host, host.room_id);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/hash|token|recovery/);
    const dto = JSON.parse(text);
    expect(dto.me).toEqual({ player_id: host.player_id, is_host: true });
    expect(dto.players).toHaveLength(1);
  });
  it('rejects the 13th player, duplicate nicknames (case-insensitive) and unknown codes', async () => {
    const host = await create('Host');
    for (let i = 2; i <= 12; i++) expect((await join(host.code, `참가자${i}`)).status).toBe(200);
    expect(await (await join(host.code, '열세번째')).json()).toEqual({ error: 'ROOM_FULL' });
    const other = await create('Alpha');
    expect(await (await join(other.code, 'alpha')).json()).toEqual({ error: 'NICKNAME_TAKEN' });
    expect(await (await join(other.code, String.fromCodePoint(0xff21, 0xff4c, 0xff50, 0xff48, 0xff41))).json()).toEqual({ error: 'NICKNAME_TAKEN' });
    expect((await join(other.code, ' 가 ')).status).toBe(400);
    const { rows } = await db.query<{ c: string }>("select lpad(n::text,6,'0') c from generate_series(0,999999) n where lpad(n::text,6,'0') not in (select code from app_private.rooms where status='open') limit 1");
    expect(await (await join(rows[0].c, '손님')).json()).toEqual({ error: 'ROOM_NOT_FOUND' });
    expect(sent.length).toBeGreaterThan(0);
  });
});

describe('authorization', () => {
  it('denies foreign-room tokens, unknown tokens and missing tokens', async () => {
    const a = await create('A방장');
    const b = await create('B방장');
    expect((await snapshot(a, b.room_id)).status).toBe(403);
    expect((await snapshot({ token: 'f'.repeat(64) }, a.room_id)).status).toBe(403);
    expect((await api.snapshot(new Request(`https://fn.test?room_id=${a.room_id}`))).status).toBe(401);
    expect((await command(a, b.room_id, 'close_room', await version(b))).status).toBe(403);
    expect((await snapshot(b, b.room_id)).status).toBe(200);
  });
  it('enforces host-only settings, validation and version checks', async () => {
    const host = await create('방장님');
    const guest = (await (await join(host.code, '손님')).json()) as Session;
    let v = await version(host);
    expect(await (await command(guest, host.room_id, 'update_settings', v, { hint_rounds: 2 })).json()).toEqual({ error: 'HOST_ONLY' });
    expect((await command(guest, host.room_id, 'close_room', v)).status).toBe(403);
    expect((await command(host, host.room_id, 'update_settings', v, { hint_rounds: 9 })).status).toBe(400);
    expect((await command(host, host.room_id, 'update_settings', v, { role: 'liar' })).status).toBe(400);
    expect((await command(host, host.room_id, 'update_settings', v - 1, { hint_rounds: 2 })).status).toBe(409);
    const ok = await command(host, host.room_id, 'update_settings', v, { hint_rounds: 2, word_mode: 'custom', discussion_seconds: 0 });
    expect(ok.status).toBe(200);
    v = ((await ok.json()) as { version: number }).version;
    const dto = await (await snapshot(guest, host.room_id)).json();
    expect(dto.room.settings).toEqual({ hint_rounds: 2, word_mode: 'custom', discussion_seconds: 0 });
    expect(dto.room.version).toBe(v);
    expect(sent).toContainEqual([host.room_id, v]);
  });
  it('heartbeat marks the player connected without bumping version or broadcasting', async () => {
    const host = await create('하트비트');
    const before = await version(host);
    sent.length = 0;
    const res = await command(host, host.room_id, 'heartbeat');
    expect(await res.json()).toEqual({ version: before });
    expect(sent).toEqual([]);
    const dto = await (await snapshot(host, host.room_id)).json();
    expect(dto.players[0].connected).toBe(true);
  });
});

describe('recovery and lifecycle', () => {
  it('recovery rotates the session token and the recovery code', async () => {
    const host = await create('복구테스트');
    const res = await api.recover(post({ room_code: host.code, recovery_code: host.recovery_code.toLowerCase() }));
    expect(res.status).toBe(200);
    const fresh = (await res.json()) as Session;
    expect(fresh.player_id).toBe(host.player_id);
    expect((await snapshot(host, host.room_id)).status).toBe(403);
    expect((await snapshot(fresh, host.room_id)).status).toBe(200);
    expect((await api.recover(post({ room_code: host.code, recovery_code: host.recovery_code }))).status).toBe(403);
    expect((await api.recover(post({ room_code: host.code, recovery_code: 'not-a-code' }))).status).toBe(403);
  });
  it('host leave transfers host by join order; closing the room blocks everything', async () => {
    const host = await create('첫번째');
    const second = (await (await join(host.code, '두번째')).json()) as Session;
    const third = (await (await join(host.code, '세번째')).json()) as Session;
    expect((await command(host, host.room_id, 'leave', await version(host))).status).toBe(200);
    expect((await snapshot(host, host.room_id)).status).toBe(403);
    const dto = await (await snapshot(second, host.room_id)).json();
    expect(dto.room.host_player_id).toBe(second.player_id);
    expect(dto.players.map((p: { nickname: string }) => p.nickname)).toEqual(['두번째', '세번째']);
    expect((await command(third, host.room_id, 'close_room', dto.room.version)).status).toBe(403);
    expect((await command(second, host.room_id, 'close_room', dto.room.version)).status).toBe(200);
    expect(await (await snapshot(third, host.room_id)).json()).toEqual({ error: 'ROOM_CLOSED' });
    expect((await command(third, host.room_id, 'heartbeat')).status).toBe(410);
    expect((await join(host.code, '늦은손님')).status).toBe(404);
  });
  it('expired rooms are closed for every operation', async () => {
    const host = await create('만료');
    await db.query("update app_private.rooms set expires_at = now() - interval '1 second' where id = $1", [host.room_id]);
    expect((await snapshot(host, host.room_id)).status).toBe(410);
    expect((await join(host.code, '손님')).status).toBe(404);
    expect((await api.recover(post({ room_code: host.code, recovery_code: host.recovery_code }))).status).toBe(403);
  });
});

describe('hardening', () => {
  it('host can kick (kicked token is dead) and lock the room; guests cannot', async () => {
    const host = await create('강퇴방장');
    const bot = (await (await join(host.code, '봇이다')).json()) as Session;
    const friend = (await (await join(host.code, '친구야')).json()) as Session;
    let v = await version(host);
    expect(await (await command(friend, host.room_id, 'kick', v, { player_id: bot.player_id })).json()).toEqual({ error: 'HOST_ONLY' });
    expect(await (await command(host, host.room_id, 'kick', v, { player_id: host.player_id })).json()).toEqual({ error: 'CANNOT_KICK_SELF' });
    expect(await (await command(host, host.room_id, 'kick', v, { player_id: 'nope' })).json()).toEqual({ error: 'PLAYER_NOT_FOUND' });
    expect((await command(host, host.room_id, 'kick', v, { player_id: bot.player_id })).status).toBe(200);
    expect((await snapshot(bot, host.room_id)).status).toBe(403);
    v = await version(host);
    expect((await command(friend, host.room_id, 'lock', v, { locked: true })).status).toBe(403);
    expect((await command(host, host.room_id, 'lock', v, { locked: 'yes' })).status).toBe(400);
    expect((await command(host, host.room_id, 'lock', v, { locked: true })).status).toBe(200);
    expect(await (await join(host.code, '새손님')).json()).toEqual({ error: 'ROOM_LOCKED' });
    const dto = await (await snapshot(friend, host.room_id)).json();
    expect(dto.room.locked).toBe(true);
    expect(dto.players.map((p: { nickname: string }) => p.nickname)).toEqual(['강퇴방장', '친구야']);
  });
  it('no-op commands and recovery do not bump the version or broadcast', async () => {
    const host = await create('버전방장');
    const v = await version(host);
    sent.length = 0;
    expect(await (await command(host, host.room_id, 'update_settings', v, {})).json()).toEqual({ version: v });
    expect(await (await command(host, host.room_id, 'update_settings', v, { hint_rounds: 1 })).json()).toEqual({ version: v });
    expect(await (await command(host, host.room_id, 'lock', v, { locked: false })).json()).toEqual({ version: v });
    const fresh = (await (await api.recover(post({ room_code: host.code, recovery_code: host.recovery_code }))).json()) as Session;
    expect(await version(fresh)).toBe(v);
    expect(sent).toEqual([]);
  });
  it('rejects out-of-range versions as bad requests and ignores the version on heartbeat', async () => {
    const host = await create('범위방장');
    for (const bad of [0, -1, 2 ** 31, 1.5, '1']) expect((await command(host, host.room_id, 'update_settings', bad as number, { hint_rounds: 2 })).status).toBe(400);
    const res = await api.command(post({ room_id: host.room_id, action: 'heartbeat', expected_version: { x: 1 }, request_id: randomUUID() }, host.token));
    expect(res.status).toBe(200);
  });
});

describe('row growth cap', () => {
  it('a room stops accepting joins after 50 seats were ever used (join/leave churn)', async () => {
    const host = await create('회전방장');
    await db.query("update app_private.players set join_order = 50 where id = $1", [host.player_id]);
    expect(await (await join(host.code, '늦은손님')).json()).toEqual({ error: 'ROOM_FULL' });
  });
});

describe('rate limits', () => {
  it('limits room creation and joins per client IP, and joins per room code', async () => {
    const ip = '203.0.113.7';
    for (let i = 0; i < LIMITS.createPerIp[0]; i++) expect((await api.create(post({ nickname: `생성${i}` }, undefined, ip))).status).toBe(200);
    expect(await (await api.create(post({ nickname: '초과' }, undefined, ip))).json()).toEqual({ error: 'RATE_LIMITED' });
    expect((await api.create(post({ nickname: '다른IP' }))).status).toBe(200);
    const probe = '198.51.100.9';
    let last = 0;
    for (let i = 0; i <= LIMITS.joinPerIp[0]; i++) last = (await api.join(post({ room_code: '000000', nickname: `탐색${i}` }, undefined, probe))).status;
    expect(last).toBe(429);
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from app_private.rate_limits where bucket like '%ip:%' and bucket ~ '^[a-z]+:ip:[0-9a-f]{32}$'");
    expect(rows[0].n).toBeGreaterThan(0);
  });
  it('rate RPC is service_role only', async () => {
    await db.exec('set role anon');
    try { await expect(db.query("select public.rate_hit('x', 1, 60)")).rejects.toThrow(/permission denied/); } finally { await db.exec('reset role'); }
  });
});
