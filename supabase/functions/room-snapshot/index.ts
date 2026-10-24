import { snapshotRoomHandler } from '../_shared/room.ts';
import { rpc, serve, broadcast } from '../_shared/server.ts';
serve(snapshotRoomHandler(rpc,broadcast), 'GET, OPTIONS');
