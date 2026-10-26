// Bounded opt-in checks against disposable rooms in the named development project.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import console from 'node:console';
/* global AbortSignal */
assert.equal(process.env.THEMES_REMOTE_PROJECT,'wmgpshtqqsqwgyigxcwl');
const env=readFileSync('.env.local','utf8');const base=env.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim();const key=env.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();
assert.equal(base,'https://wmgpshtqqsqwgyigxcwl.supabase.co');assert.ok(key?.startsWith('sb_publishable_'));
const ledger='.cache/themes-remote-rooms.json';mkdirSync('.cache',{recursive:true});writeFileSync(ledger,'[]',{flag:'wx'});const rooms=[];
const call=async(n,b,s,q='')=>{const r=await fetch(base+'/functions/v1/'+n+q,{method:b?'POST':'GET',headers:{apikey:key,...(b?{'Content-Type':'application/json'}:{}),...(s?{Authorization:'Bearer '+s.token}:{})},...(b?{body:JSON.stringify(b)}:{}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json()};};
const snap=async s=>{const r=await call('room-snapshot',null,s,'?room_id='+s.room_id);assert.equal(r.status,200);return r.data;};
const room=async(s,action,payload={})=>{const d=await snap(s);return call('room-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,request_id:randomUUID()},s);};
const game=async(s,action,payload={})=>{const d=await snap(s);return call('game-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,expected_phase:d.round?.phase??'LOBBY',request_id:randomUUID()},s);};
let checks=0;
try{
 const created=await call('room-create',{nickname:'테마원격검증'});assert.equal(created.status,200);const host=created.data;rooms.push(host);writeFileSync(ledger,JSON.stringify(rooms.map(s=>s.room_id)));
 const players=[host];for(let i=1;i<3;i++){const r=await call('room-join',{room_code:host.code,nickname:'테마참가'+i});assert.equal(r.status,200);players.push(r.data);}
 assert.equal((await room(players[1],'update_settings',{theme:'운동'})).status,403);checks++;
 for(const theme of ['음식','크로스핏','여행'])for(const difficulty of ['easy','hard']){
   for(const p of players)assert.equal((await room(p,'heartbeat')).status,200);
   assert.equal((await room(host,'update_settings',{theme,game_mode:'confusion',difficulty})).status,200);
   assert.equal((await game(host,'start_round')).status,200);
   const snapshots=await Promise.all(players.map(snap));assert.ok(snapshots.every(s=>s.round.theme===theme&&s.round.game_mode==='confusion'&&s.round.difficulty===difficulty));checks++;
   const liar=snapshots.find(s=>s.round.me.role==='liar');const citizens=snapshots.filter(s=>s.round.me.role==='citizen');assert.equal(citizens.length,2);assert.ok(liar.round.me.word);assert.notEqual(liar.round.me.word,citizens[0].round.me.word);assert.equal(citizens[0].round.me.word,citizens[1].round.me.word);checks++;
   for(const s of snapshots)assert.deepEqual(Object.keys(s.round.me).sort(),['acknowledged','role','submitted','word']);checks++;
   const rid=snapshots[0].round.id;
   assert.equal((await room(host,'update_settings',{theme:'자연'})).status,409);checks++;
   for(const p of players)assert.equal((await game(p,'ack_role',{round_id:rid})).status,200);
   const hints=await Promise.all(players.map(snap));assert.ok(hints.every((s,i)=>s.round.phase==='HINT'&&s.round.me.word===snapshots[i].round.me.word));checks++;
   assert.equal((await game(host,'cancel_round')).status,200);
 }
 assert.equal((await room(host,'update_settings',{word_mode:'custom',game_mode:'confusion'})).status,400);checks++;
 assert.equal((await room(host,'update_settings',{word_mode:'custom',game_mode:'classic',custom_theme:'  우리 학교  '})).status,200);
 for(const p of players)await room(p,'heartbeat');
 assert.equal((await game(host,'start_round')).status,200);let d=await snap(host);assert.equal(d.round.theme,'우리 학교');assert.equal(d.round.phase,'COLLECT_WORDS');checks++;
 for(let i=0;i<3;i++){const own=await snap(players[i]);assert.equal(own.round.me.word,null);assert.equal(own.round.me.role,null);assert.equal((await game(players[i],'submit_word',{round_id:d.round.id,word:'학교단어'+i})).status,200);}
 const revealed=await Promise.all(players.map(snap));assert.ok(revealed.every(s=>s.round.theme==='우리 학교'));assert.equal(revealed.find(s=>s.round.me.role==='liar').round.me.word,null);checks++;
 console.log(`Remote themes: ${checks} checks passed (themes, confusion easy/hard, owner-only words, frozen config, custom single-word flow).`);
}finally{for(const s of rooms){try{assert.equal((await room(s,'close_room')).status,200);console.log('Disposable theme room closed.');}catch(error){console.log('Cleanup needs verification: '+error.message);process.exitCode=1;}}}
