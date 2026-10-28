import { expect,it,vi } from 'vitest';
import { gameCommandHandler } from '../../supabase/functions/_shared/game';
const valid = {room_id:'00000000-0000-4000-8000-000000000001',request_id:'00000000-0000-4000-8000-000000000002',action:'start_round',payload:{},expected_phase:'LOBBY',expected_version:1};
const req = (body:string,token='a'.repeat(64))=>new Request('https://test.invalid',{method:'POST',headers:{Authorization:`Bearer ${token}`},body});
it('rejects unauthenticated/malformed/oversized and invalid command fields before database access',async()=>{
  const rpc=vi.fn(); const run=gameCommandHandler(rpc,vi.fn());
  expect((await run(req(JSON.stringify(valid),'wrong'))).status).toBe(401);
  for(const body of ['{','x'.repeat(4097),'null',JSON.stringify({...valid,payload:[]}),JSON.stringify({...valid,request_id:'bad'}),JSON.stringify({...valid,expected_version:0}),JSON.stringify({...valid,expected_phase:'UNKNOWN_PHASE'})]) expect((await run(req(body))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it('rejects malformed vote payloads before database access',async()=>{
  const rpc=vi.fn();const run=gameCommandHandler(rpc,vi.fn());
  const payload={round_id:valid.room_id,ballot_no:1,target_id:valid.request_id};
  for(const bad of [{...payload,round_id:{}},{...payload,ballot_no:'1'},{...payload,ballot_no:3},{...payload,target_id:{}},{...payload,target_id:'bad'}])expect((await run(req(JSON.stringify({...valid,action:'submit_vote',expected_phase:'VOTE_1',payload:bad})))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it('returns 400 for object-shaped identifiers instead of treating coercion failures as server errors',async()=>{
  const rpc=vi.fn();const run=gameCommandHandler(rpc,vi.fn());
  for(const field of ['room_id','request_id'])expect((await run(req(JSON.stringify({...valid,[field]:{toString:null}})))).status).toBe(400);
  expect(rpc).not.toHaveBeenCalled();
});
it('maps unexpected database failure to a safe error and never broadcasts',async()=>{
  const broadcast=vi.fn();const run=gameCommandHandler(async()=>{throw Error('secret database text');},broadcast);
  const response=await run(req(JSON.stringify(valid)));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'TEMPORARILY_UNAVAILABLE'});expect(broadcast).not.toHaveBeenCalled();
});
