// Development-only acceptance. Credentials stay in memory; the ledger contains room IDs only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import console from 'node:console';
/* global AbortSignal */

const base = 'https://wmgpshtqqsqwgyigxcwl.supabase.co/functions/v1/';
const ledgerPath = '.cache/mafia-leave-remote-rooms.json';
const rooms = [];
const ledger = [];
let checks = 0;
const check = (actual, expected) => { assert.deepEqual(actual, expected); checks++; };
const call = async (path, body, token, query = '') => {
  const response = await fetch(base + path + query, {
    method: body ? 'POST' : 'GET',
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
  });
  return { status: response.status, data: await response.json() };
};
const snapshot = async session => {
  const response = await call('room-snapshot', null, session.token, `?room_id=${session.room_id}`);
  check(response.status, 200);
  return response.data;
};
const commandBody = (session, action, version, payload = {}) => ({ room_id: session.room_id, action, payload, expected_version: version, request_id: randomUUID() });
const command = async (session, action, payload = {}) => call('room-command', commandBody(session, action, (await snapshot(session)).room.version, payload), session.token);
async function create(gameType) {
  const response = await call('room-create', { nickname: '퇴장검증방장', game_type: gameType });
  check(response.status, 200);
  rooms.push(response.data);
  ledger.push({ room_id: response.data.room_id, closed: false });
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
  return response.data;
}
async function join(host, nickname) {
  const response = await call('room-join', { room_code: host.code, nickname });
  check(response.status, 200);
  return response.data;
}
async function rejection(response, allowed = ['ROUND_ACTIVE']) {
  check(response.status, 409);
  assert.ok(allowed.includes(response.data.error)); checks++;
}

await mkdir('.cache', { recursive: true });
let previous = [];
try { previous = JSON.parse(await readFile(ledgerPath, 'utf8')); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.ok(previous.every(entry => entry.closed), 'Previous test rooms require cleanup before another run');

try {
  const host = await create('mafia');
  const players = [host];
  for (let i = 1; i < 4; i++) players.push(await join(host, `퇴장검증${i}`));
  check((await command(host, 'mafia_start')).status, 200);
  const roles = new Map();
  for (const player of players) roles.set(player.player_id, (await snapshot(player)).mafia.me.role);
  const mafia = players.find(player => roles.get(player.player_id) === 'mafia');
  const police = players.find(player => roles.get(player.player_id) === 'police');
  const victim = players.find(player => roles.get(player.player_id) === 'citizen' && player.player_id !== host.player_id);
  assert.ok(mafia && police && victim); checks++;
  await rejection(await command(police, 'leave'));
  for (const player of players) check((await command(player, 'mafia_ack')).status, 200);
  await rejection(await command(police, 'leave'));
  check((await command(host, 'mafia_intro_done')).status, 200);
  const before = await snapshot(police);
  check(before.mafia.phase, 'NIGHT');

  const duplicate = commandBody(police, 'leave', before.room.version);
  const repeated = await Promise.all([call('room-command', duplicate, police.token), call('room-command', duplicate, police.token)]);
  for (const response of repeated) await rejection(response);
  const unchanged = await snapshot(police);
  check(unchanged.room.version, before.room.version);
  check(unchanged.players.find(player => player.id === police.player_id).status, 'active');

  // Both HTTP requests use one observed version. The room lock must preserve the actor whichever wins.
  const raceVersion = unchanged.room.version;
  const raced = await Promise.all([
    call('room-command', commandBody(police, 'leave', raceVersion), police.token),
    call('room-command', commandBody(police, 'mafia_night_action', raceVersion, { target_id: mafia.player_id }), police.token),
  ]);
  await rejection(raced[0], ['ROUND_ACTIVE', 'VERSION_CONFLICT']);
  check(raced[1].status, 200);
  const afterRace = await snapshot(police);
  check(afterRace.mafia.phase, 'NIGHT');
  check(afterRace.mafia.me.night_submitted, true);
  check(afterRace.players.find(player => player.id === police.player_id).status, 'active');

  check((await command(host, 'lock', { locked: false })).status, 200);
  const spectator = await join(host, '퇴장관전자');
  check((await snapshot(spectator)).mafia.me, null);
  check((await command(spectator, 'leave')).status, 200);

  check((await command(mafia, 'mafia_night_action', { target_id: victim.player_id })).status, 200);
  const morning = await snapshot(host);
  check(morning.mafia.phase, 'DAY_DISCUSS');
  check(morning.mafia.night_result.eliminated_player_id, victim.player_id);
  check((await command(victim, 'leave')).status, 200);
  await rejection(await command(police, 'leave'));

  const liar = await create('liar');
  const liarGuests = [await join(liar, '라이어검증일'), await join(liar, '라이어검증이')];
  const lobby = await snapshot(liar);
  check((await call('game-command', {
    room_id: liar.room_id, action: 'start_round', payload: {}, expected_version: lobby.room.version,
    expected_phase: 'LOBBY', request_id: randomUUID(),
  }, liar.token)).status, 200);
  await rejection(await command(liarGuests[0], 'leave'));
  check((await snapshot(liar)).round.phase, 'REVEAL_ROLE');
  console.log(`Mafia leave remote acceptance: ${checks} checks passed (includes simultaneous HTTP requests)`);
} finally {
  for (const [i, host] of rooms.entries()) {
    try {
      const closed = await command(host, 'close_room');
      ledger[i].closed = closed.status === 200;
    } catch { /* Keep an unresolved room ID in the ledger; never persist its credentials. */ }
  }
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2));
  assert.ok(ledger.every(entry => entry.closed), 'Test room cleanup failed; inspect the ID-only ledger');
}
