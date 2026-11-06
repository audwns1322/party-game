import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { beforeAll, afterAll, beforeEach, afterEach, it, expect } from 'vitest';

// Six independent participant credentials, exercising the real PostgreSQL RPCs.
// The tests are transaction-isolated and do not create rooms in hosted Supabase.
const db = new PGlite();
type Seat = { id:string; hash:string };
let roomId:string;
let roundId:string;
let seats:Seat[];
const rolesSix = {mafia:1,spy:0,citizen:3,police:1,doctor:1,journalist:0,traitor:0};

async function version() {
  return (await db.query<{version:number}>('select version from app_private.rooms where id=$1',[roomId])).rows[0].version;
}
async function command(seat:number, action:string,payload:object={},v?:number) {
  return db.query<{value:{version:number}}>('select public.room_command($1,$2,$3,$4::jsonb,$5) value',[
    seats[seat].hash,roomId,action,JSON.stringify(payload),v??await version(),
  ]);
}
async function phase() {
  return (await db.query<{phase:string;winner:string|null}>('select phase,winner from app_private.mafia_rounds where id=$1',[roundId])).rows[0];
}
async function setRoles(roles:string[]) {
  for(let i=0;i<roles.length;i++) await db.query(
    'update app_private.mafia_round_players set role=$1,original_role=$1 where round_id=$2 and player_id=$3',
    [roles[i],roundId,seats[i].id]);
}
async function rejected(seat:number,action:string,payload:object,pattern:RegExp,v?:number) {
  await db.exec('savepoint expected_error;');
  try { await expect(command(seat,action,payload,v)).rejects.toThrow(pattern); }
  finally { await db.exec('rollback to savepoint expected_error; release savepoint expected_error;'); }
}
async function start(roles:string[]) {
  await db.query("update app_private.rooms set settings=jsonb_set(settings,'{mafia_roles}',$1::jsonb) where id=$2",[JSON.stringify(rolesSix),roomId]);
  await command(0,'mafia_start');
  roundId=(await db.query<{id:string}>('select id from app_private.mafia_rounds where room_id=$1 and ended_at is null',[roomId])).rows[0].id;
  await setRoles(roles);
  for(let i=0;i<6;i++) await command(i,'mafia_ack');
  expect((await phase()).phase).toBe('INTRO');
  await command(0,'mafia_intro_done');
  expect((await phase()).phase).toBe('NIGHT');
}

beforeAll(async()=>{
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for(const file of (await readdir('supabase/migrations')).filter(x=>x.endsWith('.sql')).sort())
    await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
},30000);
afterAll(async()=>db.close());
beforeEach(async()=>{
  await db.exec('begin;');
  seats=[];
  for(let i=0;i<6;i++){
    const hash=(i+1).toString(16).repeat(64),recovery=(i+7).toString(16).repeat(64);
    const q=i===0
      ? await db.query<{value:{room_id:string;player_id:string}}>('select public.room_create($1,$1,$2,$3) value',['주최자',hash,recovery])
      : await db.query<{value:{room_id:string;player_id:string}}>('select public.room_join((select code from app_private.rooms where id=$1),$2,$2,$3,$4) value',
        [roomId,`참가자${i}`,hash,recovery]);
    roomId=q.rows[0].value.room_id;
    seats.push({id:q.rows[0].value.player_id,hash});
  }
  await db.query("update app_private.rooms set game_type='mafia' where id=$1",[roomId]);
});
afterEach(async()=>db.exec('rollback;'));

it('A: six seats play a complete citizen win with doctor protection',async()=>{
  await start(['mafia','police','doctor','citizen','citizen','citizen']);
  await command(0,'mafia_night_action',{target_id:seats[5].id});
  await command(1,'mafia_night_action',{target_id:seats[0].id});
  await command(2,'mafia_night_action',{target_id:seats[5].id});
  expect((await phase()).phase).toBe('DAY_DISCUSS');
  const night=(await db.query<{night_result:{eliminated_player_id:string|null}}>('select night_result from app_private.mafia_rounds where id=$1',[roundId])).rows[0];
  expect(night.night_result.eliminated_player_id).toBeNull();
  await command(0,'mafia_day_start_vote');
  for(let i=0;i<6;i++) await command(i,'mafia_day_vote',{target_id:seats[i===0?3:0].id});
  expect(await phase()).toMatchObject({phase:'FINAL_RESULT',winner:'citizen'});
  await command(0,'mafia_finish');
  expect((await db.query<{locked:boolean}>('select locked from app_private.rooms where id=$1',[roomId])).rows[0].locked).toBe(false);
});

it('A: six seats play a complete mafia win after night and day eliminations',async()=>{
  await start(['mafia','mafia','citizen','citizen','citizen','citizen']);
  for(const i of [0,1]) await command(i,'mafia_night_action',{target_id:seats[5].id});
  expect((await phase()).phase).toBe('DAY_DISCUSS');
  await command(0,'mafia_day_start_vote');
  await rejected(5,'mafia_day_vote',{target_id:seats[0].id},/FORBIDDEN/);
  for(let i=0;i<5;i++) await command(i,'mafia_day_vote',{target_id:seats[i===4?3:4].id});
  expect(await phase()).toMatchObject({phase:'FINAL_RESULT',winner:'mafia'});
});

it.each([4,15])('B: %i active seats can start with matching role configuration',async(count)=>{
  if(count===4){
    for(const i of [4,5]) await db.query("update app_private.players set status='left' where id=$1",[seats[i].id]);
  } else {
    for(let i=6;i<count;i++){
      const hash=(i+1).toString(16).repeat(64),recovery=createHash('sha256').update(`qa-recovery-${i}`).digest('hex');
      const q=await db.query<{value:{player_id:string}}>('select public.room_join((select code from app_private.rooms where id=$1),$2,$2,$3,$4) value',
        [roomId,`참가자${i}`,hash,recovery]);
      seats.push({id:q.rows[0].value.player_id,hash});
    }
  }
  const roles={mafia:count===4?1:3,spy:0,citizen:count===4?2:11,police:1,doctor:0,journalist:0,traitor:0};
  await db.query("update app_private.rooms set settings=jsonb_set(settings,'{mafia_roles}',$1::jsonb) where id=$2",[JSON.stringify(roles),roomId]);
  await command(0,'mafia_start');
  const assigned=(await db.query<{n:number}>('select count(*)::int n from app_private.mafia_round_players where round_id=(select id from app_private.mafia_rounds where room_id=$1)',[roomId])).rows[0].n;
  expect(assigned).toBe(count);
});

it('E/G: dead special roles and invalid targets cannot submit a night action',async()=>{
  await start(['mafia','police','doctor','citizen','citizen','citizen']);
  await rejected(1,'mafia_night_action',{target_id:seats[1].id},/INVALID_TARGET/);
  await db.query('update app_private.mafia_round_players set eliminated_at=now() where round_id=$1 and player_id=$2',[roundId,seats[1].id]);
  await rejected(1,'mafia_night_action',{target_id:seats[0].id},/FORBIDDEN/);
  await rejected(0,'mafia_night_action',{target_id:seats[1].id},/INVALID_TARGET/);
});

it('D/G: concurrent stale ballot is rejected without duplicate vote',async()=>{
  await start(['mafia','police','doctor','citizen','citizen','citizen']);
  await command(0,'mafia_night_action',{target_id:seats[5].id});
  await command(1,'mafia_night_action',{target_id:seats[0].id});
  await command(2,'mafia_night_action',{target_id:seats[5].id});
  await command(0,'mafia_day_start_vote');
  const stale=await version();
  await command(0,'mafia_day_vote',{target_id:seats[1].id},stale);
  await rejected(1,'mafia_day_vote',{target_id:seats[0].id},/VERSION_CONFLICT/,stale);
  await command(1,'mafia_day_vote',{target_id:seats[0].id});
  await rejected(1,'mafia_day_vote',{target_id:seats[0].id},/ALREADY_VOTED/);
  const count=(await db.query<{n:number}>('select count(*)::int n from app_private.mafia_day_votes where round_id=$1',[roundId])).rows[0].n;
  expect(count).toBe(2);
});

it('C: paused game blocks commands, restores NIGHT after reconnect',async()=>{
  await start(['mafia','police','doctor','citizen','citizen','citizen']);
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '40 seconds' where id=$1",[seats[4].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  expect((await phase()).phase).toBe('PAUSED_DISCONNECT');
  await rejected(0,'mafia_night_action',{target_id:seats[5].id},/ROUND_PAUSED/);
  await db.query('update app_private.players set last_seen_at=clock_timestamp() where id=$1',[seats[4].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  expect((await phase()).phase).toBe('NIGHT');
});
