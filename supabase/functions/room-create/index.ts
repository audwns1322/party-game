import { createRoomHandler } from '../_shared/room.ts';
import { broadcast, rpc, serve } from '../_shared/server.ts';
serve(createRoomHandler(rpc, broadcast), 'POST, OPTIONS');
