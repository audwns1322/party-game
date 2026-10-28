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
const api = {create:createRoomHandler(rpc,broadcast),join:joinRoomHandler(rpc,broadcast),snapshot:snapshotRoomHandler(rpc,broadcast),game:gameCommandHandler(rpc,broadcast),room:commandHandler(rpc,broadcast)};
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
    expect((await api.room(request({room_id:host.room_id,action:'update_settings',payload:{word_mode:'custom',custom_theme:'음식'},expected_version:dto.room.version,request_id:randomUUID()},host.token))).status).toBe(200);
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
    const {rows}=await db.query<{n:number}>('select count(*)::int n from app_private.builtin_words');expect(rows[0].n).toBe(270);
  });
  it('rollback SQL removes only M2 and restores the M1 service-role API',async()=>{
    const restored=new PGlite();
    try {
      await restored.exec('create role anon; create role authenticated; create role service_role;');
      for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())await restored.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
      await restored.exec(await readFile('supabase/rollback/themes_word_modes.sql','utf8'));
      await restored.exec(await readFile('supabase/rollback/m3.sql','utf8'));
      await restored.exec(await readFile('supabase/rollback/m2.sql','utf8'));
      await restored.exec('set role service_role');
      const {rows}=await restored.query<{value:{room_id:string}}>("select public.room_create('복구방장','복구방장',repeat('a',64),repeat('b',64)) as value");
      const result=await restored.query<{value:{players:unknown[]}}>("select public.room_snapshot(repeat('a',64),$1) as value",[rows[0].value.room_id]);
      expect(result.rows[0].value.players).toHaveLength(1);
    } finally {await restored.close();}
  },15000);
  it('rejects an active round without its frozen participant assignment',async()=>{
    const host=await create();
    await expect(db.query("insert into app_private.rounds(room_id,phase,config) values($1,'REVEAL_ROLE','{}')",[host.room_id])).rejects.toThrow(/INVALID_ASSIGNMENT/);
  });
  it('validates the source round when a participant row is moved to an ended round',async()=>{
    const [host]=await room();await game(host,'start_round');const first=(await snapshot(host)).round!.id;
    await game(host,'cancel_round');await game(host,'start_round');const second=(await snapshot(host)).round!.id;
    const {rows}=await db.query<{player_id:string;turn_order:number}>("select b.player_id,a.turn_order from app_private.round_players b join app_private.round_players a on a.player_id=b.player_id where b.round_id=$1 and a.round_id=$2 and b.role='citizen' limit 1",[second,first]);
    const player=rows[0];
    await db.query('delete from app_private.round_players where round_id=$1 and player_id=$2',[first,player.player_id]);
    await expect(db.query('update app_private.round_players set round_id=$1,turn_order=$2 where round_id=$3 and player_id=$4',[first,player.turn_order,second,player.player_id])).rejects.toThrow(/INVALID_ASSIGNMENT/);
  });
});

async function hints(laps=1,seconds=60,count=3) {
  const players=await room(count); const host=players[0]; const dto=await snapshot(host);
  expect((await api.room(request({room_id:host.room_id,action:'update_settings',payload:{hint_rounds:laps,discussion_seconds:seconds},expected_version:dto.room.version,request_id:randomUUID()},host.token))).status).toBe(200);
  expect((await game(host,'start_round')).status).toBe(200);
  const rid=(await snapshot(host)).round!.id;
  for(const p of players) expect((await game(p,'ack_role',{round_id:rid})).status).toBe(200);
  return players;
}
async function finishAll(players:Issued[]) {
  for(let i=0;i<=36;i++) {
    const r=(await snapshot(players[0])).round!; if(r.phase!=='HINT') return;
    const p=players.find(p=>p.player_id===r.current_player_id)!;
    expect((await game(p,'finish_hint',{round_id:r.id,hint_index:r.hint_index})).status).toBe(200);
  }
  throw new Error('Hint cursor did not finish');
}
describe('M3 server progression',()=>{
  it('finishes the maximum 12-player three-lap round at exactly 36 hints',async()=>{
    const players=await hints(3,60,12);await finishAll(players);
    const dto=await snapshot(players[0]);expect(dto.round!.hint_index).toBe(36);expect(dto.round!.phase).toBe('DISCUSS');expect(dto.round!.deadline_at).not.toBeNull();
  });
  it('only the host can explicitly skip a timed discussion, with idempotent retry',async()=>{
    const players=await hints();await finishAll(players);const host=players[0];const dto=await snapshot(host);const rid=dto.round!.id;
    expect((await game(players[1],'start_vote',{round_id:rid,skip_timer:true})).status).toBe(403);
    expect((await game(host,'start_vote',{round_id:rid,skip_timer:'true'})).status).toBe(409);
    const overrides={expected_version:dto.room.version,expected_phase:'DISCUSS',request_id:randomUUID()};
    const payload={round_id:rid,skip_timer:true};
    const first=await game(host,'start_vote',payload,overrides);expect(first.status).toBe(200);
    const result=await first.json();events.length=0;
    expect(await (await game(host,'start_vote',payload,overrides)).json()).toEqual(result);expect(events).toHaveLength(0);
    const after=await snapshot(host);expect(after.round!.phase).toBe('VOTE_1');expect(after.round!.deadline_at).toBeNull();expect(after.room.version).toBe(dto.room.version+1);
    expect((await game(host,'start_vote',payload)).status).toBe(409);
  });
  it.each([1,2,3])('completes exactly %i laps in frozen speaking order',async laps=>{
    const players=await hints(laps);const first=(await snapshot(players[0])).round!;
    for(let i=0;i<3*laps;i++) {
      const r=(await snapshot(players[0])).round!;
      expect(r.current_player_id).toBe(first.participant_ids[i%3]);expect(r.hint_round).toBe(Math.floor(i/3)+1);
      expect((await game(players.find(p=>p.player_id===r.current_player_id)!,'finish_hint',{round_id:r.id,hint_index:i})).status).toBe(200);
    }
    const r=(await snapshot(players[0])).round!;expect(r.phase).toBe('DISCUSS');expect(r.hint_index).toBe(3*laps);
  });
  it('rejects wrong speaker, stale cursor, waiters and guest pause; replays one finish exactly once',async()=>{
    const players=await hints();const dto=await snapshot(players[0]);const r=dto.round!;
    const speaker=players.find(p=>p.player_id===r.current_player_id)!;const other=players.find(p=>p!==speaker)!;
    expect(await (await game(other,'finish_hint',{round_id:r.id,hint_index:0})).json()).toEqual({error:'NOT_YOUR_TURN'});
    expect((await game(speaker,'finish_hint',{round_id:r.id,hint_index:1})).status).toBe(409);
    expect((await game(players[1],'pause',{round_id:r.id})).status).toBe(403);
    const late=await join(players[0],'대기참가');
    expect((await game(late,'finish_hint',{round_id:r.id,hint_index:0})).status).toBe(403);
    const version=(await snapshot(speaker)).room.version;
    const overrides={expected_version:version,expected_phase:'HINT',request_id:randomUUID()};
    const payload={round_id:r.id,hint_index:0};
    const first=await (await game(speaker,'finish_hint',payload,overrides)).json();events.length=0;
    expect(await (await game(speaker,'finish_hint',payload,overrides)).json()).toEqual(first);expect(events).toHaveLength(0);
    expect((await snapshot(speaker)).round!.hint_index).toBe(1);
    expect((await game(speaker,'finish_hint',payload,{...overrides,request_id:randomUUID()})).status).toBe(409);
  });
  it.each([60,120,180,300])('uses %i-second server deadline and settles it only once',async seconds=>{
    const players=await hints(1,seconds);await finishAll(players);const before=await snapshot(players[0]);const r=before.round!;
    expect((Date.parse(r.deadline_at!)-Date.parse(before.server_now!))/1000).toBeGreaterThan(seconds-2);
    expect(await (await game(players[0],'start_vote',{round_id:r.id})).json()).toEqual({error:'DISCUSSION_NOT_OVER'});
    await db.query("update app_private.rounds set deadline_at=clock_timestamp()-interval '1 second' where id=$1",[r.id]);
    events.length=0;const after=await snapshot(players[1]);expect(after.round!.phase).toBe('VOTE_1');expect(after.room.version).toBe(before.room.version+1);
    expect(after).not.toHaveProperty('_transition_applied');expect(events).toHaveLength(1);
    expect((await snapshot(players[2])).room.version).toBe(after.room.version);expect(events).toHaveLength(1);
    for(const p of players){const dto=await snapshot(p);if(dto.round!.me!.role==='liar')expect(dto.round!.me!.word).toBeNull();}
  });
  it('freezes hint cursor and discussion remaining time across pause/resume',async()=>{
    const players=await hints();const host=players[0];let r=(await snapshot(host)).round!;
    expect((await game(host,'pause',{round_id:r.id})).status).toBe(200);
    expect((await snapshot(host)).round!.phase).toBe('PAUSED_HOST');
    expect((await game(players.find(p=>p.player_id===r.current_player_id)!,'finish_hint',{round_id:r.id,hint_index:0})).status).toBe(409);
    await game(host,'resume',{round_id:r.id});expect((await snapshot(host)).round!.current_player_id).toBe(r.current_player_id);
    await finishAll(players);r=(await snapshot(host)).round!;await game(host,'pause',{round_id:r.id});
    const paused=(await snapshot(host)).round!;expect(paused.deadline_at).toBeNull();expect(paused.remaining_ms).toBeGreaterThan(58000);
    await db.query("update app_private.rounds set phase_started_at=now()-interval '1 hour' where id=$1",[r.id]);
    expect((await snapshot(host)).round!.remaining_ms).toBe(paused.remaining_ms);
    await game(host,'resume',{round_id:r.id});const resumed=await snapshot(host);
    expect(resumed.round!.phase).toBe('DISCUSS');expect(Date.parse(resumed.round!.deadline_at!)-Date.parse(resumed.server_now!)).toBeGreaterThan(paused.remaining_ms!-1000);
  });
  it('keeps unlimited discussion until host starts vote, including pause/resume',async()=>{
    const players=await hints(1,0);await finishAll(players);const host=players[0];const r=(await snapshot(host)).round!;
    expect(r.deadline_at).toBeNull();expect((await game(players[1],'start_vote',{round_id:r.id})).status).toBe(403);
    await game(host,'pause',{round_id:r.id});await game(host,'resume',{round_id:r.id});expect((await snapshot(host)).round!.deadline_at).toBeNull();
    expect((await game(host,'start_vote',{round_id:r.id})).status).toBe(200);expect((await snapshot(host)).round!.phase).toBe('VOTE_1');
  });
  it('heartbeat settles an expired deadline and invalid tokens cannot advance it',async()=>{
    const players=await hints();await finishAll(players);const host=players[0];const r=(await snapshot(host)).round!;
    await db.query("update app_private.rounds set deadline_at=clock_timestamp()-interval '1 second' where id=$1",[r.id]);
    expect((await api.snapshot(new Request('https://test.invalid?room_id='+host.room_id,{headers:{Authorization:'Bearer '+ 'f'.repeat(64)}}))).status).toBe(403);
    events.length=0;expect((await api.room(request({room_id:host.room_id,action:'heartbeat',request_id:randomUUID()},host.token))).status).toBe(200);expect(events).toHaveLength(1);
    expect((await snapshot(host)).round!.phase).toBe('VOTE_1');
  });
});
async function settings(s:Issued,payload:object) {
  const d=await snapshot(s);
  return api.room(request({room_id:s.room_id,action:'update_settings',payload,expected_version:d.room.version,request_id:randomUUID()},s.token));
}
describe('themes and confusion liar',()=>{
  it.each(['음식','동물','생활용품','장소','취미','자연','운동','크로스핏','여행'])('selects only %s words with private classic/easy/hard assignments',async theme=>{
    const players=await room();const host=players[0];
    for(const mode of ['classic','easy','hard']) {
      expect((await settings(host,{theme,game_mode:mode==='classic'?'classic':'confusion',difficulty:mode==='hard'?'hard':'easy'})).status).toBe(200);
      expect((await game(host,'start_round')).status).toBe(200);
      const r=(await snapshot(host)).round!;
      const {rows}=await db.query<{word:string;liar_word:string|null;easy_word:string;hard_word:string}>(`select s.word,s.liar_word,w.easy_word,w.hard_word from app_private.round_secrets s join app_private.builtin_words w on w.category=s.category and w.word=s.word where s.round_id=$1`,[r.id]);
      expect(rows[0].liar_word).toBe(mode==='classic'?null:mode==='easy'?rows[0].easy_word:rows[0].hard_word);
      for(const p of players){const own=(await snapshot(p)).round!;expect(own.theme).toBe(theme);expect(own.game_mode).toBe(mode==='classic'?'classic':'confusion');expect(own.me!.word).toBe(own.me!.role==='liar'?rows[0].liar_word:rows[0].word);expect(Object.keys(own.me!).sort()).toEqual(['acknowledged','role','submitted','word']);}
      expect((await game(host,'cancel_round')).status).toBe(200);
    }
  });
  it('validates settings and requires a custom theme while keeping single-word submission',async()=>{
    const players=await room();const host=players[0];
    expect((await settings(players[1],{theme:'운동'})).status).toBe(403);
    for(const payload of [{theme:'없는테마'},{theme:null},{game_mode:'unknown'},{difficulty:null},{word_mode:null},{hint_rounds:null},{discussion_seconds:null},{custom_theme:3},{custom_theme:'가'.repeat(31)},{custom_theme:'음식\u200b'},{word_mode:'custom',game_mode:'confusion'}])expect((await settings(host,payload)).status).toBe(400);
    await settings(host,{word_mode:'custom'});expect(await (await game(host,'start_round')).json()).toEqual({error:'INVALID_SETTINGS'});
    expect((await settings(host,{custom_theme:'  우리 학교  '})).status).toBe(200);
    expect((await game(host,'start_round')).status).toBe(200);const r=(await snapshot(host)).round!;
    expect(r.theme).toBe('우리 학교');expect(r.phase).toBe('COLLECT_WORDS');
    expect((await settings(host,{custom_theme:'다른 테마'})).status).toBe(409);
    for(let i=0;i<players.length;i++){const own=(await snapshot(players[i])).round!;expect(own.me!.role).toBeNull();expect(own.me!.word).toBeNull();expect((await game(players[i],'submit_word',{round_id:r.id,word:'교실단어'+i})).status).toBe(200);}
    const after=(await snapshot(host)).round!;expect(after.theme).toBe('우리 학교');
    const own=await Promise.all(players.map(snapshot));expect(own.filter(d=>d.round!.me!.role==='liar').every(d=>d.round!.me!.word===null)).toBe(true);
  });
  it('freezes random theme and alternate word across hint and pause, and keeps waiters private',async()=>{
    const players=await room();const host=players[0];await settings(host,{theme:'random',game_mode:'confusion',difficulty:'hard'});await game(host,'start_round');
    const before=await Promise.all(players.map(snapshot));const r=before[0].round!;
    expect(r.theme).toBeTruthy();expect(before.every(d=>d.round!.theme===r.theme)).toBe(true);
    for(const p of players)await game(p,'ack_role',{round_id:r.id});
    await game(host,'pause',{round_id:r.id});
    for(let i=0;i<players.length;i++){const after=(await snapshot(players[i])).round!;expect(after.phase).toBe('PAUSED_HOST');expect(after.theme).toBe(r.theme);expect(after.me!.word).toBe(before[i].round!.me!.word);}
    const late=await join(host,'테마대기자');const dto=await snapshot(late);expect(dto.round!.me).toBeNull();expect(JSON.stringify(dto)).not.toMatch(/liar_word|easy_word|hard_word/);
  });
  it('has 30 words per theme and every reviewed easy/hard partner is distinct and in the same theme',async()=>{
    const {rows}=await db.query<{category:string;n:number}>(`select category,count(*)::int n from app_private.builtin_words group by category`);expect(rows).toHaveLength(9);expect(rows.every(r=>r.n===30)).toBe(true);
    const unique=await db.query<{n:number}>(`select count(distinct word)::int n from app_private.builtin_words`);expect(unique.rows[0].n).toBe(270);
    const invalid=await db.query<{n:number}>(`select count(*)::int n from app_private.builtin_words w left join app_private.builtin_words e on e.category=w.category and e.word=w.easy_word left join app_private.builtin_words h on h.category=w.category and h.word=w.hard_word where e.word is null or h.word is null or w.word=w.easy_word or w.word=w.hard_word or w.easy_word=w.hard_word`);expect(invalid.rows[0].n).toBe(0);
  });
});
