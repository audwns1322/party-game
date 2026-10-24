# 토큰 절약 작업 규칙 v3

기준 문서는 저장소 루트의 [AGENTS.md](../AGENTS.md)다. Ponytail과 v2 검토 결과를 통합했으며 Codex·Claude가 같은 규칙을 사용한다.

- Codex 작업 진입점: 루트 AGENTS.md. 현재 프로젝트리스 작업 폴더의 AGENTS.md도 이 저장소 문서로 연결한다.
- Claude 작업 진입점: CLAUDE.md에서 같은 AGENTS.md를 참조한다.
- 프로젝트 상태·환경·보류 사항: [HANDOFF.md](HANDOFF.md).

v2의 미계측 75% 주장, 무조건 새 대화, 읽은 파일 재독 금지, 실패 1회 제한, 매번 환경 설치는 공통 규칙에서 제외하거나 조건부로 수정했다. 중복 본문을 이 파일에 다시 싣지 않는다.

적용 범위는 이 저장소와 연결한 작업 폴더다. 다른 프로젝트나 계정 전체의 설정을 바꾸지 않는다. 상위 지침과 승인 정책은 그대로 적용된다.

## 매 요청 참조 훅

`.codex/hooks.json`의 UserPromptSubmit 훅은 `scripts/reference-rules.mjs`를 실행해 AGENTS.md 경로와 짧은 해시만 전달한다. 전체 본문과 사용자 프롬프트는 저장·출력하지 않는다. 현재 프로젝트리스 작업 폴더에도 fallback 훅을 두었고, 저장소 안에서는 fallback을 비워 중복 전달을 피한다.

설정·실제 Windows 명령 자체 검증: `node scripts/reference-rules.test.mjs`. 이는 Codex의 자동 실행/신뢰 승인을 대신하지 않는다. 새 훅은 사용자가 훅 검토에서 신뢰해야 실행된다(Codex CLI: `/hooks`). 현재 대화에 설정이 즉시 반영됐다고 가정하지 말고 다음 개발 요청의 실행 표시/추가 문맥으로 확인한다. 프로젝트 설정과 훅 정의만 추가하며 전역 승인 정책과 계정 설정은 바꾸지 않는다.

공식 동작: https://learn.chatgpt.com/docs/hooks
