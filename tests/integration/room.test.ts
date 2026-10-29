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
const createMafia = async () => (await (await api.create(post({nickname:'마피아방장',game_type:'mafia'}))).json()) as Session;
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
        await expect(db.query('select * from app_private.mafia_round_players')).rejects.toThrow(/permission denied/);
        await expect(db.query('select * from app_private.mafia_night_actions')).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_create('닉네임', '닉네임', repeat('a',64), repeat('b',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_join('000000', '닉네임', '닉네임', repeat('a',64), repeat('b',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.player_recover('000000', repeat('a',64), repeat('b',64), repeat('c',64))")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_snapshot(repeat('a',64), gen_random_uuid())")).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.room_command(repeat('a',64), gen_random_uuid(), 'leave', '{}', 1)")).rejects.toThrow(/permission denied/);
      } finally { await db.exec('reset role'); }
    }
    const { rows } = await db.query<{ n: number }>("select count(*)::int n from pg_class where relnamespace='app_private'::regnamespace and relkind='r' and relrowsecurity");
    expect(rows[0].n).toBe(18);
  });
});

describe('create / join / capacity', () => {
  it('completes a secret first night without revealing citizen professions',async()=>{
    const host=await createMafia();const participants=[host];
    for(let n=1;n<=3;n++)participants.push((await (await join(host.code,`밤검증${n}`)).json()) as Session);
    expect((await command(host,host.room_id,'mafia_start',await version(host))).status).toBe(200);
    const roles=new Map<string,string>();
    for(const p of participants){const d=(await (await snapshot(p,host.room_id)).json()) as {mafia:{me:{role:string}}};roles.set(p.player_id,d.mafia.me.role);}
    for(const p of participants)expect((await command(p,host.room_id,'mafia_ack',await version(host))).status).toBe(200);
    expect((await command(participants[1],host.room_id,'mafia_intro_done',await version(host))).status).toBe(403);
    expect((await command(host,host.room_id,'mafia_intro_done',await version(host))).status).toBe(200);
    const mafia=participants.find(p=>roles.get(p.player_id)==='mafia')!;
    const police=participants.find(p=>roles.get(p.player_id)==='police')!;
    const citizen=participants.find(p=>roles.get(p.player_id)==='citizen')!;
    expect((await command(citizen,host.room_id,'mafia_night_action',await version(host),{target_id:mafia.player_id})).status).toBe(403);
    expect((await command(mafia,host.room_id,'mafia_night_action',await version(host),{target_id:citizen.player_id})).status).toBe(200);
    expect((await command(mafia,host.room_id,'mafia_night_action',await version(host),{target_id:police.player_id})).status).toBe(409);
    expect((await command(police,host.room_id,'mafia_night_action',await version(host),{target_id:mafia.player_id})).status).toBe(200);
    const d=(await (await snapshot(citizen,host.room_id)).json()) as {mafia:{phase:string;night_result:{eliminated_player_id:string;eliminated_team:string};me:{investigation:unknown}}};
    expect(d.mafia.phase).toBe('DAY_DISCUSS');expect(d.mafia.night_result).toMatchObject({eliminated_player_id:citizen.player_id,eliminated_team:'citizen'});
    expect(d.mafia.me.investigation).toBeNull();
    const pd=(await (await snapshot(police,host.room_id)).json()) as {mafia:{me:{investigation:{target_id:string;result:string}}}};
    expect(pd.mafia.me.investigation).toEqual({target_id:mafia.player_id,result:'mafia'});
  });
  it('lets only the spy identify mafias and converts a living traitor when the mission target dies',async()=>{
    const host=await createMafia();const participants=[host];
    for(let n=1;n<=4;n++)participants.push((await (await join(host.code,`전향검증${n}`)).json()) as Session);
    const initial=(await (await snapshot(host,host.room_id)).json()) as {room:{settings:{mafia_roles:Record<string,number>}}};
    const roles={...initial.room.settings.mafia_roles,mafia:1,spy:1,traitor:1,citizen:2,police:0};
    expect((await command(host,host.room_id,'update_settings',await version(host),{mafia_roles:roles})).status).toBe(200);
    expect((await command(host,host.room_id,'mafia_start',await version(host))).status).toBe(200);
    const assigned=new Map<string,{role:string;teammate_ids:string[];mission_target_id:string|null}>();
    for(const p of participants){const d=(await (await snapshot(p,host.room_id)).json()) as {mafia:{me:{role:string;teammate_ids:string[];mission_target_id:string|null}}};assigned.set(p.player_id,d.mafia.me);}
    const mafia=participants.find(p=>assigned.get(p.player_id)?.role==='mafia')!;
    const spy=participants.find(p=>assigned.get(p.player_id)?.role==='spy')!;
    const traitor=participants.find(p=>assigned.get(p.player_id)?.role==='traitor')!;
    expect(assigned.get(spy.player_id)!.teammate_ids).toEqual([mafia.player_id]);
    expect(assigned.get(mafia.player_id)!.teammate_ids).not.toContain(spy.player_id);
    const target=assigned.get(traitor.player_id)!.mission_target_id!;
    expect(target).toBeTruthy();expect(assigned.get(target)?.role).toBe('citizen');
    for(const p of participants)expect((await command(p,host.room_id,'mafia_ack',await version(host))).status).toBe(200);
    expect((await command(host,host.room_id,'mafia_intro_done',await version(host))).status).toBe(200);
    expect((await command(spy,host.room_id,'mafia_night_action',await version(host),{target_id:mafia.player_id})).status).toBe(200);
    expect((await command(mafia,host.room_id,'mafia_night_action',await version(host),{target_id:target})).status).toBe(200);
    const result=(await (await snapshot(traitor,host.room_id)).json()) as {mafia:{phase:string;winner:string;night_result:{eliminated_team:string};me:{role:string;original_role:string}}};
    expect(result.mafia.phase).toBe('FINAL_RESULT');expect(result.mafia.winner).toBe('mafia');
    expect(result.mafia.night_result.eliminated_team).toBe('citizen');
    expect(result.mafia.me).toMatchObject({role:'mafia',original_role:'traitor'});
    const spyResult=(await (await snapshot(spy,host.room_id)).json()) as {mafia:{me:{investigation:{result:string}}}};
    expect(spyResult.mafia.me.investigation.result).toBe('mafia');
  });
  it('protects a target and publishes only the journalist-selected profession',async()=>{
    const host=await createMafia();const participants=[host];
    for(let n=1;n<=5;n++)participants.push((await (await join(host.code,`보호검증${n}`)).json()) as Session);
    const initial=(await (await snapshot(host,host.room_id)).json()) as {room:{settings:{mafia_roles:Record<string,number>}}};
    const roles={...initial.room.settings.mafia_roles,mafia:1,citizen:3,police:0,doctor:1,journalist:1};
    expect((await command(host,host.room_id,'update_settings',await version(host),{mafia_roles:roles})).status).toBe(200);
    expect((await command(host,host.room_id,'mafia_start',await version(host))).status).toBe(200);
    const assigned=new Map<string,string>();
    for(const p of participants){const d=(await (await snapshot(p,host.room_id)).json()) as {mafia:{me:{role:string}}};assigned.set(p.player_id,d.mafia.me.role);}
    const mafia=participants.find(p=>assigned.get(p.player_id)==='mafia')!;
    const doctor=participants.find(p=>assigned.get(p.player_id)==='doctor')!;
    const journalist=participants.find(p=>assigned.get(p.player_id)==='journalist')!;
    const target=participants.find(p=>assigned.get(p.player_id)==='citizen')!;
    for(const p of participants)expect((await command(p,host.room_id,'mafia_ack',await version(host))).status).toBe(200);
    expect((await command(host,host.room_id,'mafia_intro_done',await version(host))).status).toBe(200);
    for(const [actor,id] of [[mafia,target.player_id],[doctor,target.player_id],[journalist,mafia.player_id]] as const)
      expect((await command(actor,host.room_id,'mafia_night_action',await version(host),{target_id:id})).status).toBe(200);
    const d=(await (await snapshot(target,host.room_id)).json()) as {mafia:{phase:string;night_result:{eliminated_player_id:string|null;journalist:{player_id:string;role:string}}}};
    expect(d.mafia.phase).toBe('DAY_DISCUSS');expect(d.mafia.night_result.eliminated_player_id).toBeNull();
    expect(d.mafia.night_result.journalist).toEqual({player_id:mafia.player_id,role:'mafia'});
  });
  it('assigns mafia roles privately, rejects competing starts and advances after all acknowledgements',async()=>{
    const host=await createMafia();
    const others=[] as Session[];
    for(let n=1;n<=3;n++) others.push((await (await join(host.code,`비밀참가${n}`)).json()) as Session);
    const people=[host,...others];
    expect((await command(others[0],host.room_id,'mafia_start',await version(host))).status).toBe(403);
    const before=await version(host);
    expect((await command(host,host.room_id,'mafia_start',before)).status).toBe(200);
    expect((await command(host,host.room_id,'mafia_start',before)).status).toBe(409);
    const own=[] as string[];
    for(const p of people){
      const dto=(await (await snapshot(p,host.room_id)).json()) as {mafia:{phase:string;me:{role:string;acknowledged:boolean;teammate_ids:string[]};participant_ids:string[]}};
      expect(dto.mafia.phase).toBe('REVEAL_ROLE');
      expect(dto.mafia.me.acknowledged).toBe(false);
      expect(dto.mafia.me.teammate_ids).toEqual([]);
      expect(dto.mafia.participant_ids).toHaveLength(4);
      own.push(dto.mafia.me.role);
      expect(JSON.stringify(dto.mafia)).not.toContain('credential_hash');
    }
    expect(own.sort()).toEqual(['citizen','citizen','mafia','police']);
    expect((await command(host,host.room_id,'update_settings',await version(host),{mafia_roles:{mafia:1}})).status).toBe(409);
    for(const p of people)expect((await command(p,host.room_id,'mafia_ack',await version(host))).status).toBe(200);
    const done=(await (await snapshot(host,host.room_id)).json()) as {mafia:{phase:string;acknowledged_count:number}};
    expect(done.mafia.phase).toBe('INTRO');expect(done.mafia.acknowledged_count).toBe(4);
    expect((await command(host,host.room_id,'mafia_ack',await version(host))).status).toBe(409);
  });
  it('reveals teammates only to mafias, never to citizens or host by privilege',async()=>{
    const host=await createMafia();const players=[host];
    for(let n=1;n<=4;n++)players.push((await (await join(host.code,`팀검증${n}`)).json()) as Session);
    const initial=(await (await snapshot(host,host.room_id)).json()) as {room:{settings:{mafia_roles:Record<string,number>}}};
    const roles={...initial.room.settings.mafia_roles,mafia:2,citizen:3,police:0};
    expect((await command(host,host.room_id,'update_settings',await version(host),{mafia_roles:roles})).status).toBe(200);
    expect((await command(host,host.room_id,'mafia_start',await version(host))).status).toBe(200);
    const assigned=[] as Array<{player_id:string;role:string;teammate_ids:string[]}>;
    for(const p of players){
      const dto=(await (await snapshot(p,host.room_id)).json()) as {mafia:{me:{role:string;teammate_ids:string[]}}};
      assigned.push({player_id:p.player_id,...dto.mafia.me});
    }
    const mafias=assigned.filter(p=>p.role==='mafia');expect(mafias).toHaveLength(2);
    for(const p of assigned){
      expect(p.teammate_ids).toEqual(p.role==='mafia'?[mafias.find(x=>x.player_id!==p.player_id)!.player_id]:[]);
    }
  });
  it('isolates mafia lobbies and enforces host-only role configurations', async () => {
    const host=await createMafia();
    const guest=(await (await join(host.code,'참가자')).json()) as Session;
    const state=await (await snapshot(host,host.room_id)).json() as {room:{game_type:string;settings:{mafia_roles:Record<string,number>}}};
    expect(state.room.game_type).toBe('mafia');
    const roles={...state.room.settings.mafia_roles,citizen:3};
    const v=await version(host);
    expect((await command(guest,host.room_id,'update_settings',v,{mafia_roles:roles})).status).toBe(403);
    expect((await command(host,host.room_id,'update_settings',v,{mafia_roles:{...roles,mafia:0}})).status).toBe(400);
    expect((await command(host,host.room_id,'update_settings',v,{mafia_roles:{...roles,spy:2}})).status).toBe(400);
    expect((await command(host,host.room_id,'update_settings',v,{mafia_roles:roles,word_mode:'custom'})).status).toBe(400);
    expect((await command(host,host.room_id,'update_settings',v,{mafia_roles:roles})).status).toBe(200);
    expect((await command(host,host.room_id,'update_settings',v,{mafia_roles:roles})).status).toBe(409);
    expect(((await (await snapshot(guest,host.room_id)).json()) as typeof state).room.settings.mafia_roles).toEqual(roles);
    await expect(db.query("select public.game_command(repeat('f',64),$1,'start_round','{}',1,'LOBBY',gen_random_uuid())",[host.room_id])).rejects.toThrow(/FORBIDDEN/);
    const liar=await create('라이어방장');
    expect(((await (await snapshot(liar,liar.room_id)).json()) as typeof state).room.game_type).toBe('liar');
  });
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
  it('rejects the 16th player, duplicate nicknames (case-insensitive) and unknown codes', async () => {
    const host = await create('Host');
    for (let i = 2; i <= 15; i++) expect((await join(host.code, `참가자${i}`)).status).toBe(200);
    expect(await (await join(host.code, '열여섯번째')).json()).toEqual({ error: 'ROOM_FULL' });
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
    expect(dto.room.settings).toEqual({ hint_rounds: 2, word_mode: 'custom', discussion_seconds: 0,theme:'random',custom_theme:'',game_mode:'classic',difficulty:'easy',liar_count:1 });
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
