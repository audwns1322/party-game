// Explicit, development-only HTTP smoke. Never commit/print participant credentials.
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import console from 'node:console';
/* global AbortSignal */

const base=(process.env.SUPABASE_TEST_URL || 'https://wmgpshtqqsqwgyigxcwl.supabase.co').replace(/\/$/,'');
const key=process.env.SUPABASE_TEST_PUBLIC_KEY;
const preview='https://party-game-git-codex-bomb-pass-mvp-audwns1322.vercel.app';
const production='https://party-game-psi-pink.vercel.app';
const createdRooms=[];
let checks=0;
let serial=0;
const nick=()=> 'QA'+randomBytes(3).toString('hex')+String(++serial);
const equal=(a,b,label)=>{assert.equal(a,b,label);checks++;};
const ok=(a,label)=>{assert.ok(a,label);checks++;};
async function request(path,{body,token,origin=preview,method=body?'POST':'GET',query='',headers={}}={}){
  const response=await fetch(base+'/functions/v1/'+path+query,{
    method,headers:{...(key?{apikey:key}:{}),Origin:origin,...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},
    ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(12000),
  });
  return {status:response.status,origin:response.headers.get('access-control-allow-origin'),data:await response.json().catch(()=>({}))};
}
function expectStatus(r,code,label){
  equal(r.status,code,label+' (error '+String(r.data?.error??'none')+')');
  return r.data;
}
function secretFree(data){
  const serialized=JSON.stringify(data);
  ok(!Object.hasOwn(data,'secret')&&!serialized.includes('"explodeAt"')&&!serialized.includes('"receipts"'),'secret timer/receipts absent');
}
async function create(game_type,origin=preview){
  const r=await request('room-create',{body:{nickname:nick(),game_type},origin});
  const room=expectStatus(r,200,'create '+game_type);
  createdRooms.push({room,origin});
  equal(r.origin,origin,'create CORS');
  return room;
}
async function join(room,origin=preview){
  const r=await request('room-join',{body:{room_code:room.code,nickname:nick()},origin});
  const player=expectStatus(r,200,'join');
  equal(r.origin,origin,'join CORS');
  return player;
}
const common=(s,origin=preview)=>request('room-snapshot',{token:s.token,query:'?room_id='+s.room_id,origin});
const bomb=(s,action='snapshot',version,payload={},request_id=randomUUID())=>request('bomb-command',{token:s.token,body:{room_id:s.room_id,action,expected_version:version,payload,request_id}});
async function view(s){
  const r=await bomb(s);const data=expectStatus(r,200,'bomb snapshot');
  equal(r.origin,preview,'bomb CORS');secretFree(data);
  return data;
}
async function phase(s,status,timeout=65000){
  const end=Date.now()+timeout;
  while(Date.now()<end){
    const data=await view(s);
    if(status.includes(data.state.status))return data;
    await delay(350);
  }
  throw Error('Timeout waiting for '+status.join('/'));
}
async function close(s,origin){
  const state=expectStatus(await common(s,origin),200,'cleanup snapshot');
  const result=await request('room-command',{token:s.token,origin,body:{room_id:s.room_id,action:'close_room',expected_version:state.room.version,request_id:randomUUID(),payload:{}}});
  expectStatus(result,200,'cleanup room');
}
let cleanupFailed=false;
try{
  for(const [path,method] of [['room-create','POST'],['room-join','POST'],['room-snapshot','GET'],['room-command','POST'],['player-recover','POST'],['bomb-command','POST']]){
    const r=await request(path,{method:'OPTIONS',headers:{'Access-Control-Request-Method':method,'Access-Control-Request-Headers':'authorization,apikey,content-type'}});
    equal(r.status,204,path+' preflight');equal(r.origin,preview,path+' allowed preview origin');
  }
  const denied=await request('bomb-command',{method:'OPTIONS',origin:'https://unrelated.example',headers:{'Access-Control-Request-Method':'POST'}});
  equal(denied.status,403,'unrelated origin denied');
  const host=await create('bomb-pass'),guest=await join(host),third=await join(host);
  const participants=[host,guest,third];
  const initial=await view(host);
  equal(initial.state.status,'lobby','lobby');equal(initial.players.length,3,'three participants');equal(initial.host,host.player_id,'host');
  for(const p of participants){
    const s=await view(p);equal(s.me,p.player_id,'independent participant credential');equal(s.players.length,3,'shared participant list');
    const commonState=expectStatus(await common(p),200,'common room snapshot');equal(commonState.room.game_type,'bomb-pass','common route');secretFree(commonState);
  }
  expectStatus(await bomb({...host,token:randomBytes(32).toString('hex')}),403,'invalid token');
  expectStatus(await bomb(guest,'start',initial.version),403,'guest cannot start');
  const settings=expectStatus(await bomb(host,'settings',initial.version,{maxSeconds:45,answerMode:'text',turnStyle:'random'}),200,'settings');
  equal(settings.state.maxSeconds,45,'settings applied');equal(settings.state.turnStyle,'random','random mode');
  let current=expectStatus(await bomb(host,'start',settings.version),200,'start');
  equal(current.state.status,'countdown','start countdown');secretFree(current);
  const late=await request('room-join',{body:{room_code:host.code,nickname:nick()}});
  ok(late.status===403||late.status===409,'late join rejected');equal(late.data.error,'ROOM_LOCKED','late join error');
  // Early explosions are valid. Retry a round only if it genuinely expires during a turn assertion.
  let passedRound=false;
  for(let attempt=0;attempt<5&&!passedRound;attempt++){
    current=await phase(host,['playing','exploded'],52000);
    if(current.state.status==='playing'){
      const holder=participants.find(p=>p.player_id===current.state.holderId);
      const wrong=participants.find(p=>p.player_id!==current.state.holderId);
      ok(holder&&wrong,'valid selected participants');
      const blocked=await bomb(wrong,'pass',current.version,{answer:'wrong'});
      if(blocked.data.error==='PHASE_CONFLICT'){current=await phase(host,['exploded']);}
      else{
        expectStatus(blocked,403,'wrong turn');equal(blocked.data.error,'NOT_YOUR_TURN','wrong turn error');
        const first=await bomb(holder,'pass',current.version,{answer:'QA answer'});
        if(first.data.error==='PHASE_CONFLICT'){current=await phase(host,['exploded']);}
        else{
          const moved=expectStatus(first,200,'valid answer and pass');secretFree(moved);
          ok(moved.state.holderId!==holder.player_id,'next random holder differs');
          equal(moved.state.answers.length,1,'answer recorded');
          const next=participants.find(p=>p.player_id===moved.state.holderId);
          ok(next,'next holder in participants');
          const duplicate=await bomb(next,'pass',moved.version,{answer:'QA answer'});
          if(duplicate.data.error==='PHASE_CONFLICT'){current=await phase(host,['exploded']);}
          else{
            expectStatus(duplicate,409,'duplicate rejected');equal(duplicate.data.error,'DUPLICATE_ANSWER','duplicate error');
            const stale=await bomb(next,'pass',current.version,{answer:'another'});
            if(stale.data.error==='PHASE_CONFLICT'){current=await phase(host,['exploded']);}
            else{
              expectStatus(stale,409,'stale version');equal(stale.data.error,'VERSION_CONFLICT','stale error');
              const seen=await view(third);
              if(seen.state.status==='playing'){
                equal(seen.state.holderId,moved.state.holderId,'third session observes new holder');
                equal(seen.state.answers[0].answer,'QA answer','shared answer');
              }
              current=await phase(host,['exploded'],52000);
              equal(current.state.explodedHolderId,moved.state.holderId,'deadline holder exploded');
              passedRound=true;
            }
          }
        }
      }
    }
    if(!passedRound&&attempt<4)current=expectStatus(await bomb(host,'next',current.version),200,'retry after valid early explosion');
  }
  ok(passedRound,'completed a full turn-validation round');
  const explosionId=current.state.explosionId;
  ok(explosionId,'server explosion identifier');
  for(const p of participants){
    const s=await view(p);
    equal(s.state.status,'exploded','all clients observe explosion');
    equal(s.state.explosionId,explosionId,'single explosion shared');
    equal(s.state.explodedHolderId,current.state.explodedHolderId,'same exploded holder');
  }
  await delay(3500);
  equal((await view(host)).state.status,'exploded','no automatic round restart');
  expectStatus(await bomb(guest,'next',current.version),403,'guest cannot advance');
  const nextRound=expectStatus(await bomb(host,'next',current.version),200,'host next round');
  equal(nextRound.state.round,current.state.round+1,'round increments');equal(nextRound.state.status,'countdown','next countdown');
  const finished=expectStatus(await bomb(host,'finish',nextRound.version),200,'host finish');
  equal(finished.state.status,'finished','game finished');
  equal((await view(guest)).state.status,'finished','guest observes finish');
  const restarted=expectStatus(await bomb(host,'restart',finished.version),200,'restart same room');
  equal(restarted.state.status,'lobby','restart lobby');equal(restarted.state.round,0,'restart reset');
  const recovery=expectStatus(await request('player-recover',{body:{room_code:host.code,recovery_code:guest.recovery_code}}),200,'recover guest');
  equal(recovery.player_id,guest.player_id,'recovered identity');
  expectStatus(await bomb(guest),403,'old credential revoked');
  equal((await view(recovery)).me,guest.player_id,'new credential valid');
  for(const type of ['liar','mafia','quoridor']){
    const legacy=await create(type,production);
    const other=await join(legacy,production);
    const data=expectStatus(await common(other,production),200,'existing '+type+' snapshot');
    equal(data.room.game_type,type,'existing game type');equal(data.players.length,2,'existing game participants');
  }
  console.log('PASS: BOMB HTTP smoke, '+checks+' assertions (including existing games and CORS)');
}finally{
  for(const {room,origin} of createdRooms){
    try{await close(room,origin);}catch{cleanupFailed=true;console.error('QA room cleanup failed; maintenance expiry required');}
  }
}
if(cleanupFailed)throw Error('One or more QA rooms could not be closed');
