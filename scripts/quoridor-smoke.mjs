// Run against a deployed Supabase project using independent credential tokens.
// Required: SUPABASE_TEST_URL, SUPABASE_TEST_PUBLIC_KEY (publishable, never service_role).
import assert from 'node:assert/strict';
import console from 'node:console';
const base=process.env.SUPABASE_TEST_URL;
const key=process.env.SUPABASE_TEST_PUBLIC_KEY;
if(!base||!key) throw new Error('Set SUPABASE_TEST_URL and SUPABASE_TEST_PUBLIC_KEY');
let serial=0;
async function call(path,body,token) {
  const response=await fetch(`${base}/functions/v1/${path}`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(`${path} ${response.status}: ${JSON.stringify(result)}`);
  return result;
}
const name=()=>`QA검증${++serial}`;
const create=(type='quoridor')=>call('room-create',{nickname:name(),game_type:type});
const join=room=>call('room-join',{room_code:room.code,nickname:name()});
const snapshot=(player,action='snapshot',payload={},version)=>call('quoridor-command',{room_id:player.room_id,action,payload,expected_version:version},player.token);

const host=await create();const guest=await join(host);
let h=await snapshot(host),g=await snapshot(guest);
assert.equal(h.state.status,'lobby');assert.equal(g.players.length,2);
assert.equal(h.version,g.version);
console.log('✓ two independent phone sessions joined the same room');
h=await snapshot(host,'settings',{playerCount:2,turnLimit:0,undoEnabled:true},h.version);
h=await snapshot(host,'start',{},h.version);
assert.equal(h.state.status,'playing');
g=await snapshot(guest);
assert.equal(g.state.game.currentPlayer,0);
assert.equal(g.state.game.turnNumber,1);
h=await snapshot(host,'move',{to:[7,4]},h.version);
g=await snapshot(guest);
assert.deepEqual(g.state.game.positions[0],[7,4]);
assert.equal(g.state.game.currentPlayer,1);
console.log('✓ first phone moved; second phone saw the same turn and position');
h=await snapshot(host,'undo',{},h.version);
g=await snapshot(guest);
assert.deepEqual(g.state.game.positions[0],[8,4]);
assert.equal(g.state.game.currentPlayer,0);
console.log('✓ server-authoritative undo synchronized');
await snapshot(host,'wall',{wall:{r:4,c:4,vertical:false}},h.version);
g=await snapshot(guest);
assert.equal(g.state.game.walls.length,1);
assert.equal(g.state.game.currentPlayer,1);
console.log('✓ wall placement synchronized and turn advanced');
await snapshot(guest,'move',{to:[1,4]},g.version);
h=await snapshot(host);
assert.deepEqual(h.state.game.positions[1],[1,4]);
console.log('✓ second phone moved; first phone saw the result');

const four=await create();const others=await Promise.all([join(four),join(four),join(four)]);
let f=await snapshot(four);
f=await snapshot(four,'settings',{playerCount:4,turnLimit:5,undoEnabled:false},f.version);
f=await snapshot(four,'start',{},f.version);
assert.equal(f.state.seats.length,4);
assert.equal(f.state.game.wallsRemaining.length,4);
assert.equal((await snapshot(others[2])).state.game.currentPlayer,0);
assert.ok(f.state.deadlineAt);
console.log('✓ four independent sessions, 5-second match timer and board initialized');

for(const type of ['liar','mafia']) {
  const legacy=await create(type);
  const joined=await join(legacy);
  const response=await fetch(`${base}/functions/v1/room-snapshot?room_id=${legacy.room_id}`,{headers:{apikey:key,Authorization:`Bearer ${joined.token}`}});
  assert.equal(response.status,200);
  const result=await response.json();
  assert.equal(result.room.game_type,type);
  assert.equal(result.players.length,2);
  console.log(`✓ existing ${type} room create/join/snapshot still works`);
}

console.log('PASS: multiplayer production smoke test');
