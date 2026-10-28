// Explicit development opt-in; session/recovery credentials remain in process memory.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {createClient} from '@supabase/supabase-js';
import console from 'node:console';
/* global AbortSignal */
assert.equal(process.env.M6_REMOTE_PROJECT,'wmgpshtqqsqwgyigxcwl');
const env=readFileSync('.env.local','utf8'),base=env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim(),key=env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();
assert.equal(base,'https://wmgpshtqqsqwgyigxcwl.supabase.co');assert.ok(key?.startsWith('sb_publishable_'));
mkdirSync('.cache',{recursive:true});const ledger='.cache/m6-remote-rooms.json';writeFileSync(ledger,'[]',{flag:'wx'});
const call=async(n,b,s,q='')=>{const r=await fetch(base+'/functions/v1/'+n+q,{method:b?'POST':'GET',headers:{apikey:key,...(b?{'Content-Type':'application/json'}:{}),...(s?{Authorization:'Bearer '+s.token}:{})},...(b?{body:JSON.stringify(b)}:{}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json()};};
const snap=async s=>{const r=await call('room-snapshot',null,s,'?room_id='+s.room_id);assert.equal(r.status,200);return r.data;};
const room=async(s,action,payload={})=>{const d=await snap(s);return call('room-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,request_id:randomUUID()},s);};
const game=async(s,action,payload={})=>{const d=await snap(s);return call('game-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,expected_phase:d.round?.phase??'LOBBY',request_id:randomUUID()},s);};
let players=[],rt,checks=0;const alive=new Set(),lastBeat=new Map();
const pulse=async(force=false)=>{for(const s of alive)if(force||Date.now()-(lastBeat.get(s.player_id)??0)>7000){assert.equal((await room(s,'heartbeat')).status,200);lastBeat.set(s.player_id,Date.now());}};
const wait=async(observer,predicate,timeout=80000)=>{const end=Date.now()+timeout;while(Date.now()<end){await pulse();const d=await snap(observer);if(predicate(d))return d;await delay(1000);}throw Error('Timed out waiting for M6 server transition');};
try{
 const created=await call('room-create',{nickname:'M6원격검증'});assert.equal(created.status,200);players=[created.data];writeFileSync(ledger,JSON.stringify([players[0].room_id]));
 for(let i=1;i<3;i++){const joined=await call('room-join',{room_code:players[0].code,nickname:'연결검증참가'+i});assert.equal(joined.status,200);players.push(joined.data);}for(const s of players)alive.add(s);
 const host=players[0],events=[];rt=createClient(base,key,{auth:{persistSession:false}});const channel=rt.channel('room:'+host.room_id,{config:{presence:{key:randomUUID()}}}).on('broadcast',{event:'version'},({payload})=>events.push(payload));
 await new Promise((resolve,reject)=>channel.subscribe(s=>{if(s==='SUBSCRIBED')resolve();if(['CHANNEL_ERROR','TIMED_OUT','CLOSED'].includes(s))reject(Error(s));}));assert.equal(await channel.track({}),'ok');
 assert.equal((await room(host,'update_settings',{discussion_seconds:300})).status,200);await pulse(true);assert.equal((await game(host,'start_round')).status,200);const rid=(await snap(host)).round.id;
 for(const s of players){await pulse();assert.equal((await game(s,'ack_role',{round_id:rid})).status,200);}
 for(let i=0;i<3;i++){await pulse();const r=(await snap(host)).round;assert.equal((await game(players.find(s=>s.player_id===r.current_player_id),'finish_hint',{round_id:rid,hint_index:r.hint_index})).status,200);}
 assert.equal((await snap(host)).round.phase,'DISCUSS');checks++;
 await pulse(true);alive.delete(players[1]);console.log('Waiting for actual missed-heartbeat detection.');
 const paused=await wait(host,d=>d.round.phase==='PAUSED_DISCONNECT');assert.equal(paused.round.disconnect.original_phase,'DISCUSS');assert.deepEqual(paused.round.disconnect.missing_ids,[players[1].player_id]);assert.equal(paused.round.deadline_at,null);const saved=paused.round.disconnect.remaining_ms;assert.ok(saved>200000&&saved<=300000);checks++;
 assert.equal((await game(host,'start_vote',{round_id:rid,skip_timer:true})).status,409);checks++;
 assert.equal((await game(players[2],'wait_reconnect',{round_id:rid})).status,403);checks++;
 assert.equal((await room(players[1],'heartbeat')).status,200);alive.add(players[1]);const resumed=await wait(host,d=>d.round.phase==='DISCUSS');assert.ok(Date.parse(resumed.round.deadline_at)-Date.parse(resumed.server_now)>saved-10000);checks++;
 const late=await call('room-join',{room_code:host.code,nickname:'연결검증대기자'});assert.equal(late.status,200);players.push(late.data);assert.equal((await snap(late.data)).round.me,null);checks++;
 await pulse(true);alive.delete(host);console.log('Waiting for actual host absence and 30-second grace.');
 const transferred=await wait(players[1],d=>d.room.host_player_id===players[1].player_id);assert.equal(transferred.round.phase,'PAUSED_DISCONNECT');assert.deepEqual(transferred.round.disconnect.missing_ids,[host.player_id]);checks++;
 const request={room_id:host.room_id,action:'wait_reconnect',payload:{round_id:rid},expected_version:transferred.room.version,expected_phase:'PAUSED_DISCONNECT',request_id:randomUUID()};
 assert.equal((await call('game-command',request,players[1])).status,200);const grace=(await snap(players[1])).round.disconnect.grace_until;assert.equal((await call('game-command',request,players[1])).status,200);assert.equal((await snap(players[1])).round.disconnect.grace_until,grace);checks++;
 const recovered=await call('player-recover',{room_code:host.code,recovery_code:host.recovery_code});assert.equal(recovered.status,200);players[0]=recovered.data;alive.add(players[0]);
 const after=await wait(players[1],d=>d.round.phase==='DISCUSS');assert.equal(after.room.host_player_id,players[1].player_id);assert.ok(after.players.every(s=>s.wins===0));checks++;
 assert.equal((await call('room-snapshot',null,host,'?room_id='+host.room_id)).status,403);assert.equal((await call('player-recover',{room_code:host.code,recovery_code:host.recovery_code})).status,403);checks++;
 assert.equal((await game(players[0],'pause',{round_id:rid})).status,403);checks++;
 assert.equal((await room(players[1],'close_room')).status,200);
 const stop=Date.now()+20000;let purged=false;while(Date.now()<stop){const r=await call('room-snapshot',null,players[1],'?room_id='+host.room_id);assert.ok([403,410].includes(r.status));if(r.status===403){purged=true;break;}await delay(1000);}assert.equal(purged,true);checks++;
 assert.equal((await call('player-recover',{room_code:host.code,recovery_code:players[0].recovery_code})).status,403);checks++;
 assert.ok(events.length>0);for(const e of events)assert.deepEqual(Object.keys(e).sort(),['room_id','version']);checks++;
 console.log(`Remote M6: ${checks} checks passed (real disconnect/grace, frozen timer, host transfer, waiting newcomer, recovery rotation, idempotent wait, scheduled purge, private markers).`);
}finally{
 if(rt)await rt.removeAllChannels();
 for(const s of players){try{const d=await call('room-snapshot',null,s,'?room_id='+s.room_id);if([403,410].includes(d.status))continue;if(d.data.me.is_host){assert.equal((await room(s,'close_room')).status,200);console.log('M6 fixture closed; scheduled cleanup will purge it.');break;}}catch{console.log('M6 cleanup requires verification against its UUID ledger.');process.exitCode=1;}}
}
