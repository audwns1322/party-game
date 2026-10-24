import { snapshotRoomHandler } from '../_shared/room.ts';
import { rpc, serve } from '../_shared/server.ts';
serve(snapshotRoomHandler(rpc), 'GET, OPTIONS');
