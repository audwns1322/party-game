#!/usr/bin/env bash
# UserPromptSubmit: inject token-saving rules into context on every user instruction.
RULES="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}/docs/token-saving-rules.md"
[ -f "$RULES" ] || exit 0
echo "[작업 규칙] 지시를 처리하기 전에 아래 토큰 절약 규칙을 따른다."
cat "$RULES"
