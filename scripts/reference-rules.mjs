// Read-only prompt reminder; never stores prompts or injects the full rules document.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  const input = JSON.parse(readFileSync(0, 'utf8'));
  const cwd = resolve(input.cwd || process.cwd());
  const child = relative(root, cwd);
  const inRepo = child === '' || (!child.startsWith('..') && !isAbsolute(child));
  // Workspace fallback is quiet inside the repo, where the portable repo hook runs.
  if ((process.argv.includes('--workspace') && inRepo) || (!process.argv.includes('--workspace') && !inRepo)) process.exit(0);
  const path = resolve(root, 'AGENTS.md');
  const hash = createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 12);
  const additionalContext = `개발·리뷰 요청이면 ${path} 규칙(v3, sha256:${hash})을 따른다. 현재 문맥에 없거나 해시가 바뀐 경우만 읽는다. 불필요한 조회·출력·재설치는 줄이고 필요한 검증·보안은 유지한다. 사용자 요청과 상위 지침을 우선한다.`;
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext } }));
} catch {
  process.stdout.write(JSON.stringify({ systemMessage: '개발 규칙 참조 훅을 읽지 못했습니다. AGENTS.md를 직접 확인해 주세요.' }));
}
