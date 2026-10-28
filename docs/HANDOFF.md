# HANDOFF (2026-10-28)

## 현재 상태
- main 기반은 단어 확장 PR #6(`a5dfb6e`), 9개 테마×30개=270단어. 공개 주소 https://party-game-psi-pink.vercel.app.
- 후속 `codex/m4-voting`: 비밀 투표·자동 집계·공동 1위 재투표 1회·재동률 무승부/승점 없음·대기실 복귀 구현. 비동률은 REVEAL_VOTE에서 M5 연결 대기.
- 단위 22 + SQL/실제 핸들러 73 = 95개, 타입 포함 build·lint·모든 Edge 타입 통과. 실제 개발 Supabase 원격 11개(3/6/12명) 통과. 상세 `M4_VALIDATION.md`.
- 개발 migration `20261028055003_m4_voting`, game-command v4 적용. 개인 표는 private votes 테이블만 저장하며 공개 DTO/Broadcast에는 표 연결을 포함하지 않는다. 진행 중 득표도 숨김.

## 다음 작업과 보류
- M4 PR·공개 배포 상태는 GitHub에서 확인. M5 역할 공개/정답 도전/이의 제기/정식 승점·마피아는 아직 미착수.
- M3 기능 구현 완료, 모바일 실기기·다중 기기 인수 미완료. M4도 실기기 인수는 별도.
- 사용자 보류: 모바일 3대 M1 인수 확인, 대기실 안내 문구 최종 재검토. 구현 후 필요한 것을 물으면 다시 안내한다.
- 개발 규칙 `AGENTS.md`. 요청 훅은 설정되어 있으나 실제 자동 실행은 사용자 신뢰 승인 후 확인한다.

## 주의
- 현재 판 참가자 퇴장/강퇴·설정 변경은 먼저 판 취소. 단절 참가자도 투표 전원 조건에 포함하며 자동 기권 없음. 자동 단절 정지/위임은 M6.
- M4 DRAW는 FINAL_RESULT+ended_at로 즉시 종료, 승점 없음. 결과에서 방장 return_lobby로 복귀. 비동률은 현재 판 취소로 대기실 복귀 가능하며 정식 결과/승점은 M5.
- 직접 입력은 방장 테마 필수·기본 라이어·1인 1단어. 혼선 라이어는 기본 제시어에서 이지/하드.
- 토론 서버 기한은 인증 snapshot/heartbeat로 확정. 기한 전 종료는 방장 skip_timer:true. 타이머 0에서 클라이언트가 임의 전환하지 않는다.
- rollback: `m4.sql` → `themes_word_modes.sql` → 필요시 `m3.sql` → `m2.sql`. 관리자만 활성 판 취소/무승부 대기실 복귀 후 실행. 실제 원격 rollback 미실행.
- M0 변경은 `codex-m0-local-preserved-before-m2-20261024` stash 보존, 무작정 pop 금지.

## 환경
- Node 24, 설치 의존성 재사용. `.env.local` Git 제외, 비밀 키는 Edge 런타임에만. Docker 재설치 없이 PGlite + 개발 원격.
- `npm run typecheck`, `lint`, `test`, `test:sql`, `typecheck:edge`, `build`.
- `M4_REMOTE_PROJECT=wmgpshtqqsqwgyigxcwl` 후 `node tests/integration/m4-remote.mjs`. `.cache/m4-remote-rooms.json` 잔여 시 UUID 방 정리부터 확인.
- CLI는 `SUPABASE_HOME`을 workspace `.cache/supabase`로 지정.
