import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, afterEach, expect, it } from 'vitest';

const db = new PGlite();
type Seat = { id: string; hash: string };
let roomId: string;
let seats: Seat[];
let roundId: string;

async function command(index: number, action: string, payload: object = {}, version?: number) {
  const v = version ?? (await db.query<{version:number}>('select version from app_private.rooms where id=$1',[roomId])).rows[0].version;
  return db.query('select public.room_command($1,$2,$3,$4::jsonb,$5)',[seats[index].hash,roomId,action,JSON.stringify(payload),v]);
}
async function phase() {
  return (await db.query<{phase:string;winner:string|null;day_result:{eliminated_player_id:string|null}|null}>('select phase,winner,day_result from app_private.mafia_rounds where id=$1',[roundId])).rows[0];
}
async function rejected(index:number, action:string, payload:object, message:RegExp) {
  await db.exec('savepoint rejected_action;');
  try { await expect(command(index,action,payload)).rejects.toThrow(message); }
  finally { await db.exec('rollback to savepoint rejected_action; release savepoint rejected_action;'); }
}

beforeAll(async () => {
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const name of (await readdir('supabase/migrations')).filter(n=>n.endsWith('.sql')).sort()) {
    await db.exec(await readFile(`supabase/migrations/${name}`,'utf8'));
  }
}, 30000);
afterAll(async () => { await db.close(); });
beforeEach(async () => {
  await db.exec('begin;');
  seats = [];
  for (let i=0;i<4;i++) {
    const hash=String(i+1).repeat(64);
    const recovery=String(i+5).repeat(64);
    const query = i===0
      ? await db.query<{value:{room_id:string;player_id:string}}>('select public.room_create($1,$2,$3,$4) value',['방장', '방장',hash,recovery])
      : await db.query<{value:{room_id:string;player_id:string}}>('select public.room_join($1,$2,$3,$4,$5) value',[(await db.query<{code:string}>('select code from app_private.rooms where id=$1',[roomId])).rows[0].code,`참가자${i}`,`참가자${i}`,hash,recovery]);
    roomId=query.rows[0].value.room_id;
    seats.push({id:query.rows[0].value.player_id,hash});
  }
  await db.query("update app_private.rooms set game_type='mafia' where id=$1",[roomId]);
  roundId=(await db.query<{id:string}>("insert into app_private.mafia_rounds(room_id,phase,night_no) values($1,'DAY_DISCUSS',1) returning id",[roomId])).rows[0].id;
  for (let i=0;i<4;i++) await db.query('insert into app_private.mafia_round_players(round_id,player_id,role,original_role) values($1,$2,$3,$3)',[roundId,seats[i].id,i===0?'mafia':'citizen']);
});
afterEach(async () => { await db.exec('rollback;'); });

it('allows only the host to start, validates secret votes and ends on last mafia elimination',async()=>{
  await rejected(1,'mafia_day_start_vote',{},/HOST_ONLY/);
  await command(0,'mafia_day_start_vote');
  await rejected(1,'mafia_day_vote',{target_id:seats[1].id},/INVALID_TARGET/);
  for (let i=0;i<4;i++) await command(i,'mafia_day_vote',{target_id:i===0?seats[1].id:seats[0].id});
  expect(await phase()).toMatchObject({phase:'FINAL_RESULT',winner:'citizen',day_result:{eliminated_player_id:seats[0].id}});
  await rejected(2,'mafia_day_vote',{target_id:seats[3].id},/PHASE_CONFLICT/);
  const dto=(await db.query<{value:{mafia:{day_result:{eliminated_team:string};me:{day_voted:boolean}}}}>('select app_private.room_dto($1,$2) value',[roomId,seats[1].id])).rows[0].value;
  expect(dto.mafia.day_result.eliminated_team).toBe('mafia');
});

it('runs one tied-ballot runoff and advances to the next night without a second elimination',async()=>{
  await command(0,'mafia_day_start_vote');
  const targets=[1,0,0,1];
  for(let i=0;i<4;i++)await command(i,'mafia_day_vote',{target_id:seats[targets[i]].id});
  expect((await phase()).phase).toBe('DAY_RUNOFF');
  const dto=(await db.query<{value:{mafia:{day_result:{runoff_ids:string[]}}}}>('select app_private.room_dto($1,$2) value',[roomId,seats[2].id])).rows[0].value;
  expect(dto.mafia.day_result.runoff_ids).toEqual(expect.arrayContaining([seats[0].id,seats[1].id]));
  await rejected(2,'mafia_day_vote',{target_id:seats[3].id},/INVALID_TARGET/);
  for(let i=0;i<4;i++)await command(i,'mafia_day_vote',{target_id:seats[targets[i]].id});
  expect(await phase()).toMatchObject({phase:'DAY_RESULT',winner:null,day_result:{eliminated_player_id:null}});
  await rejected(1,'mafia_day_next_night',{},/HOST_ONLY/);
  await command(0,'mafia_day_next_night');
  expect((await phase()).phase).toBe('NIGHT');
});

it('reveals everyone only on final result and returns to lobby under host authority',async()=>{
  const before=(await db.query<{value:{mafia:{final_roles:null}}}>('select app_private.room_dto($1,$2) value',[roomId,seats[1].id])).rows[0].value;
  expect(before.mafia.final_roles).toBeNull();
  await db.query("update app_private.mafia_rounds set phase='FINAL_RESULT',winner='citizen' where id=$1",[roundId]);
  const final=(await db.query<{value:{mafia:{final_roles:{role:string}[]}}}>('select app_private.room_dto($1,$2) value',[roomId,seats[1].id])).rows[0].value;
  expect(final.mafia.final_roles.map(p=>p.role)).toEqual(['mafia','citizen','citizen','citizen']);
  await rejected(1,'mafia_finish',{},/HOST_ONLY/);
  await command(0,'mafia_finish');
  const lobby=(await db.query<{value:{mafia?:unknown;room:{locked:boolean}}}>('select app_private.room_dto($1,$2) value',[roomId,seats[0].id])).rows[0].value;
  expect(lobby.mafia).toBeUndefined();
  expect(lobby.room.locked).toBe(false);
  await rejected(0,'mafia_finish',{},/PHASE_CONFLICT/);
});

it('allows a journalist to skip later nights but never investigate twice',async()=>{
  await db.query("update app_private.mafia_round_players set role='journalist',original_role='journalist' where round_id=$1 and player_id=$2",[roundId,seats[2].id]);
  const insert=(night:number,target:string|null)=>db.query('insert into app_private.mafia_night_actions(round_id,night_no,actor_id,kind,target_id) values($1,$2,$3,$4,$5)',[roundId,night,seats[2].id,'journalist',target]);
  await insert(1,seats[1].id);
  await db.exec('savepoint duplicate_investigation;');
  try { await expect(insert(2,seats[3].id)).rejects.toThrow(/JOURNALIST_USED/); }
  finally { await db.exec('rollback to savepoint duplicate_investigation; release savepoint duplicate_investigation;'); }
  await insert(2,null);
  const dto=(await db.query<{value:{mafia:{me:{journalist_used:boolean}}}}> ('select app_private.room_dto($1,$2) value',[roomId,seats[2].id])).rows[0].value;
  expect(dto.mafia.me.journalist_used).toBe(true);
});
