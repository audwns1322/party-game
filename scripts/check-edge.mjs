import { readdirSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
const files = readdirSync('supabase/functions').map(name => `supabase/functions/${name}/index.ts`).filter(existsSync);
const result = spawnSync(process.execPath, ['node_modules/deno/bin.cjs','check','--node-modules-dir=manual',...files], {
  stdio:'inherit', env:{...process.env,DENO_DIR:process.env.DENO_DIR || resolve('.cache/deno')},
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
