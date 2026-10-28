import { expect,it } from 'vitest';
import { canReuseGameRequest,canRetryVote } from '../../src/features/room/useRoom';
import type { RoomSnapshot } from '../../src/lib/api';
const pending = { action:'start_round', payload:{}, expected_version:3, expected_phase:'LOBBY' as const, request_id:'original' };
it('reuses the original request only while the observed state and intent match',()=>{
  expect(canReuseGameRequest(pending,pending)).toBe(true);
  expect(canReuseGameRequest(null,pending)).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,expected_version:9})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,expected_phase:'HINT'})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,action:'cancel_round'})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,payload:{round_id:'another'}})).toBe(false);
});
it('retries a concurrent vote only in the same round/ballot while still unsubmitted',()=>{
  const vote={...pending,action:'submit_vote',expected_phase:'VOTE_1' as const,payload:{round_id:'round',ballot_no:1,target_id:'target'}};
  const state=(patch:object={})=>({round:{id:'round',phase:'VOTE_1',me:{voted:false},vote:{ballot_no:1},...patch}} as unknown as RoomSnapshot);
  expect(canRetryVote(vote,state())).toBe(true);
  expect(canRetryVote(vote,undefined)).toBe(false);
  for(const patch of [{id:'other'},{phase:'VOTE_RUNOFF'},{vote:{ballot_no:2}},{vote:{ballot_no:1,cycle_no:2}},{me:{voted:true}},{me:null}])expect(canRetryVote(vote,state(patch))).toBe(false);
  expect(canRetryVote(pending,state())).toBe(false);
});
