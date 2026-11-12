import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bombHandler } from '../../supabase/functions/_shared/bomb';
import { createRoomHandler, joinRoomHandler, type Rpc } from '../../supabase/functions/_shared/room';
import { hashToken } from '../../supabase/functions/_shared/security';

const db=new PGlite();
const sent:number[]=[];
const rpc:Rpc=async(fn,args)=>{
  const names=Object.keys(args);
  const params=names.map(key=>args[key]!==null&&typeof args[key]==='object'?JSON.stringify(args[key]):args[key]);
  await db.exec('set role service_role');
  try{return (await db.query<{result:unknown}>(`select public.${fn}(${names.map((k,i)=>`${k} => $${i+1}`).join(',')}) as result`,params)).rows[0].result;}
  finally{await db.exec('reset role');}
};
const announce=async(_room:string,version:number)=>{sent.push(version);};
const createHandler=createRoomHandler(rpc,announce);
const joinHandler=joinRoomHandler(rpc,announce);
const play=bombHandler(rpc,announce);
type Session={room_id:string;code:string;player_id:string;token:string};
const post=(content:object,token?:string)=>new Request('https://bomb.test',{method:'POST',headers:{'x-forwarded-for':`172.16.0.${Math.floor(Math.random()*240)+1}`,...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(content)});
const create=async()=>{
  const response=await createHandler(post({nickname:`방장${randomUUID().slice(0,5)}`,game_type:'bomb-pass'}));
  expect(response.status).toBe(200);
  return await response.json() as Session;
};
const join=async(room:Session,name:string)=>joinHandler(post({room_code:room.code,nickname:name}));
const snapshot=async(session:Session)=>{
  const response=await play(post({room_id:session.room_id,action:'snapshot'},session.token));
  expect(response.status).toBe(200);
  return response.json() as Promise<{version:number;state:{status:string;holderId:string;round:number;answers:{answer:string}[];explosionCounts:Record<string,number>};secret?:unknown}>;
};
const command=(session:Session,action:string,expected_version:number,payload:object={},request_id=randomUUID())=>
  play(post({room_id:session.room_id,action,expected_version,payload,request_id},session.token));
const startThree=async()=>{
  const host=await create();
  const other1=await (await join(host,'사과참가자')).json() as Session;
  const other2=await (await join(host,'바나나참가자')).json() as Session;
  const initial=await snapshot(host);
  const result=await command(host,'start',initial.version);
  expect(result.status).toBe(200);
  return {host,participants:[host,other1,other2]};
};

beforeAll(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const file of (await readdir('supabase/migrations')).filter(file=>file.endsWith('.sql')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(async()=>{await db.close();});

describe('bomb pass DB / Edge integration',()=>{
  it('protects the private timer and RPC from anonymous access',async()=>{
    await db.exec('set role anon');
    try{
      await expect(db.query('select * from app_private.bomb_matches')).rejects.toThrow(/permission denied/);
      await expect(db.query("select public.bomb_get(repeat('a',64),gen_random_uuid())")).rejects.toThrow(/permission denied/);
    }finally{await db.exec('reset role');}
    const session=await create();
    const view=await snapshot(session);
    expect(view.state.status).toBe('lobby');
    expect(view).not.toHaveProperty('secret');
  });

  it('enforces host settings and capacity while retaining old room system',async()=>{
    const host=await create();
    const second=await (await join(host,'둘째참가자')).json() as Session;
    let view=await snapshot(host);
    expect((await command(second,'settings',view.version,{maxSeconds:180,answerMode:'text',turnStyle:'random'})).status).toBe(403);
    expect((await command(host,'settings',view.version,{maxSeconds:181,answerMode:'text',turnStyle:'random'})).status).toBe(400);
    expect((await command(host,'settings',view.version,{maxSeconds:180,answerMode:'text',turnStyle:'random'})).status).toBe(200);
    view=await snapshot(host);
    expect((await command(host,'start',view.version)).status).toBe(409);
    for(let i=3;i<=15;i++)expect((await join(host,`테스트참가${i}`)).status).toBe(200);
    expect((await join(host,'초과참가자')).status).toBe(409);
    view=await snapshot(host);
    expect((await command(host,'start',view.version)).status).toBe(200);
    expect((await join(host,'늦은참가자')).status).toBe(403);
  });

  it('serializes holder actions, receipts, expiration and host-controlled next round',async()=>{
    const {host,participants}=await startThree();
    let view=await snapshot(host);
    expect(view.state.status).toBe('countdown');
    expect(JSON.stringify(view)).not.toContain('explodeAt');
    await db.query("update app_private.bomb_matches set state=jsonb_set(state,'{status}','\"playing\"'),secret=jsonb_set(secret,'{explodeAt}',to_jsonb((now()+interval '1 minute')::text)) where room_id=$1",[host.room_id]);
    view=await snapshot(host);
    const holder=participants.find(p=>p.player_id===view.state.holderId)!;
    const outsider=participants.find(p=>p.player_id!==holder.player_id)!;
    expect((await command(outsider,'pass',view.version,{answer:'사과'})).status).toBe(403);
    const receipt=randomUUID();
    const first=await command(holder,'pass',view.version,{answer:'사과'},receipt);
    expect(first.status).toBe(200);
    const after=await snapshot(host);
    expect(after.state.answers).toEqual([{playerId:holder.player_id,answer:'사과'}]);
    expect(after.state.holderId).not.toBe(holder.player_id);
    expect((await command(holder,'pass',view.version,{answer:'사과'},receipt)).status).toBe(200);
    expect((await command(holder,'pass',view.version,{answer:'사과'})).status).toBe(409);
    const nextHolder=participants.find(p=>p.player_id===after.state.holderId)!;
    expect((await command(nextHolder,'pass',after.version,{answer:'사과'})).status).toBe(409);

    await db.query("update app_private.bomb_matches set secret=jsonb_set(secret,'{explodeAt}',to_jsonb((now()-interval '1 second')::text)) where room_id=$1",[host.room_id]);
    const exploded=await snapshot(host);
    expect(exploded.state.status).toBe('exploded');
    expect(Object.values(exploded.state.explosionCounts).reduce((a,b)=>a+b,0)).toBe(1);
    expect(Object.values((await snapshot(host)).state.explosionCounts).reduce((a,b)=>a+b,0)).toBe(1);
    expect((await command(participants.find(p=>p.player_id!==host.player_id)!,'next',exploded.version)).status).toBe(403);
    expect((await command(host,'next',exploded.version)).status).toBe(200);
    const second=await snapshot(host);
    expect(second.state.round).toBe(2);
    expect(second.state.status).toBe('countdown');
    expect((await command(host,'finish',second.version)).status).toBe(200);
    const finished=await snapshot(host);
    expect(finished.state.status).toBe('finished');
    expect((await command(host,'next',finished.version)).status).toBe(409);
    expect((await command(host,'restart',finished.version)).status).toBe(200);
    expect((await snapshot(host)).state.status).toBe('lobby');
  });

  it('rejects a different room token and rejects a late pass at the DB deadline',async()=>{
    const {host,participants}=await startThree();
    const other=await create();
    const wrong=await play(post({room_id:host.room_id,action:'snapshot'},other.token));
    expect(wrong.status).toBe(403);
    await db.query("update app_private.bomb_matches set state=jsonb_set(state,'{status}','\"playing\"'),secret=jsonb_set(secret,'{explodeAt}',to_jsonb((now()-interval '1 second')::text)) where room_id=$1",[host.room_id]);
    const raw=await rpc('bomb_get',{p_credential_hash:await hashToken(participants[0].token),p_room:host.room_id}) as {version:number;state:unknown;secret:unknown};
    await expect(rpc('bomb_commit',{p_credential_hash:await hashToken(participants[0].token),p_room:host.room_id,
      p_expected_version:raw.version,p_state:raw.state,p_secret:raw.secret})).rejects.toThrow('PHASE_CONFLICT');
    expect((await snapshot(host)).state.status).toBe('exploded');
  });
});
