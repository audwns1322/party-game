import { commandHandler } from '../_shared/room.ts';
import { broadcast, rpc, serve } from '../_shared/server.ts';
serve(commandHandler(rpc, broadcast), 'POST, OPTIONS');
