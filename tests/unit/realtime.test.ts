import { expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { parseVersionEvent, subscribeToRoomVersion } from '../../src/lib/realtime';
it('rejects secrets, cross-room and malformed realtime data', () => {
  expect(parseVersionEvent({ room_id: 'r', version: 1 }, 'r')).toEqual({ room_id: 'r', version: 1 });
  for (const payload of [null, { room_id: 'r', version: 1, word: 'secret' }, { room_id: 'other', version: 1 }, { room_id: 'r', version: '1' }, { room_id: 'r', version: -1 }]) expect(parseVersionEvent(payload, 'r')).toBeNull();
});
it('tracks anonymous Presence once and treats sync only as an authenticated refresh hint',async()=>{
  const handlers:Record<string,(value?:unknown)=>void>={};const track=vi.fn();const channel={on:vi.fn((kind:string,filter:{event:string},callback:(value?:unknown)=>void)=>{handlers[kind+':'+filter.event]=callback;return channel;}),subscribe:vi.fn((callback:(status:string)=>void)=>{handlers.status=callback as (value?:unknown)=>void;return channel;}),track};
  const client={channel:vi.fn(()=>channel),removeChannel:vi.fn()};const invalidate=vi.fn();const stop=subscribeToRoomVersion(client as unknown as SupabaseClient,'test-room',invalidate);
  handlers.status('SUBSCRIBED');expect(track).toHaveBeenCalledExactlyOnceWith({});expect(client.channel.mock.calls[0]).toEqual(['room:test-room',{config:{presence:{key:expect.any(String)}}}]);
  handlers['presence:sync']({forged_player:'offline'});expect(invalidate).toHaveBeenCalledTimes(2);await stop();expect(client.removeChannel).toHaveBeenCalledWith(channel);
});
