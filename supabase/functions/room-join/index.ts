import { joinRoomHandler } from '../_shared/room.ts';
import { broadcast, rpc, serve } from '../_shared/server.ts';
serve(joinRoomHandler(rpc, broadcast), 'POST, OPTIONS');
