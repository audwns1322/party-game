// Development-only smoke test. Tokens and recovery codes stay in memory and never print.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import console from 'node:console';
/* global AbortSignal */

const base='https://wmgpshtqqsqwgyigxcwl.supabase.co/functions/v1/';
const rooms=[];
let checks=0;
const call=async(path,body,token,query='')=>{
  const res=await fetch(base+path+query,{
    method:body?'POST':'GET',
    headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:`Bearer ${token}`}:{})},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000),
  });
  return {status:res.status,data:await res.json().catch(()=>({}))};
};
const snapshot=async s=>call('room-snapshot',null,s.token,`?room_id=${s.room_id}`);
const command=async(s,action,payload={})=>{
  const current=await snapshot(s);assert.equal(current.status,200);
  return call('room-command',{room_id:s.room_id,action,payload,expected_version:current.data.room.version,request_id:randomUUID()},s.token);
};
const check=(actual,expected)=>{assert.equal(actual,expected);checks++;};
try {
  const created=await call('room-create',{nickname:'마피아검증방장',game_type:'mafia'});
  check(created.status,200);const host=created.data;rooms.push(host);
  const joining=await call('room-join',{room_code:host.code,nickname:'마피아검증손님'});
  check(joining.status,200);const guest=joining.data;
  const first=await snapshot(host);check(first.status,200);check(first.data.room.game_type,'mafia');
  const roles={...first.data.room.settings.mafia_roles,citizen:3};
  check((await command(guest,'update_settings',{mafia_roles:roles})).status,403);
  check((await command(host,'update_settings',{mafia_roles:{...roles,mafia:0}})).status,400);
  check((await command(host,'update_settings',{mafia_roles:roles})).status,200);
  const updated=await snapshot(guest);check(updated.status,200);
  assert.deepEqual(updated.data.room.settings.mafia_roles,roles);checks++;
  const blocked=await call('game-command',{room_id:host.room_id,action:'start_round',payload:{},expected_version:updated.data.room.version,expected_phase:'LOBBY',request_id:randomUUID()},host.token);
  assert.ok(blocked.status>=400);checks++;
  check((await snapshot(host)).data.round??null,null);
  const participants=[host,guest];
  for(let n=2;n<=3;n++){
    const res=await call('room-join',{room_code:host.code,nickname:`마피아검증${n}`});check(res.status,200);participants.push(res.data);
  }
  check((await command(guest,'mafia_start')).status,403);
  const setup=await command(host,'update_settings',{mafia_roles:{...roles,citizen:2}});check(setup.status,200);
  check((await command(host,'mafia_start')).status,200);
  const assigned=[];const byRole=new Map();
  for(const p of participants){
    const state=await snapshot(p);check(state.status,200);
    assert.ok(state.data.mafia.me.role);checks++;
    assigned.push(state.data.mafia.me.role);
    byRole.set(state.data.mafia.me.role,p);
    check(state.data.mafia.me.acknowledged,false);
  }
  assert.deepEqual(assigned.sort(),['citizen','citizen','mafia','police']);checks++;
  for(const p of participants)check((await command(p,'mafia_ack')).status,200);
  check((await snapshot(host)).data.mafia.phase,'INTRO');
  check((await command(host,'mafia_intro_done')).status,200);
  check((await command(byRole.get('mafia'),'mafia_night_action',{target_id:byRole.get('citizen').player_id})).status,200);
  check((await command(byRole.get('police'),'mafia_night_action',{target_id:byRole.get('mafia').player_id})).status,200);
  const morning=await snapshot(host);check(morning.data.mafia.phase,'DAY_DISCUSS');
  check(morning.data.mafia.night_result.eliminated_team,'citizen');
  const liar=await call('room-create',{nickname:'라이어검증방장',game_type:'liar'});
  check(liar.status,200);rooms.push(liar.data);
  const old=await snapshot(liar.data);check(old.status,200);check(old.data.room.game_type,'liar');
  console.log(`MAF-1/2 remote smoke: ${checks} checks passed`);
} finally {
  for(const s of rooms) {
    try { await command(s,'close_room'); } catch { /* maintenance eventually removes test rooms */ }
  }
}
