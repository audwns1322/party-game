import { recoverHandler } from '../_shared/room.ts';
import { broadcast, rpc, serve } from '../_shared/server.ts';
serve(recoverHandler(rpc, broadcast), 'POST, OPTIONS');
