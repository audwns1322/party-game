import { expect,it } from 'vitest';
import { canReuseGameRequest,canRetryMafiaVote,canRetryVote,mafiaSubmissionState,retryConnectionRead } from '../../src/features/room/useRoom';
import { ApiError,type RoomSnapshot } from '../../src/lib/api';
const pending = { action:'start_round', payload:{}, expected_version:3, expected_phase:'LOBBY' as const, request_id:'original' };
it('reuses the original request only while the observed state and intent match',()=>{
  expect(canReuseGameRequest(pending,pending)).toBe(true);
  expect(canReuseGameRequest(null,pending)).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,expected_version:9})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,expected_phase:'HINT'})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,action:'cancel_round'})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,payload:{round_id:'another'}})).toBe(false);
});
it('retries a mafia ballot only with its unchanged day, ballot and eligible target',()=>{
  const state=(patch:Record<string,unknown>={})=>({me:{player_id:'mine'},mafia:{id:'game',phase:'DAY_VOTE',day_no:1,
    alive_ids:['mine','target','other'],me:{alive:true,day_voted:false},...patch}} as unknown as RoomSnapshot);
  const original=state();
  expect(canRetryMafiaVote(original,'target',state())).toBe(true);
  expect(canRetryMafiaVote(original,'mine',state())).toBe(false);
  expect(canRetryMafiaVote(original,'target',undefined)).toBe(false);
  for(const patch of [{id:'different'},{phase:'DAY_RUNOFF'},{day_no:2},{me:{alive:true,day_voted:true}},
    {me:{alive:false,day_voted:false}},{alive_ids:['mine','other']}]) {
    expect(canRetryMafiaVote(original,'target',state(patch))).toBe(false);
  }
  const runoff=state({phase:'DAY_RUNOFF',day_result:{runoff_ids:['target']}});
  expect(canRetryMafiaVote(runoff,'target',runoff)).toBe(true);
  expect(canRetryMafiaVote(runoff,'other',runoff)).toBe(false);
});
it('retries a concurrent vote only in the same round/ballot while still unsubmitted',()=>{
  const vote={...pending,action:'submit_vote',expected_phase:'VOTE_1' as const,payload:{round_id:'round',ballot_no:1,target_id:'target'}};
  const state=(patch:object={})=>({round:{id:'round',phase:'VOTE_1',me:{voted:false},vote:{ballot_no:1},...patch}} as unknown as RoomSnapshot);
  expect(canRetryVote(vote,state())).toBe(true);
  expect(canRetryVote(vote,undefined)).toBe(false);
  for(const patch of [{id:'other'},{phase:'VOTE_RUNOFF'},{vote:{ballot_no:2}},{vote:{ballot_no:1,cycle_no:2}},{me:{voted:true}},{me:null}])expect(canRetryVote(vote,state(patch))).toBe(false);
  expect(canRetryVote(pending,state())).toBe(false);
});

it('retries an authenticated mafia submission only within the exact same step',()=>{
  const state=(patch:Record<string,unknown>={})=>({me:{player_id:'mine'},mafia:{id:'game',phase:'NIGHT',night_no:2,day_no:1,
    alive_ids:['mine','target','other'],me:{role:'doctor',alive:true,night_submitted:false,teammate_ids:[]},...patch}} as unknown as RoomSnapshot);
  const before=state();
  expect(mafiaSubmissionState(before,'mafia_night_action',{target_id:'mine'},state())).toBe('retry');
  expect(mafiaSubmissionState(before,'mafia_night_action',{target_id:'target'},state({night_no:3}))).toBe('changed');
  expect(mafiaSubmissionState(before,'mafia_night_action',{target_id:'target'},state({me:{role:'doctor',alive:true,night_submitted:true}}))).toBe('done');
  expect(mafiaSubmissionState(before,'mafia_night_action',{target_id:'target'},state({alive_ids:['mine','other']}))).toBe('changed');
  const vote=state({phase:'DAY_VOTE',me:{alive:true,day_voted:false}});
  expect(mafiaSubmissionState(vote,'mafia_day_vote',{target_id:'target'},state({phase:'DAY_RUNOFF',me:{alive:true,day_voted:true}}))).toBe('changed');
  expect(mafiaSubmissionState(vote,'mafia_day_vote',{target_id:'target'},state({phase:'DAY_VOTE',me:{alive:true,day_voted:true}}))).toBe('done');
  const ack=state({phase:'REVEAL_ROLE',me:{acknowledged:false}});
  expect(mafiaSubmissionState(ack,'mafia_ack',{},state({phase:'REVEAL_ROLE',me:{acknowledged:true}}))).toBe('done');
});
it('retries transient read failures once but does not retry authorization errors',async()=>{
  let calls=0,waits=0;
  const request=async()=>{calls+=1;if(calls===1)throw new ApiError('NETWORK',0);return 4;};
  expect(await retryConnectionRead(request,async()=>{waits+=1;})).toBe(4);
  expect([calls,waits]).toEqual([2,1]);
  calls=0;
  await expect(retryConnectionRead(async()=>{calls+=1;throw new ApiError('FORBIDDEN',403);},async()=>{waits+=1;})).rejects.toThrow('FORBIDDEN');
  expect([calls,waits]).toEqual([1,1]);
});
