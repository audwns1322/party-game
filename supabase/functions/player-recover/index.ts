import { recoverHandler } from '../_shared/room.ts';
import { rpc, broadcast, serve } from '../_shared/server.ts';
serve(recoverHandler(rpc,broadcast), 'POST, OPTIONS');
