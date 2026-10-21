import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { hashToken, newToken, snapshotHandler } from '../../supabase/functions/_shared/security';
const db = new PGlite();
const room = '00000000-0000-4000-8000-000000000001';
const citizen = newToken();
const liar = newToken();
beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  await db.exec(await readFile('supabase/migrations/20261021000000_m0_security_poc.sql', 'utf8'));
  await db.query("insert into m0_private.sessions(player_id,room_id,credential_hash,role,word) values ('00000000-0000-4000-8000-000000000011',$1,$2,'citizen','사과'),('00000000-0000-4000-8000-000000000012',$1,$3,'liar','사과')", [room, await hashToken(citizen), await hashToken(liar)]);
}, 20000);
afterAll(async () => { await db.close(); });
it('enforces anon/authenticated schema, table and RPC permissions in PostgreSQL', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    try {
      await expect(db.query('select * from m0_private.sessions')).rejects.toThrow(/permission denied/);
      await expect(db.query('select public.m0_snapshot($1,$2)', [await hashToken(citizen),room])).rejects.toThrow(/permission denied/);
    } finally { await db.exec('reset role'); }
  }
  const { rows } = await db.query<{ relrowsecurity: boolean }>("select relrowsecurity from pg_class where oid='m0_private.sessions'::regclass");
  expect(rows[0].relrowsecurity).toBe(true);
});
it('real handler + restricted RPC returns only owner and hides liar word', async () => {
  await db.exec('set role service_role');
  try {
    const handler = snapshotHandler(async (hash, id) => {
      const { rows } = await db.query<{ snapshot: { room_id: string; player_id: string; role: 'citizen' | 'liar'; word: string | null; version: number } | null }>('select public.m0_snapshot($1,$2) as snapshot', [hash,id]);
      return rows[0].snapshot;
    });
    const call = (token: string, id = room) => handler(new Request(`https://test.example?room_id=${id}&player_id=someone-else`, { headers: { Authorization: `Bearer ${token}` } }));
    const own = await call(citizen);
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ room_id: room, player_id: '00000000-0000-4000-8000-000000000011', role: 'citizen', word: '사과', version: 1 });
    expect((await (await call(liar)).json()).word).toBe(null);
    expect((await call(citizen,'00000000-0000-4000-8000-000000000002')).status).toBe(403);
    expect((await call(newToken())).status).toBe(403);
  } finally { await db.exec('reset role'); }
});
it('credential rotation/revocation immediately denies previous credentials', async () => {
  const replacement = newToken();
  await db.query('update m0_private.sessions set credential_hash=$1 where credential_hash=$2', [await hashToken(replacement),await hashToken(citizen)]);
  const get = async (token: string) => (await db.query<{ result: unknown }>('select public.m0_snapshot($1,$2) as result', [await hashToken(token),room])).rows[0].result;
  expect(await get(citizen)).toBeNull();
  expect(await get(replacement)).not.toBeNull();
  await db.query('update m0_private.sessions set active=false where credential_hash=$1',[await hashToken(replacement)]);
  expect(await get(replacement)).toBeNull();
});
