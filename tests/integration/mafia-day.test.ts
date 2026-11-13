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

it('declares citizen victory when the last actual mafia dies even if spy survives',async()=>{
  await db.query("update app_private.mafia_round_players set role='spy',original_role='spy' where round_id=$1 and player_id=$2",[roundId,seats[1].id]);
  await command(0,'mafia_day_start_vote');
  for(let i=0;i<4;i++)await command(i,'mafia_day_vote',{target_id:i===0?seats[2].id:seats[0].id});
  expect(await phase()).toMatchObject({phase:'FINAL_RESULT',winner:'citizen',day_result:{eliminated_player_id:seats[0].id}});
  const spy=(await db.query<{eliminated_at:string|null}>('select eliminated_at from app_private.mafia_round_players where round_id=$1 and player_id=$2',[roundId,seats[1].id])).rows[0];
  expect(spy.eliminated_at).toBeNull();
});

it('rejects attacks on known mafia teammates without blocking a spy target',async()=>{
  await db.query("update app_private.mafia_rounds set phase='NIGHT' where id=$1",[roundId]);
  await db.query("update app_private.mafia_round_players set role='mafia',original_role='mafia' where round_id=$1 and player_id=$2",[roundId,seats[1].id]);
  await db.query("update app_private.mafia_round_players set role='spy',original_role='spy' where round_id=$1 and player_id=$2",[roundId,seats[2].id]);
  await rejected(0,'mafia_night_action',{target_id:seats[1].id},/INVALID_TARGET/);
  const count=(await db.query<{n:number}>('select count(*)::int n from app_private.mafia_night_actions where round_id=$1',[roundId])).rows[0].n;
  expect(count).toBe(0);
  await command(0,'mafia_night_action',{target_id:seats[2].id});
});

it('tolerates 40-second sleep, warns after 90 seconds, and accepts votes during an absence',async()=>{
  await command(0,'mafia_day_start_vote');
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '40 seconds' where id=$1",[seats[2].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  const dto=async()=>(await db.query<{value:{mafia:{disconnect:{missing_ids:string[]}|null;phase:string};players:{id:string;connected:boolean}[]}}>('select app_private.room_dto($1,$2) value',[roomId,seats[0].id])).rows[0].value;
  expect((await dto()).mafia.disconnect).toBeNull();
  expect((await dto()).players.find(p=>p.id===seats[2].id)?.connected).toBe(true);
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '100 seconds' where id=$1",[seats[2].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  expect((await phase()).phase).toBe('DAY_VOTE');
  expect((await dto()).mafia.disconnect?.missing_ids).toContain(seats[2].id);
  await command(0,'mafia_day_vote',{target_id:seats[1].id});
  expect((await db.query<{n:number}>('select count(*)::int n from app_private.mafia_day_votes where round_id=$1',[roundId])).rows[0].n).toBe(1);
  await db.query('update app_private.players set last_seen_at=clock_timestamp() where id=$1',[seats[2].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  expect((await dto()).mafia.disconnect).toBeNull();
  expect((await phase()).phase).toBe('DAY_VOTE');
});

it('actually records a command even when a participant has just become offline',async()=>{
  await command(0,'mafia_day_start_vote');
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '100 seconds' where id=$1",[seats[2].id]);
  await command(0,'mafia_day_vote',{target_id:seats[1].id});
  expect((await db.query<{n:number}>('select count(*)::int n from app_private.mafia_day_votes where round_id=$1',[roundId])).rows[0].n).toBe(1);
  expect((await phase()).phase).toBe('DAY_VOTE');
});

it('lets the connected host extend waiting or cancel after its reconnect grace',async()=>{
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '100 seconds' where id=$1",[seats[3].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  await rejected(1,'mafia_cancel_round',{},/HOST_ONLY/);
  await rejected(0,'mafia_cancel_round',{},/RECONNECT_GRACE/);
  await db.query("update app_private.mafia_rounds set disconnect_grace_until=now()-interval '1 second' where id=$1",[roundId]);
  await command(0,'mafia_wait_reconnect');
  expect((await phase()).phase).toBe('DAY_DISCUSS');
  await rejected(0,'mafia_cancel_round',{},/RECONNECT_GRACE/);
  await db.query("update app_private.mafia_rounds set disconnect_grace_until=now()-interval '1 second' where id=$1",[roundId]);
  await command(0,'mafia_cancel_round');
  expect((await phase()).phase).toBe('CANCELLED');
  const locked=(await db.query<{locked:boolean}>('select locked from app_private.rooms where id=$1',[roomId])).rows[0].locked;
  expect(locked).toBe(false);
});

it('does not cancel a game from an outdated reconnect warning',async()=>{
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '100 seconds' where id=$1",[seats[3].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  await db.query("update app_private.mafia_rounds set disconnect_grace_until=now()-interval '1 second' where id=$1",[roundId]);
  await db.query('update app_private.players set last_seen_at=clock_timestamp() where id=$1',[seats[3].id]);
  await rejected(0,'mafia_cancel_round',{},/PHASE_CONFLICT/);
  expect((await phase()).phase).toBe('DAY_DISCUSS');
});

it('hands a disconnected mafia host to an online surviving participant after 120 seconds',async()=>{
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '100 seconds' where id=$1",[seats[0].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  const host=async()=>(await db.query<{host_player_id:string}>('select host_player_id from app_private.rooms where id=$1',[roomId])).rows[0].host_player_id;
  expect(await host()).toBe(seats[0].id);
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '130 seconds' where id=$1",[seats[0].id]);
  await db.query('select app_private.advance_mafia_connectivity($1)',[roomId]);
  expect(await host()).toBe(seats[1].id);
  expect((await phase()).phase).toBe('DAY_DISCUSS');
});

it('never delegates an active mafia game to an eliminated participant',async()=>{
  await db.query('update app_private.mafia_round_players set eliminated_at=now() where round_id=$1 and player_id=$2',[roundId,seats[1].id]);
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '130 seconds' where id=$1 or id=$2 or id=$3",[seats[0].id,seats[2].id,seats[3].id]);
  await db.query('select app_private.advance_connectivity($1)',[roomId]);
  const r=(await db.query<{host_player_id:string}>('select host_player_id from app_private.rooms where id=$1',[roomId])).rows[0];
  expect(r.host_player_id).toBe(seats[0].id);
  expect((await phase()).phase).toBe('DAY_DISCUSS');
});

it('does not reveal how many night power roles are in the room',async()=>{
  await db.query("update app_private.mafia_rounds set phase='NIGHT' where id=$1",[roundId]);
  const dto=(await db.query<{value:{mafia:{night_expected_count:null;night_submitted_count:null}}}>('select app_private.room_dto($1,$2) value',[roomId,seats[2].id])).rows[0].value;
  expect(dto.mafia.night_expected_count).toBeNull();
  expect(dto.mafia.night_submitted_count).toBeNull();
});

it('reuses one maintenance routine for non-blocking warnings and recovery',async()=>{
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '100 seconds' where id=$1",[seats[2].id]);
  await db.query('select app_private.maintain_rooms()');
  const warning=async()=>(await db.query<{disconnect_grace_until:string|null}>('select disconnect_grace_until from app_private.mafia_rounds where id=$1',[roundId])).rows[0].disconnect_grace_until;
  expect(await warning()).not.toBeNull();
  expect((await phase()).phase).toBe('DAY_DISCUSS');
  await db.query('update app_private.players set last_seen_at=clock_timestamp() where id=$1',[seats[2].id]);
  await db.query('select app_private.maintain_rooms()');
  expect(await warning()).toBeNull();
});

it('restores a legacy paused round without resetting its submitted votes',async()=>{
  await command(0,'mafia_day_start_vote');
  await command(0,'mafia_day_vote',{target_id:seats[1].id});
  await db.query("update app_private.mafia_rounds set phase='PAUSED_DISCONNECT',disconnect_phase='DAY_VOTE',disconnect_grace_until=now() where id=$1",[roundId]);
  await db.query("update app_private.players set last_seen_at=clock_timestamp()-interval '100 seconds' where id=$1",[seats[2].id]);
  await db.query('select app_private.maintain_rooms()');
  expect((await phase()).phase).toBe('DAY_VOTE');
  expect((await db.query<{n:number}>('select count(*)::int n from app_private.mafia_day_votes where round_id=$1',[roundId])).rows[0].n).toBe(1);
});

it('cleans expired mafia rounds with night, vote and traitor target references before deleting their room',async()=>{
  await db.query("update app_private.mafia_round_players set role='traitor',original_role='traitor',mission_target_id=$3 where round_id=$1 and player_id=$2",[roundId,seats[2].id,seats[1].id]);
  await db.query("insert into app_private.mafia_night_actions(round_id,night_no,actor_id,kind,target_id) values($1,1,$2,'mafia',$3)",[roundId,seats[0].id,seats[1].id]);
  await db.query('insert into app_private.mafia_day_votes(round_id,day_no,ballot,voter_id,target_id) values($1,1,1,$2,$3)',[roundId,seats[3].id,seats[1].id]);
  const other=(await db.query<{value:{room_id:string}}>("select public.room_create($1,$1,$2,$3) value",['다른방','a'.repeat(64),'b'.repeat(64)])).rows[0].value.room_id;
  await db.query("update app_private.rooms set status='closed',closed_at=now() where id=$1",[roomId]);
  await db.exec('savepoint old_cleanup;');
  try {
    await expect(db.query('select app_private.maintain_rooms_before_mafia_reconnect()')).rejects.toThrow(/foreign key|violates/i);
  } finally {
    await db.exec('rollback to savepoint old_cleanup; release savepoint old_cleanup;');
  }
  await db.query('select app_private.maintain_rooms()');
  expect((await db.query('select id from app_private.rooms where id=$1',[roomId])).rows).toHaveLength(0);
  expect((await db.query('select id from app_private.mafia_rounds where id=$1',[roundId])).rows).toHaveLength(0);
  expect((await db.query('select id from app_private.players where room_id=$1',[roomId])).rows).toHaveLength(0);
  expect((await db.query('select id from app_private.rooms where id=$1',[other])).rows).toHaveLength(1);
});

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
