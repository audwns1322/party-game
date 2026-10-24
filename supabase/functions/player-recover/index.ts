import { recoverHandler } from '../_shared/room.ts';
import { rpc, serve } from '../_shared/server.ts';
serve(recoverHandler(rpc), 'POST, OPTIONS');
