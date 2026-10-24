import { expect,it } from 'vitest';
import { canReuseGameRequest } from '../../src/features/room/useRoom';
const pending = { action:'start_round', payload:{}, expected_version:3, expected_phase:'LOBBY' as const, request_id:'original' };
it('reuses the original request only while the observed state and intent match',()=>{
  expect(canReuseGameRequest(pending,pending)).toBe(true);
  expect(canReuseGameRequest(null,pending)).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,expected_version:9})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,expected_phase:'HINT'})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,action:'cancel_round'})).toBe(false);
  expect(canReuseGameRequest(pending,{...pending,payload:{round_id:'another'}})).toBe(false);
});
