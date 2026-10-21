import { expect, it } from 'vitest';
import { parseVersionEvent } from '../../src/lib/realtime';
it('rejects secrets, cross-room and malformed realtime data', () => {
  expect(parseVersionEvent({ room_id: 'r', version: 1 }, 'r')).toEqual({ room_id: 'r', version: 1 });
  for (const payload of [null, { room_id: 'r', version: 1, word: 'secret' }, { room_id: 'other', version: 1 }, { room_id: 'r', version: '1' }, { room_id: 'r', version: -1 }]) expect(parseVersionEvent(payload, 'r')).toBeNull();
});
