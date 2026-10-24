import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRoomHandler, joinRoomHandler, snapshotRoomHandler, commandHandler, type Rpc } from '../../supabase/functions/_shared/room';
import { gameCommandHandler } from '../../supabase/functions/_shared/game';
import type { Issued, RoomSnapshot } from '../../src/lib/api';

const db = new PGlite();
const rpc: Rpc = async (fn,args) => {
  const keys = Object.keys(args);
  await db.exec('set role service_role');
  try {
    const {rows} = await db.query<{value:unknown}>(`select public.${fn}(${keys.map((key,i)=>`${key} => $${i+1}`).join(',')}) as value`,
      keys.map(key => typeof args[key] === 'object' && args[key] !== null ? JSON.stringify(args[key]) : args[key]));
    return rows[0].value;
  } finally { await db.exec('reset role'); }
};
const events: unknown[] = [];
const broadcast = async (room:string,version:number) => { events.push({room_id:room,version}); };
const api = {create:createRoomHandler(rpc,broadcast),join:joinRoomHandler(rpc,broadcast),snapshot:snapshotRoomHandler(rpc),game:gameCommandHandler(rpc,broadcast),room:commandHandler(rpc,broadcast)};
const request = (body:object,token?:string) => new Request('https://test.invalid',{method:'POST',headers:{'x-forwarded-for':randomUUID(),...(token ? {Authorization:`Bearer ${token}`} : {})},body:JSON.stringify(body)});
const create = async () => await (await api.create(request({nickname:'방장님'}))).json() as Issued;
const join = async (s:Issued,nickname:string) => await (await api.join(request({room_code:s.code,nickname}))).json() as Issued;
const snapshot = async (s:Issued) => await (await api.snapshot(new Request(`https://test.invalid?room_id=${s.room_id}`,{headers:{Authorization:`Bearer ${s.token}`}}))).json() as RoomSnapshot;
const room = async (count=3) => { const host=await create(); const players=[host]; for(let i=1;i<count;i++) players.push(await join(host,`참가자${i}`)); return players; };
const game = async (s:Issued,action:string,payload:object={},overrides:object={}) => {
  const dto=await snapshot(s);
  return api.game(request({room_id:s.room_id,action,payload,expected_version:dto.room.version,expected_phase:dto.round?.phase ?? 'LOBBY',request_id:randomUUID(),...overrides},s.token));
};
beforeAll(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(async()=>{ await db.close(); });

describe('M2 assignment and secrecy',()=>{
  it.each([3,4,5,6,7,8,9,10,11,12])('assigns exactly one liar and freezes all %i participants',async count=>{
    const players=await room(count); const host=players[0];
    expect((await game(host,'start_round')).status).toBe(200);
    const dto=await snapshot(host); expect(dto.round?.participant_ids).toHaveLength(count);
    const {rows}=await db.query<{liars:number,total:number}>('select count(*) filter(where role=\'liar\')::int liars,count(*)::int total from app_private.round_players where round_id=$1',[dto.round!.id]);
    expect(rows[0]).toEqual({liars:1,total:count});
    let liars=0;
    for(const p of players){const d=await snapshot(p);if(d.round!.me!.role==='liar'){liars++;expect(d.round!.me!.word).toBeNull();}else expect(d.round!.me!.word?.length).toBeGreaterThan(1);}
    expect(liars).toBe(1);
  });
  it('host-as-liar fixture cannot read word; DTO never contains other roles, hashes or candidates',async()=>{
    const [host]=await room(); await game(host,'start_round'); const dto=await snapshot(host);
    await db.exec(`begin; update app_private.round_players set role='citizen' where round_id='${dto.round!.id}'; update app_private.round_players set role='liar' where round_id='${dto.round!.id}' and player_id='${host.player_id}'; commit;`);
    const d=await snapshot(host); expect(d.round!.me!.role).toBe('liar');expect(d.round!.me!.word).toBeNull();
    expect(JSON.stringify(d)).not.toMatch(/credential|recovery|candidate|"roles"/);
    for(const p of d.players) expect(Object.keys(p).sort()).toEqual(['connected','id','join_order','nickname','status','wins']);
  });
  it('rejects 1/2 players, non-host start, disconnected players and stale phase/version',async()=>{
    const solo=await room(1);expect((await game(solo[0],'start_round')).status).toBe(409);
    const duo=await room(2);expect((await game(duo[0],'start_round')).status).toBe(409);
    const [host,guest]=await room();expect((await game(guest,'start_round')).status).toBe(403);
    expect((await game(host,'start_round',{}, {expected_phase:'HINT'})).status).toBe(409);
    expect((await game(host,'start_round',{}, {expected_version:1})).status).toBe(409);
    await db.query("update app_private.players set last_seen_at=now()-interval '1 minute' where id=$1",[guest.player_id]);
    expect(await (await game(host,'start_round')).json()).toEqual({error:'PLAYERS_OFFLINE'});
  });
  it('replays the same request once; changed body conflicts; competing start cannot create a second round',async()=>{
    const [host]=await room();const before=await snapshot(host);const id=randomUUID();
    const overrides={request_id:id,expected_version:before.room.version,expected_phase:'LOBBY'};
    const first=await (await game(host,'start_round',{},overrides)).json();events.length=0;
    expect(await (await game(host,'start_round',{},overrides)).json()).toEqual(first);expect(events).toEqual([]);
    expect((await game(host,'cancel_round',{},overrides)).status).toBe(409);
    expect((await game(host,'start_round',{}, {...overrides,request_id:randomUUID()})).status).toBe(409);
    const {rows}=await db.query<{n:number}>('select count(*)::int n from app_private.rounds where room_id=$1 and ended_at is null',[host.room_id]);expect(rows[0].n).toBe(1);
  });
  it('late joiners have no role and cannot submit/ack; cancellation safely returns everyone to lobby',async()=>{
    const [host]=await room();await game(host,'start_round');const late=await join(host,'다음참가');const dto=await snapshot(late);
    expect(dto.players.find(p=>p.id===late.player_id)?.status).toBe('waiting_next_round');expect(dto.round!.me).toBeNull();
    expect((await game(late,'ack_role',{round_id:dto.round!.id})).status).toBe(403);
    expect((await game(late,'cancel_round')).status).toBe(403);
    expect((await game(host,'cancel_round')).status).toBe(200);
    expect((await snapshot(late)).round).toBeNull();expect((await snapshot(late)).players.every(p=>p.status==='active')).toBe(true);
    expect((await game(host,'start_round')).status).toBe(200);expect((await snapshot(late)).round!.me).not.toBeNull();
  });
});
describe('M2 custom words and transitions',()=>{
  it('collects everyone once, hides all roles before reveal, excludes liar candidate and transitions on final ack',async()=>{
    const players=await room();const host=players[0];let dto=await snapshot(host);
    expect((await api.room(request({room_id:host.room_id,action:'update_settings',payload:{word_mode:'custom'},expected_version:dto.room.version,request_id:randomUUID()},host.token))).status).toBe(200);
    await game(host,'start_round');dto=await snapshot(host);const rid=dto.round!.id;
    const {rows}=await db.query<{player_id:string}>('select player_id from app_private.round_players where round_id=$1 and role=\'liar\'',[rid]);const liar=rows[0].player_id;
    for(const p of players){const d=await snapshot(p);expect(d.round!.me!.role).toBeNull();expect(d.round!.me!.word).toBeNull();}
    expect((await game(host,'submit_word',{round_id:rid,word:'\u200b사과'})).status).toBe(400);
    for(let i=0;i<players.length;i++){
      const p=players[i];expect((await game(p,'submit_word',{round_id:rid,word:p.player_id===liar?'절대금지':'시민단어'})).status).toBe(200);
      if(i===0) expect((await game(p,'submit_word',{round_id:rid,word:'재제출'})).status).toBe(409);
    }
    expect((await snapshot(host)).round!.phase).toBe('REVEAL_ROLE');
    for(const p of players){ const d=await snapshot(p);expect(d.round!.me!.word).toBe(p.player_id===liar ? null : '시민단어'); }
    for(const p of players)expect((await game(p,'ack_role',{round_id:rid})).status).toBe(200);
    expect((await snapshot(host)).round!.phase).toBe('HINT');
    expect((await game(host,'ack_role',{round_id:rid})).status).toBe(409);
    expect(events.every(e=>Object.keys(e as object).sort().join(',')==='room_id,version')).toBe(true);
  });
  it('blocks all private tables and game RPC for anon/authenticated and enforces liar assignment at commit',async()=>{
    for(const role of ['anon','authenticated']){
      await db.exec(`set role ${role}`);
      try{for(const table of ['rounds','round_players','round_secrets','word_candidates','command_receipts','builtin_words'])await expect(db.query(`select * from app_private.${table}`)).rejects.toThrow(/permission denied/);
        await expect(db.query("select public.game_command(repeat('a',64),gen_random_uuid(),'start_round','{}',1,'LOBBY',gen_random_uuid())")).rejects.toThrow(/permission denied/);
      }finally{await db.exec('reset role');}
    }
    const [host]=await room();await game(host,'start_round');const rid=(await snapshot(host)).round!.id;
    await expect(db.query('update app_private.round_players set role=\'citizen\' where round_id=$1',[rid])).rejects.toThrow(/INVALID_ASSIGNMENT/);
    const {rows}=await db.query<{n:number}>('select count(*)::int n from app_private.builtin_words');expect(rows[0].n).toBe(75);
  });
  it('rollback SQL removes only M2 and restores the M1 service-role API',async()=>{
    const restored=new PGlite();
    try {
      await restored.exec('create role anon; create role authenticated; create role service_role;');
      for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await restored.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
      await restored.exec(await readFile('supabase/rollback/m2.sql','utf8'));
      await restored.exec('set role service_role');
      const {rows}=await restored.query<{value:{room_id:string}}>("select public.room_create('복구방장','복구방장',repeat('a',64),repeat('b',64)) as value");
      const result=await restored.query<{value:{players:unknown[]}}>("select public.room_snapshot(repeat('a',64),$1) as value",[rows[0].value.room_id]);
      expect(result.rows[0].value.players).toHaveLength(1);
    } finally {await restored.close();}
  },15000);
});
