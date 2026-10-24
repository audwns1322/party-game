// Bounded opt-in test against the development project. Only fixture rooms are changed.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { createClient } from '@supabase/supabase-js';
import console from 'node:console';
/* global AbortSignal */
assert.equal(process.env.M3_REMOTE_PROJECT,'wmgpshtqqsqwgyigxcwl');
const env=readFileSync('.env.local','utf8');
const base=env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim();
const key=env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();
assert.equal(base,'https://wmgpshtqqsqwgyigxcwl.supabase.co');assert.ok(key?.startsWith('sb_publishable_'));
const ledger='.cache/m3-remote-rooms.json';mkdirSync('.cache',{recursive:true});writeFileSync(ledger,'[]',{flag:'wx'});
const rooms=[];
const call=async(name,body,s,query='')=>{
  const r=await fetch(`${base}/functions/v1/${name}${query}`,{method:body?'POST':'GET',headers:{apikey:key,...(body?{'Content-Type':'application/json'}:{}),...(s?{Authorization:`Bearer ${s.token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  return {status:r.status,data:await r.json()};
};
const snapshot=async(s)=>{const r=await call('room-snapshot',null,s,`?room_id=${s.room_id}`);assert.equal(r.status,200);return r.data;};
const game=async(s,action,payload={},overrides={})=>{
  const d=await snapshot(s);return call('game-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,expected_phase:d.round?.phase??'LOBBY',request_id:randomUUID(),...overrides},s);
};
const roomCommand=async(s,action,payload={})=>{const d=await snapshot(s);return call('room-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,request_id:randomUUID()},s);};
let realtime;
let checks=0;
try {
  const host=await call('room-create',{nickname:'M3원격검증'});assert.equal(host.status,200);rooms.push(host.data);writeFileSync(ledger,JSON.stringify(rooms.map(s=>s.room_id)));
  const players=[host.data];for(let i=1;i<3;i++){const r=await call('room-join',{room_code:host.data.code,nickname:`M3참가자${i}`});assert.equal(r.status,200);players.push(r.data);}
  realtime=createClient(base,key,{auth:{persistSession:false}});const events=[];
  const channel=realtime.channel(`room:${host.data.room_id}`).on('broadcast',{event:'version'},({payload})=>events.push(payload));
  await new Promise((resolve,reject)=>channel.subscribe(s=>{if(s==='SUBSCRIBED')resolve();if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(s))reject(Error(s));}));
  for(const seconds of [0,60,120]){
    assert.equal((await roomCommand(players[0],'update_settings',{hint_rounds:seconds===0?3:1,discussion_seconds:seconds})).status,200);
    // Keep the bounded fixture group connected before a new round.
    for(const p of players)assert.equal((await roomCommand(p,'heartbeat')).status,200);
    assert.equal((await game(players[0],'start_round')).status,200);
    const rid=(await snapshot(players[0])).round.id;
    for(const p of players)assert.equal((await game(p,'ack_role',{round_id:rid})).status,200);
    let dto=await snapshot(players[0]);
    while(dto.round.phase==='HINT'){
      const r=dto.round;const speaker=players.find(p=>p.player_id===r.current_player_id);
      const payload={round_id:rid,hint_index:r.hint_index};
      if(r.hint_index===0){
        const wrong=players.find(p=>p!==speaker);assert.equal((await game(wrong,'finish_hint',payload)).status,403);checks++;
        const same={expected_version:dto.room.version,expected_phase:'HINT',request_id:randomUUID()};
        const [a,b]=await Promise.all([game(speaker,'finish_hint',payload,same),game(speaker,'finish_hint',payload,same)]);
        assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.version,b.data.version);checks++;
      }else assert.equal((await game(speaker,'finish_hint',payload)).status,200);
      dto=await snapshot(players[0]);
    }
    assert.equal(dto.round.phase,'DISCUSS');assert.equal(dto.round.hint_index,seconds===0?9:3);checks++;
    assert.equal((await game(players[1],'pause',{round_id:rid})).status,403);checks++;
    assert.equal((await game(players[0],'pause',{round_id:rid})).status,200);
    const paused=await snapshot(players[0]);assert.equal(paused.round.phase,'PAUSED_HOST');assert.equal(paused.round.deadline_at,null);
    await delay(1100);assert.equal((await snapshot(players[1])).round.remaining_ms,paused.round.remaining_ms);
    assert.equal((await game(players[0],'resume',{round_id:rid})).status,200);checks++;
    if(seconds===0){assert.equal((await game(players[0],'start_vote',{round_id:rid})).status,200);}
    else if(seconds===60) {
      assert.equal((await game(players[0],'start_vote',{round_id:rid})).status,409);checks++;
      dto=await snapshot(players[0]);
      console.log('Timed discussion: waiting for the real server deadline (60 seconds).');
      await delay(Math.max(0,Date.parse(dto.round.deadline_at)-Date.parse(dto.server_now))+100);
      events.length=0;
      const [a,b]=await Promise.all([snapshot(players[0]),snapshot(players[1])]);assert.equal(a.round.phase,'VOTE_1');assert.equal(b.round.phase,'VOTE_1');assert.equal(a.room.version,b.room.version);assert.equal(a.room.version,dto.room.version+1);checks++;
      await delay(800);assert.equal(events.length,1);assert.deepEqual(Object.keys(events[0]).sort(),['room_id','version']);checks++;
    } else {
      dto=await snapshot(players[0]);assert.ok(Date.parse(dto.round.deadline_at)>Date.parse(dto.server_now));
      assert.equal((await game(players[1],'start_vote',{round_id:rid,skip_timer:true})).status,403);checks++;
      const same={expected_version:dto.room.version,expected_phase:'DISCUSS',request_id:randomUUID()};
      const payload={round_id:rid,skip_timer:true};
      const [a,b]=await Promise.all([game(players[0],'start_vote',payload,same),game(players[0],'start_vote',payload,same)]);
      assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.version,b.data.version);checks++;
      const after=await snapshot(players[0]);assert.equal(after.round.phase,'VOTE_1');assert.equal(after.round.deadline_at,null);assert.equal(after.room.version,dto.room.version+1);checks++;
    }
    const snapshots=await Promise.all(players.map(snapshot));assert.ok(snapshots.every(s=>s.round.phase==='VOTE_1'));assert.equal(snapshots.filter(s=>s.round.me.role==='liar'&&s.round.me.word===null).length,1);checks++;
    assert.equal((await game(players[0],'cancel_round')).status,200);
  }
  console.log(`Remote M3: ${checks} checks passed (3 laps, concurrent replay, speaker/host permissions, pause/resume, unlimited vote, real 60s deadline, one server Broadcast, host timer skip).`);
} finally {
  if(realtime)await realtime.removeAllChannels();
  for(const s of rooms){try{assert.equal((await roomCommand(s,'close_room')).status,200);console.log('Disposable M3 room closed.');}catch(error){console.log('Fixture cleanup needs verification: '+error.message);process.exitCode=1;}}
}
