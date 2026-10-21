import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { hashToken, newToken, publicVersionEvent } from '../../supabase/functions/_shared/security.ts';

// Read local CLI credentials into memory only. Never write/print status JSON.
const output = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
  env: { ...process.env, SUPABASE_HOME: process.env.SUPABASE_HOME ?? `${process.cwd()}/.cache/supabase` },
  stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8',
});
const config = JSON.parse(output);
const base = config.API_URL;
const anon = config.ANON_KEY;
assert.ok(base && anon, 'Local CLI must return API_URL and ANON_KEY');
assert.match(base, /^http:\/\/(127\.0\.0\.1|localhost):54321$/); // cannot target production
const room = randomUUID();
const citizen = { id: randomUUID(), token: newToken() };
const liar = { id: randomUUID(), token: newToken() };
const sql = command => execFileSync('docker', ['exec', '-i', 'supabase_db_party-game', 'psql', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input: command, stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf8' });
const call = (token, id = room, suffix = '') => fetch(`${base}/functions/v1/m0-snapshot?room_id=${id}${suffix}`, { headers: { apikey: anon, ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
before(async () => {
  sql(`insert into m0_private.sessions(player_id, room_id, credential_hash, role, word) values ('${citizen.id}','${room}','${await hashToken(citizen.token)}','citizen','사과'),('${liar.id}','${room}','${await hashToken(liar.token)}','liar','사과');`);
});
after(() => { sql(`delete from m0_private.sessions where room_id='${room}';`); });

test('Edge → RPC → DB: only credential owner snapshot, no liar word', async () => {
  const response = await call(citizen.token, room, `&player_id=${liar.id}`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { room_id: room, player_id: citizen.id, role: 'citizen', word: '사과', version: 1 });
  const hidden = await call(liar.token);
  assert.equal(hidden.status, 200);
  assert.deepEqual(await hidden.json(), { room_id: room, player_id: liar.id, role: 'liar', word: null, version: 1 });
});
test('Edge rejects missing, random and cross-room credentials', async () => {
  assert.equal((await call(null)).status, 401);
  assert.equal((await call(newToken())).status, 403);
  assert.equal((await call(citizen.token, randomUUID())).status, 403);
});
test('public API cannot invoke privileged RPC or read secret schema', async () => {
  const client = createClient(base, anon, { auth: { persistSession: false } });
  const { error } = await client.rpc('m0_snapshot', { p_hash: await hashToken(citizen.token), p_room: room });
  assert.ok(error, 'anon RPC must fail');
  const response = await fetch(`${base}/rest/v1/sessions?select=*`, { headers: { apikey: anon, 'Accept-Profile': 'm0_private' } });
  assert.equal(response.status, 406);
});
test('credential replacement rejects old credential', async () => {
  const next = newToken();
  sql(`update m0_private.sessions set credential_hash='${await hashToken(next)}' where player_id='${citizen.id}';`);
  assert.equal((await call(citizen.token)).status, 403);
  assert.equal((await call(next)).status, 200);
  citizen.token = next;
});
test('real Realtime Broadcast carries only public room/version payload', { timeout: 20000 }, async () => {
  const receiver = createClient(base, anon, { auth: { persistSession: false } });
  const sender = createClient(base, anon, { auth: { persistSession: false } });
  const topic = `m0:${room}`;
  let resolveEvent;
  const event = new Promise(resolve => { resolveEvent = resolve; });
  const channel = receiver.channel(topic).on('broadcast', { event: 'version' }, ({ payload }) => resolveEvent(payload));
  const sending = sender.channel(topic, { config: { broadcast: { ack: true } } });
  const subscribe = channel => new Promise((resolve, reject) => channel.subscribe((state) => {
    if (state === 'SUBSCRIBED') resolve();
    if (['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(state)) reject(new Error(`Realtime ${state}`));
  }));
  let timeout;
  try {
    await Promise.all([subscribe(channel), subscribe(sending)]);
    const payload = publicVersionEvent(room, 2);
    assert.equal(await sending.send({ type: 'broadcast', event: 'version', payload }), 'ok');
    const received = await Promise.race([event, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('No broadcast received')), 10000); })]);
    assert.deepEqual(received, payload);
    assert.deepEqual(Object.keys(received).sort(), ['room_id','version']);
  } finally {
    clearTimeout(timeout);
    await Promise.all([receiver.removeAllChannels(), sender.removeAllChannels()]);
  }
});
