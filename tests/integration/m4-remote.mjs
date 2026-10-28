// Explicit development-only fixtures. Credentials stay in process memory; the ledger holds room IDs only.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import console from 'node:console';
/* global AbortSignal */
assert.equal(process.env.M4_REMOTE_PROJECT,'wmgpshtqqsqwgyigxcwl');
const env=readFileSync('.env.local','utf8');const base=env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim();const key=env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();assert.equal(base,'https://wmgpshtqqsqwgyigxcwl.supabase.co');assert.ok(key?.startsWith('sb_publishable_'));
const ledger='.cache/m4-remote-rooms.json';mkdirSync('.cache',{recursive:true});writeFileSync(ledger,'[]',{flag:'wx'});const rooms=[];
const call=async(n,b,s,q='')=>{const r=await fetch(base+'/functions/v1/'+n+q,{method:b?'POST':'GET',headers:{apikey:key,...(b?{'Content-Type':'application/json'}:{}),...(s?{Authorization:'Bearer '+s.token}:{})},...(b?{body:JSON.stringify(b)}:{}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json()};};
const snap=async s=>{const r=await call('room-snapshot',null,s,'?room_id='+s.room_id);assert.equal(r.status,200);return r.data;};
const room=async(s,action,payload={})=>{const d=await snap(s);return call('room-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,request_id:randomUUID()},s);};
const game=async(s,action,payload={},overrides={})=>{const d=await snap(s);return call('game-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,expected_phase:d.round?.phase??'LOBBY',request_id:randomUUID(),...overrides},s);};
const vote=async(s,target,overrides={})=>{const r=(await snap(s)).round;return game(s,'submit_vote',{round_id:r.id,ballot_no:r.vote.ballot_no,target_id:target},overrides);};
const make=async count=>{
 const r=await call('room-create',{nickname:'M4원격검증'+count});assert.equal(r.status,200);const host=r.data;rooms.push(host);writeFileSync(ledger,JSON.stringify(rooms.map(s=>s.room_id)));const p=[host];
 for(let i=1;i<count;i++){const joined=await call('room-join',{room_code:host.code,nickname:'투표검증참가'+i});assert.equal(joined.status,200);p.push(joined.data);}
 await room(host,'update_settings',{discussion_seconds:0});for(const s of p)await room(s,'heartbeat');
 assert.equal((await game(host,'start_round')).status,200);const rid=(await snap(host)).round.id;
 for(const s of p)assert.equal((await game(s,'ack_role',{round_id:rid})).status,200);
 for(let i=0;i<count;i++){const r=(await snap(host)).round;assert.equal(r.phase,'HINT');assert.equal((await game(p.find(s=>s.player_id===r.current_player_id),'finish_hint',{round_id:rid,hint_index:r.hint_index})).status,200);}
 assert.equal((await game(host,'start_vote',{round_id:rid})).status,200);return p;
};
let checks=0;let realtime;
try{
 const p=await make(3);const host=p[0];const initial=await snap(host);const events=[];
 realtime=createClient(base,key,{auth:{persistSession:false}});const channel=realtime.channel('room:'+host.room_id).on('broadcast',{event:'version'},({payload})=>events.push(payload));
 await new Promise((resolve,reject)=>channel.subscribe(s=>{if(s==='SUBSCRIBED')resolve();if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(s))reject(Error(s));}));
 assert.equal((await vote(host,host.player_id)).status,400);checks++;
 const same={expected_version:initial.room.version,expected_phase:'VOTE_1',request_id:randomUUID()};const [a,b]=await Promise.all([vote(host,p[1].player_id,same),vote(host,p[1].player_id,same)]);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.data.version,b.data.version);checks++;
 const partial=await snap(p[1]);assert.deepEqual(partial.round.vote.tallies,[]);assert.equal(partial.round.me.voted,false);assert.equal((await snap(host)).round.me.voted,true);assert.ok(!/voter_id|target_id/.test(JSON.stringify(partial)));checks++;
 const current={expected_version:partial.room.version,expected_phase:'VOTE_1'};
 const outcomes=await Promise.all([vote(p[1],host.player_id,{...current,request_id:randomUUID()}),vote(p[2],host.player_id,{...current,request_id:randomUUID()})]);assert.deepEqual(outcomes.map(r=>r.status).sort(),[200,409]);checks++;
 const loser=outcomes[0].status===409?p[1]:p[2];assert.equal((await vote(loser,host.player_id)).status,200);
 const done=await snap(host);assert.equal(done.round.phase,'REVEAL_VOTE');assert.equal(done.round.vote.selected_player_id,host.player_id);assert.equal(done.round.vote.tallies.length,1);checks++;
 await delay(800);const updates=events.filter(e=>e.version>initial.room.version);assert.equal(updates.length,3);for(const e of updates)assert.deepEqual(Object.keys(e).sort(),['room_id','version']);checks++;
 await realtime.removeAllChannels();realtime=null;
 const six=await make(6);for(let i=0;i<6;i++)assert.equal((await vote(six[i],six[[1,0,0,0,1,1][i]].player_id)).status,200);
 const runoff=await snap(six[0]);assert.equal(runoff.round.phase,'VOTE_RUNOFF');assert.deepEqual([...runoff.round.vote.candidate_ids].sort(),[six[0].player_id,six[1].player_id].sort());checks++;
 assert.equal((await vote(six[0],six[2].player_id)).status,400);checks++;
 for(let i=0;i<6;i++)assert.equal((await vote(six[i],six[[1,0,0,0,0,1][i]].player_id)).status,200);
 const winner=await snap(six[0]);assert.equal(winner.round.phase,'REVEAL_VOTE');assert.equal(winner.round.vote.tallies.length,2);assert.equal(winner.round.vote.selected_player_id,six[0].player_id);checks++;
 const twelve=await make(12);for(let b=1;b<=2;b++)for(let i=0;i<12;i++)assert.equal((await vote(twelve[i],twelve[(i+1)%12].player_id)).status,200);
 const draw=await snap(twelve[0]);assert.equal(draw.round.phase,'FINAL_RESULT');assert.equal(draw.round.vote.outcome,'DRAW');assert.equal(draw.round.vote.tallies.length,2);assert.ok(draw.players.every(p=>p.wins===0));checks++;
 assert.equal((await game(twelve[1],'return_lobby',{round_id:draw.round.id})).status,403);assert.equal((await game(twelve[0],'return_lobby',{round_id:draw.round.id})).status,200);assert.equal((await snap(twelve[0])).round,null);checks++;
 console.log(`Remote M4: ${checks} checks passed (3/6/12, replay/concurrency, private partial votes/Broadcast, restricted runoff, repeated tie draw, lobby return).`);
}finally{if(realtime)await realtime.removeAllChannels();for(const s of rooms){try{assert.equal((await room(s,'close_room')).status,200);console.log('Disposable M4 room closed.');}catch(error){console.log('Cleanup needs verification: '+error.message);process.exitCode=1;}}}
