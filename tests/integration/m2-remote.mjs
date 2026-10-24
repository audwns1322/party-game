// Explicit development opt-in. Creates disposable rooms only; always closes them.
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import console from 'node:console';
/* global AbortSignal */
assert.equal(process.env.M2_REMOTE_PROJECT,'wmgpshtqqsqwgyigxcwl');
const env=readFileSync('.env.local','utf8');
const base=env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim();
const key=env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();
assert.equal(base,'https://wmgpshtqqsqwgyigxcwl.supabase.co');assert.ok(key?.startsWith('sb_publishable_'));
const rooms=[];
mkdirSync('.cache',{recursive:true});
const ledger='.cache/m2-remote-rooms.json';
writeFileSync(ledger,'[]',{flag:'wx'}); // cleanup interrupted runs before creating another fixture set
const call=async(name,body,session,query='')=>{
  const response=await fetch(`${base}/functions/v1/${name}${query}`,{method:body?'POST':'GET',headers:{apikey:key,...(body?{'Content-Type':'application/json'}:{}),...(session?{Authorization:`Bearer ${session.token}`}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  return {status:response.status,data:await response.json()};
};
const snapshot=async(s)=>{const r=await call('room-snapshot',null,s,`?room_id=${s.room_id}`);assert.equal(r.status,200);return r.data;};
const make=async(n)=>{
  const host=await call('room-create',{nickname:`M2검증${rooms.length}`});assert.equal(host.status,200);
  rooms.push(host.data);writeFileSync(ledger,JSON.stringify(rooms.map(s=>s.room_id)));
  const players=[host.data];
  for(let i=1;i<n;i++){const r=await call('room-join',{room_code:host.data.code,nickname:`검증참가${i}`});assert.equal(r.status,200);players.push(r.data);}
  return players;
};
const command=async(s,action,payload={},overrides={})=>{
  const d=await snapshot(s);return call('game-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,expected_phase:d.round?.phase??'LOBBY',request_id:randomUUID(),...overrides},s);
};
let checks=0;
try {
  for(const count of [3,12]){
    const players=await make(count);const host=players[0];
    const realtime=createClient(base,key,{auth:{persistSession:false}});
    let eventResolve;const event=new Promise(resolve=>{eventResolve=resolve;});
    const channel=realtime.channel(`room:${host.room_id}`).on('broadcast',{event:'version'},({payload})=>eventResolve(payload));
    let timer;
    try {
      await new Promise((resolve,reject)=>channel.subscribe(status=>{if(status==='SUBSCRIBED')resolve();if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(status))reject(Error('Realtime subscribe failed'));}));
      const initial=await snapshot(host);const version=initial.room.version;
      const same={expected_version:version,expected_phase:'LOBBY',request_id:randomUUID()};
      const other={...same,request_id:randomUUID()};
      const [a,b]=await Promise.all([command(host,'start_round',{},same),command(host,'start_round',{},other)]);
      assert.deepEqual([a.status,b.status].sort(),[200,409]);checks++;
      const winner=a.status===200?a:b;
      const winningRequest=a.status===200?same:other;
      const replay=await command(host,'start_round',{},winningRequest);assert.equal(replay.status,200);assert.equal(replay.data.version,winner.data.version);checks++;
      const payload=await Promise.race([event,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('No server broadcast')),10000);})]);
      assert.deepEqual(Object.keys(payload).sort(),['room_id','version']);assert.equal(payload.room_id,host.room_id);checks++;
    } finally {clearTimeout(timer);await realtime.removeAllChannels();}
    const d=await snapshot(host);assert.equal(d.round.participant_ids.length,count);
    let liars=0;
    for(const p of players){const own=await snapshot(p);if(own.round.me.role==='liar'){liars++;assert.equal(own.round.me.word,null);}else assert.ok(typeof own.round.me.word==='string');}
    assert.equal(liars,1);checks++;
    if(count===3){
      const late=await call('room-join',{room_code:host.code,nickname:'검증대기자'});assert.equal(late.status,200);
      assert.equal((await snapshot(late.data)).round.me,null);
      assert.equal((await command(late.data,'ack_role',{round_id:d.round.id})).status,403);checks++;
    }
  }
  const players=await make(3);const host=players[0];let d=await snapshot(host);
  assert.equal((await call('room-command',{room_id:host.room_id,action:'update_settings',payload:{word_mode:'custom'},expected_version:d.room.version,request_id:randomUUID()},host)).status,200);
  assert.equal((await command(host,'start_round')).status,200);d=await snapshot(host);
  for(let i=0;i<players.length;i++){
    assert.equal((await snapshot(players[i])).round.me.role,null);
    assert.equal((await command(players[i],'submit_word',{round_id:d.round.id,word:`테스트단어${i}`})).status,200);
  }
  const own=await Promise.all(players.map(snapshot));
  const liarIndex=own.findIndex(s=>s.round.me.role==='liar');assert.ok(liarIndex>=0);
  assert.equal(own[liarIndex].round.me.word,null);
  for(const s of own.filter(x=>x.round.me.role==='citizen'))assert.notEqual(s.round.me.word,`테스트단어${liarIndex}`);
  for(const p of players)assert.equal((await command(p,'ack_role',{round_id:d.round.id})).status,200);
  assert.equal((await snapshot(host)).round.phase,'HINT');checks++;
  console.log(`Remote M2: ${checks} checks passed (3/12 players, concurrent start, replay, server Broadcast, late join, custom exclusion, ack → HINT).`);
} finally {
  for(const s of rooms){
    try{const d=await snapshot(s);const response=await call('room-command',{room_id:s.room_id,action:'close_room',payload:{},expected_version:d.room.version,request_id:randomUUID()},s);assert.equal(response.status,200);console.log('Disposable room closed.');}
    catch(error){console.log(`Cleanup requires management verification: ${error.message}`);process.exitCode=1;}
  }
}
