// M1 room lifecycle through the real Edge handlers + the real migration on embedded PostgreSQL.
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { commandHandler, createRoomHandler, joinRoomHandler, recoverHandler, snapshotRoomHandler, type Rpc } from '../../supabase/functions/_shared/room';

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
const api = { create: createRoomHandler(rpc, broadcast), join: joinRoomHandler(rpc, broadcast), recover: recoverHandler(rpc, broadcast), snapshot: snapshotRoomHandler(rpc), command: commandHandler(rpc, broadcast) };
type Session = { room_id: string; code: string; player_id: string; token: string; recovery_code: string };
const post = (body: object, token?: string) => new Request('https://fn.test', { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
const create = async (nickname = '방장') => (await (await api.create(post({ nickname }))).json()) as Session;
const join = (code: string, nickname: string) => api.join(post({ room_code: code, nickname }));
const snapshot = (s: { token: string }, room: string) => api.snapshot(new Request(`https://fn.test?room_id=${room}`, { headers: { Authorization: `Bearer ${s.token}` } }));
const command = (s: { token: string }, room: string, action: string, expected_version?: number, payload?: object) => api.command(post({ room_id: room, action, payload, expected_version, request_id: randomUUID() }, s.token));
const version = async (s: Session) => ((await (await snapshot(s, s.room_id)).json()) as { room: { version: number } }).room.version;

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const file of ['20261021071859_m0_security_poc.sql', '20261024064956_m1_rooms_players.sql']) await db.exec(await readFile(`supabase/migrations/${file}`, 'utf8'));
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
        await expect(db.query("select public.room_create('닉네임', repeat('a',64), repeat('b',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_join('000000', '닉네임', repeat('a',64), repeat('b',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.player_recover('000000', repeat('a',64), repeat('b',64), repeat('c',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_snapshot(repeat('a',64), gen_random_uuid())")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_command(repeat('a',64), gen_random_uuid(), 'leave', '{}', 1)")).rejects.toThrow(/permission denied/);
      } finally { await db.exec('reset role'); }
    }
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from pg_class where relnamespace='app_private'::regnamespace and relkind='r' and relrowsecurity");
    expect(rows[0].n).toBe(2);
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
