import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { commandHandler } from '../../supabase/functions/_shared/room';
import { hashToken } from '../../supabase/functions/_shared/security';

const db = new PGlite();
const migration = '20261029140001_mafia_leave_guard.sql';
const patch = await readFile(`supabase/migrations/${migration}`, 'utf8');
let original = '';
const broadcast = { calls: 0 };
const handler = commandHandler(async (fn, args) => {
  // Preserve the test transaction when an RPC raises an expected rejection.
  await db.exec('savepoint rpc_call; set role service_role;');
  try {
    const keys = Object.keys(args);
    const { rows } = await db.query<{ value: unknown }>(
      `select public.${fn}(${keys.map((key, i) => `${key} => $${i + 1}`).join(',')}) as value`,
      keys.map(key => typeof args[key] === 'object' && args[key] !== null ? JSON.stringify(args[key]) : args[key]),
    );
    await db.exec('reset role; release savepoint rpc_call;');
    return rows[0].value;
  } catch (error) {
    await db.exec('rollback to savepoint rpc_call; release savepoint rpc_call;');
    throw error;
  }
}, async () => { broadcast.calls += 1; });

type Player = { room_id: string; player_id: string; code: string; token: string };
async function room(gameType = 'mafia') {
  const players: Player[] = [];
  for (let i = 0; i < 5; i++) {
    const token = (i + 1).toString(16).repeat(64);
    const hash = await hashToken(token);
    const recoveryHash = await hashToken(randomUUID());
    const { rows } = i === 0
      ? await db.query<{ value: Player }>('select public.room_create($1,$1,$2,$3) as value', ['방장님', hash, recoveryHash])
      : await db.query<{ value: Player }>('select public.room_join($1,$2,$2,$3,$4) as value', [players[0].code, `참가자${i}`, hash, recoveryHash]);
    players.push({ ...rows[0].value, token });
  }
  await db.query('update app_private.rooms set game_type=$1 where id=$2', [gameType, players[0].room_id]);
  return players;
}
async function round(players: Player[], phase = 'NIGHT') {
  const { rows } = await db.query<{ id: string }>(
    'insert into app_private.mafia_rounds(room_id,phase,night_no) values($1,$2,1) returning id', [players[0].room_id, phase],
  );
  for (const [i, role] of ['mafia', 'police', 'doctor', 'citizen'].entries()) {
    await db.query('insert into app_private.mafia_round_players(round_id,player_id,role,original_role) values($1,$2,$3,$3)', [rows[0].id, players[i].player_id, role]);
  }
  return rows[0].id;
}
async function version(player: Player) {
  return (await db.query<{ version: number }>('select version from app_private.rooms where id=$1', [player.room_id])).rows[0].version;
}
async function leave(player: Player, expectedVersion?: number) {
  return handler(new Request('https://test.invalid', {
    method: 'POST', headers: { Authorization: `Bearer ${player.token}` },
    body: JSON.stringify({ room_id: player.room_id, action: 'leave', expected_version: expectedVersion ?? await version(player), request_id: randomUUID() }),
  }));
}
async function status(player: Player) {
  return (await db.query<{ status: string }>('select status from app_private.players where id=$1', [player.player_id])).rows[0].status;
}
async function rejectsPatch(sql: string) {
  await db.exec('savepoint patch_attempt;');
  try { await expect(db.exec(patch)).rejects.toThrow(sql); }
  finally { await db.exec('rollback to savepoint patch_attempt; release savepoint patch_attempt;'); }
}

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const name of (await readdir('supabase/migrations')).filter(x => x.endsWith('.sql')).sort()) {
    if (name === migration) {
      original = (await db.query<{ definition: string }>("select pg_get_functiondef('app_private.room_command(text,uuid,text,jsonb,integer)'::regprocedure) as definition")).rows[0].definition;
    }
    await db.exec(await readFile(`supabase/migrations/${name}`, 'utf8'));
  }
  expect(original).toContain('CREATE OR REPLACE FUNCTION app_private.room_command(');
}, 30000);
beforeEach(async () => { await db.exec('begin;'); broadcast.calls = 0; });
afterEach(async () => { await db.exec('rollback;'); });
afterAll(async () => { await db.close(); });

it('reproduces the deployed bug: a required actor leaves but remains alive during NIGHT', async () => {
  await db.exec(original);
  const players = await room();
  const id = await round(players);
  expect((await leave(players[1])).status).toBe(200);
  expect(await status(players[1])).toBe('left');
  const { rows } = await db.query<{ eliminated_at: string | null }>('select eliminated_at from app_private.mafia_round_players where round_id=$1 and player_id=$2', [id, players[1].player_id]);
  expect(rows[0].eliminated_at).toBeNull();
});

it.each(['REVEAL_ROLE', 'INTRO', 'NIGHT', 'DAY_DISCUSS'])('rejects living participant leave in %s without mutating the room or broadcasting', async phase => {
  const players = await room();
  await round(players, phase);
  const before = await version(players[1]);
  const response = await leave(players[1]);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'ROUND_ACTIVE' });
  expect(await status(players[1])).toBe('active');
  expect(await version(players[1])).toBe(before);
  expect(broadcast.calls).toBe(0);
});

it('rejects repeated host leave requests without transferring ownership or changing version', async () => {
  const players = await room();
  await round(players);
  const before = await version(players[0]);
  for (let i = 0; i < 2; i++) expect((await leave(players[0], before)).status).toBe(409);
  const { rows } = await db.query('select host_player_id,version from app_private.rooms where id=$1', [players[0].room_id]);
  expect(rows[0]).toEqual({ host_player_id: players[0].player_id, version: before });
  expect(broadcast.calls).toBe(0);
});

it('allows a waiting spectator to leave during NIGHT', async () => {
  const players = await room();
  await round(players);
  await db.query("update app_private.players set status='waiting_next_round' where id=$1", [players[4].player_id]);
  expect((await leave(players[4])).status).toBe(200);
  expect(await status(players[4])).toBe('left');
});

it('allows an eliminated participant to leave', async () => {
  const players = await room();
  await round(players);
  await db.query('update app_private.mafia_round_players set eliminated_at=now() where player_id=$1', [players[1].player_id]);
  expect((await leave(players[1])).status).toBe(200);
});

it.each(['FINAL_RESULT', 'CANCELLED'])('allows leave when the round is %s', async phase => {
  const players = await room();
  await round(players, phase);
  expect((await leave(players[1])).status).toBe(200);
});

it('allows leave after a round ends and in a mafia lobby', async () => {
  const players = await room();
  expect((await leave(players[4])).status).toBe(200);
  const id = await round(players);
  await db.query('update app_private.mafia_rounds set ended_at=now() where id=$1', [id]);
  expect((await leave(players[1])).status).toBe(200);
  expect((await leave(players[2])).status).toBe(200);
});

it('preserves authentication and stale-version error precedence', async () => {
  const players = await room();
  await round(players);
  const forbidden = await leave({ ...players[1], token: 'f'.repeat(64) });
  expect(forbidden.status).toBe(403);
  expect(await forbidden.json()).toEqual({ error: 'FORBIDDEN' });
  const stale = await leave(players[1], (await version(players[1])) - 1);
  expect(stale.status).toBe(409);
  expect(await stale.json()).toEqual({ error: 'VERSION_CONFLICT' });
});

it('preserves liar lobby leave and active-round rejection', async () => {
  const players = await room('liar');
  expect((await leave(players[4])).status).toBe(200);
  await db.query("select public.game_command($1,$2,'start_round','{}'::jsonb,$3,'LOBBY',$4)", [await hashToken(players[0].token), players[0].room_id, await version(players[0]), randomUUID()]);
  const response = await leave(players[1]);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: 'ROUND_ACTIVE' });
});

it('keeps RPC permissions unchanged and denies anonymous roles', async () => {
  const acl = async () => (await db.query("select oid::regprocedure::text as name,proacl::text as acl,proowner::regrole::text as owner,prosecdef,proconfig from pg_proc where oid in ('public.room_command(text,uuid,text,jsonb,integer)'::regprocedure,'app_private.room_command(text,uuid,text,jsonb,integer)'::regprocedure) order by name")).rows;
  const before = await acl();
  await db.exec(patch);
  expect(await acl()).toEqual(before);
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`savepoint permissions; set role ${role};`);
    try { await expect(db.query("select public.room_command(repeat('f',64),gen_random_uuid(),'leave','{}',1)")).rejects.toThrow(/permission denied/); }
    finally { await db.exec('rollback to savepoint permissions; release savepoint permissions;'); }
  }
});

it('is safe to repeat without deleting player data', async () => {
  const players = await room();
  await round(players);
  await db.exec(patch);
  expect(await status(players[1])).toBe('active');
  expect((await leave(players[1])).status).toBe(409);
});

it('refuses a database missing the MAF-3 prerequisite', async () => {
  await db.exec('alter table app_private.mafia_night_actions rename to missing_mafia_night_actions;');
  await rejectsPatch('MAF-3 schema required');
});

it('refuses to overwrite an independently changed room command', async () => {
  await db.exec(original.replace('begin', 'begin\n -- independently changed implementation'));
  await rejectsPatch('room_command changed: review before applying');
});

it('accepts equivalent CRLF formatting without weakening the source drift check', async () => {
  await db.exec(original.replace(/\r?\n/g, '\r\n'));
  await db.exec(patch);
  const players = await room();
  await round(players);
  expect((await leave(players[1])).status).toBe(409);
});
