import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = fileURLToPath(new URL('./reference-rules.mjs', import.meta.url));
const invoke = (cwd, args = [], raw) => {
  const result = spawnSync(process.execPath, [script, ...args], { cwd: root, input: raw ?? JSON.stringify({ cwd, prompt: 'private-prompt-must-not-be-echoed' }), encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.ok(!result.stdout.includes('private-prompt-must-not-be-echoed'));
  return result.stdout;
};
const output = JSON.parse(invoke(root));
assert.equal(output.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
const hash = createHash('sha256').update(readFileSync(new URL('../AGENTS.md', import.meta.url))).digest('hex').slice(0, 12);
assert.ok(output.hookSpecificOutput.additionalContext.includes(hash));
assert.ok(!output.hookSpecificOutput.additionalContext.includes('## 시작과 범위'));
assert.equal(invoke(root, ['--workspace']), '');
assert.equal(invoke(fileURLToPath(new URL('../../../', import.meta.url))), '');
assert.ok(JSON.parse(invoke(fileURLToPath(new URL('../../../', import.meta.url)), ['--workspace'])).hookSpecificOutput);
assert.ok(JSON.parse(invoke(root, [], '{bad')).systemMessage);
if (process.platform === 'win32') {
  const config = JSON.parse(readFileSync(new URL('../.codex/hooks.json', import.meta.url), 'utf8'));
  const command = config.hooks.UserPromptSubmit[0].hooks[0].commandWindows;
  const prefix = 'powershell.exe -NoProfile -Command "';
  assert.ok(command.startsWith(prefix) && command.endsWith('"'));
  const configured = spawnSync('powershell.exe', ['-NoProfile', '-Command', command.slice(prefix.length,-1)], {
    cwd: root, input: JSON.stringify({ cwd: root, prompt: '코드 수정' }), encoding: 'utf8',
  });
  assert.equal(configured.status,0,configured.stderr);
  assert.equal(JSON.parse(configured.stdout).hookSpecificOutput.hookEventName,'UserPromptSubmit');
}
process.stdout.write('Hook checks passed: scope, deduplication, document hash, short output, prompt privacy, invalid input.\n');
