# HANDOFF (2026-10-28)

## 공개/로컬 상태
- 공개 main은 M4 PR #7 `bfc2012`, 270단어·테마·혼선·투표/재투표/무승부까지. 최대 12명·라이어 1명.
- 로컬 `codex/m5-results`: 15명·라이어 1/2명 + M5 결과/정답 도전/이의 제기/승점/다시 하기 구현. 아직 원격 적용·공개 배포 전.
- 사용자 확정: 두 라이어를 모두 잡아야 시민 승리. 오답 확정 라이어 탈락 후 생존자 추가 토론/투표. 지목 라이어 정답이면 라이어 팀 전체 승리, 시민 오지목도 라이어 팀 승리.
- 단위 22 + SQL/핸들러 92 = 114개 통과. 타입 포함 build·lint·모든 Edge 타입 통과. 상세 `M5_VALIDATION.md`.

## 차단/다음 작업
- Supabase 조회는 성공하나 apply_migration 요청이 3회 `Invalid or expired requestState`(SQL 실행 전)로 실패. 사용자는 승인 요청 화면이 보이지 않는다고 답했다. 연결/승인 경로 재인증 또는 대시보드 접근 확인이 필요하다.
- 미적용 migration: `20261028061221_capacity_liars.sql`, `20261028061939_m5_results.sql`. 재연결 후 이력 먼저 확인하고 중복 없이 순서대로 적용. game-command 새 액션 배포, 실제 15명·두 번 탈락/정답/이의 제기 원격 검증과 UI 인수 후 main 반영.
- 공개 M4까지의 과거 테스트/배포는 `M4_VALIDATION.md`. 이번 15명/M5의 원격 성공으로 혼동하지 않는다.

## 보류와 주의
- M3/4 모바일 실기기·다중 기기 인수 미완료. 사용자 보류: 모바일 3대 M1 확인, 대기실 문구 재검토. 구현 후 필요한 것을 물으면 다시 안내.
- M6 자동 단절 정지·위임·만료 정리와 마피아는 미착수. 이번 범위는 정원/라이어 수와 M5까지.
- 탈락자는 같은 방 관전만 하며 표/후보에서 제외. 활성 판의 퇴장/강퇴·설정 변경은 기존처럼 먼저 판 취소.
- 점수는 round_results 유일 키로 한 번만 확정. 과거 확정 승수는 코드 rollback이 되돌리지 않는다.
- rollback은 m5→capacity→m4→themes→m3→m2. 확대된 기록이 있으면 백업/정리 전 rollback 거부. 실제 원격 미실행.
- M0 변경은 `codex-m0-local-preserved-before-m2-20261024` stash 보존.

## 환경
- Node 24, 기존 의존성 재사용. `.env.local` Git 제외. 비밀 키는 Edge만. Docker 재설치 없음.
- `npm run test`, `test:sql`, `lint`, `typecheck:edge`, `build`.
- CLI `SUPABASE_HOME`은 workspace `.cache/supabase`. 요청 훅 신뢰 승인은 아직 확인하지 않음.
