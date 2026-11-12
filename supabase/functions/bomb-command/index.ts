import { bombHandler } from '../_shared/bomb.ts';
import { broadcast, rpc, serve } from '../_shared/server.ts';
serve(bombHandler(rpc,broadcast),'POST, OPTIONS');
