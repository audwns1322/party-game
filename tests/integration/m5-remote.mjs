// Explicit development opt-in. One 15-player fixture, credentials only in process memory.
import assert from 'node:assert/strict';import{readFileSync,writeFileSync,mkdirSync}from'node:fs';import{randomUUID}from'node:crypto';import{setTimeout as delay}from'node:timers/promises';import console from'node:console';
/* global AbortSignal */
assert.equal(process.env.M5_REMOTE_PROJECT,'wmgpshtqqsqwgyigxcwl');
const e=readFileSync('.env.local','utf8'),base=e.match(/^VITE_SUPABASE_URL=(.+)$/m)?.[1].trim(),key=e.match(/^VITE_SUPABASE_PUBLISHABLE_KEY=(.+)$/m)?.[1].trim();assert.equal(base,'https://wmgpshtqqsqwgyigxcwl.supabase.co');assert.ok(key?.startsWith('sb_publishable_'));
const ledger='.cache/m5-remote-rooms.json';mkdirSync('.cache',{recursive:true});writeFileSync(ledger,'[]',{flag:'wx'});const rooms=[];
const call=async(n,b,s,q='')=>{const r=await fetch(base+'/functions/v1/'+n+q,{method:b?'POST':'GET',headers:{apikey:key,...(b?{'Content-Type':'application/json'}:{}),...(s?{Authorization:'Bearer '+s.token}:{})},...(b?{body:JSON.stringify(b)}:{}),signal:AbortSignal.timeout(15000)});return{status:r.status,data:await r.json()};};
const snap=async s=>{const r=await call('room-snapshot',null,s,'?room_id='+s.room_id);assert.equal(r.status,200);return r.data;};
const room=async(s,action,payload={})=>{const d=await snap(s);return call('room-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,request_id:randomUUID()},s);};
const game=async(s,action,payload={},overrides={})=>{const d=await snap(s);return call('game-command',{room_id:s.room_id,action,payload,expected_version:d.room.version,expected_phase:d.round?.phase??'LOBBY',request_id:randomUUID(),...overrides},s);};
const wait=async(s,phase,ms=35000)=>{const end=Date.now()+ms;while(Date.now()<end){const d=await snap(s);if(d.round?.phase===phase)return d;await delay(1000);}throw Error('Timed out waiting for '+phase);};
let p=[];let checks=0;
const start=async liar_count=>{
 const host=p[0];assert.equal((await room(host,'update_settings',{word_mode:'builtin',game_mode:'classic',liar_count,discussion_seconds:0,hint_rounds:1})).status,200);for(const s of p)assert.equal((await room(s,'heartbeat')).status,200);
 assert.equal((await game(host,'start_round')).status,200);const initial=await Promise.all(p.map(snap));const rid=initial[0].round.id;
 const liars=p.filter((_,i)=>initial[i].round.me.role==='liar'),citizens=p.filter((_,i)=>initial[i].round.me.role==='citizen');assert.equal(liars.length,liar_count);assert.ok(initial.every(d=>d.round.liar_count===liar_count&&d.round.participant_ids.length===15));checks++;
 for(const s of p)assert.equal((await game(s,'ack_role',{round_id:rid})).status,200);
 for(let i=0;i<15;i++){const r=(await snap(host)).round;assert.equal((await game(p.find(s=>s.player_id===r.current_player_id),'finish_hint',{round_id:rid,hint_index:r.hint_index})).status,200);}
 assert.equal((await game(host,'start_vote',{round_id:rid})).status,200);
 return{rid,liars,citizens,word:initial.find(d=>d.round.me.role==='citizen').round.me.word};
};
const accuse=async target=>{const d=await snap(p[0]);const active=p.filter(s=>d.round.participant_ids.includes(s.player_id));for(const s of active){const r=(await snap(s)).round;assert.equal((await game(s,'submit_vote',{round_id:r.id,cycle_no:r.vote.cycle_no,ballot_no:r.vote.ballot_no,target_id:s.player_id===target.player_id?active.find(x=>x!==s).player_id:target.player_id})).status,200);}};
try{
 const created=await call('room-create',{nickname:'M5원격검증'});assert.equal(created.status,200);const host=created.data;rooms.push(host);writeFileSync(ledger,JSON.stringify(rooms.map(s=>s.room_id)));p=[host];
 for(let i=1;i<15;i++){const r=await call('room-join',{room_code:host.code,nickname:'결과검증참가'+i});assert.equal(r.status,200);p.push(r.data);}
 assert.equal((await call('room-join',{room_code:host.code,nickname:'열여섯검증'})).status,409);checks++;
 const first=await start(2);await accuse(first.liars[0]);assert.equal((await snap(host)).round.m5.selected_role,null);checks++;
 await wait(host,'GUESS');assert.equal((await game(first.liars[1],'submit_guess',{round_id:first.rid,answer:first.word})).status,403);checks++;
 assert.equal((await game(first.liars[0],'submit_guess',{round_id:first.rid,answer:'정답아닌검증문구'})).status,200);
 const pending=await snap(first.liars[0]);assert.equal(pending.round.phase,'APPEAL_WINDOW');assert.equal(pending.round.m5.provisional_correct,false);assert.equal(pending.round.m5.correct_word,null);assert.equal(pending.round.m5.liar_ids,null);checks++;
 assert.equal((await game(first.liars[1],'open_appeal',{round_id:first.rid,guess_id:pending.round.m5.guess_id})).status,403);checks++;
 console.log('Waiting for the real 20-second appeal window.');const next=await wait(host,'DISCUSS');assert.equal(next.round.vote.cycle_no,2);assert.equal(next.round.participant_ids.length,14);assert.deepEqual(next.round.eliminated_ids,[first.liars[0].player_id]);assert.ok(next.players.every(s=>s.wins===0));checks++;
 assert.equal((await game(host,'start_vote',{round_id:first.rid})).status,200);await accuse(first.liars[1]);await wait(host,'GUESS');
 const before=await snap(first.liars[1]);const retry={expected_version:before.room.version,expected_phase:'GUESS',request_id:randomUUID()};
 assert.equal((await game(first.liars[1],'submit_guess',{round_id:first.rid,answer:first.word},retry)).status,200);const guess=await snap(host);assert.equal(guess.round.m5.provisional_correct,true);assert.equal(guess.round.m5.correct_word,null);checks++;
 assert.equal((await game(first.citizens[0],'open_appeal',{round_id:first.rid,guess_id:guess.round.m5.guess_id})).status,200);
 const opened=await snap(host);assert.equal(opened.round.m5.citizen_count,13);checks++;
 assert.equal((await game(first.liars[1],'submit_appeal_vote',{round_id:first.rid,guess_id:guess.round.m5.guess_id,accept:true})).status,403);checks++;
 for(let i=0;i<7;i++)assert.equal((await game(first.citizens[i],'submit_appeal_vote',{round_id:first.rid,guess_id:guess.round.m5.guess_id,accept:true})).status,200);
 const final=await wait(host,'FINAL_RESULT');assert.equal(final.round.m5.winner,'liar');assert.equal(final.round.m5.correct_word,first.word);assert.equal(final.round.m5.liar_ids.length,2);assert.ok(final.players.every(s=>s.wins===(first.liars.some(l=>l.player_id===s.id)?1:0)));checks++;
 assert.equal((await game(first.liars[1],'submit_guess',{round_id:first.rid,answer:first.word},retry)).status,200);assert.deepEqual((await snap(host)).players.map(s=>s.wins),final.players.map(s=>s.wins));checks++;
 assert.equal((await game(host,'return_lobby',{round_id:first.rid})).status,200);const previous=new Map(final.players.map(s=>[s.id,s.wins]));
 const second=await start(1);await accuse(second.citizens[0]);const wrong=await wait(host,'FINAL_RESULT');assert.equal(wrong.round.m5.winner,'liar');assert.equal(wrong.round.m5.reason,'WRONG_ACCUSATION');assert.ok(wrong.players.every(s=>s.wins===previous.get(s.id)+(second.liars[0].player_id===s.id?1:0)));assert.ok(!/voter_id|target_id|opened_by/.test(JSON.stringify(wrong)));checks++;
 assert.equal((await game(host,'return_lobby',{round_id:second.rid})).status,200);assert.equal((await snap(host)).round,null);checks++;
 console.log(`Remote M5: ${checks} checks passed (15/16 capacity, 1/2 liars, real reveals/window, elimination cycle, majority, exact-once full-team scores, replay, new game).`);
}finally{for(const s of rooms){try{assert.equal((await room(s,'close_room')).status,200);console.log('Disposable M5 room closed.');}catch(error){console.log('Cleanup needs verification: '+error.message);process.exitCode=1;}}}
