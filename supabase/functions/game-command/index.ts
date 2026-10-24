import { gameCommandHandler } from '../_shared/game.ts';
import { broadcast, rpc, serve } from '../_shared/server.ts';
serve(gameCommandHandler(rpc,broadcast), 'POST, OPTIONS');
