# HANDOFF (2026-10-28)

## 공개/로컬 상태
- `codex/m5-results`, PR #8 `https://github.com/audwns1322/party-game/pull/8`: 15명·라이어 1/2명 + M5 결과/정답 도전/이의 제기/승점/다시 하기 구현 및 검증 완료. main 통합과 공개 배포를 이 PR에서 관리한다. 실제 병합/배포 상태는 PR과 Vercel 상태를 확인한다.
- 개발 DB는 capacity_liars·m5_results 적용, game-command v5 배포 완료. 공개 사이트 `https://party-game-psi-pink.vercel.app`.
- 사용자 확정: 두 라이어를 모두 잡아야 시민 승리. 오답 확정 라이어 탈락 후 생존자 추가 토론/투표. 지목 라이어 정답이면 라이어 팀 전체 승리, 시민 오지목도 라이어 팀 승리.
- 단위 22 + SQL/핸들러 92 = 114개, 실제 원격 15개 통과. 타입 포함 build·lint·모든 Edge 타입 통과. 데스크톱 정답 도전→이의 제기/시민 판정→결과/승점→다시 하기 UI, 비밀 없는 Realtime 알림 19개 확인. 상세 `M5_VALIDATION.md`.

## 환경 해결/다음 작업
- 브라우저 GitHub `MyeongjunKim1`(Gmail) 계정은 다른 조직이라 개발 프로젝트 권한이 없었다. 로그아웃 후 GitHub `audwns1322`로 로그인해 party-game-dev 정상 접근. 이 프로젝트는 조직 `vikiiumpaxcuzoekgaxj` 소속이다.
- apply_migration 도구의 `Invalid or expired requestState`는 로그인 문제와 별개로 남아 있다. 공식 SQL Editor에서 각 migration+이력을 단일 트랜잭션으로 적용 후 재조회 확인했다. 파일/원격 이력 버전은 `20261028061221`, `20261028061939`로 동일. 재적용하지 않는다. Edge 배포 도구는 정상 동작.
- 테스트 전용 방 3개 정상 종료, 활성 테스트 방 0개. 닫힌 기록은 보존(삭제 도구도 만료 오류). 원격 재현 스크립트 `tests/integration/m5-remote.mjs`, UUID만 담은 중복 실행 방지 원장은 `.cache/m5-remote-rooms.json`.
- 사용자에게 M5 검증 결과를 보고하고 다음 단계 승인을 기다린다. M6·마피아는 시작하지 않는다.

## 보류와 주의
- 모바일 실기기·다중 기기 인수 및 시민 판정 버튼 직접 조작 미완료(서버 시민 판정은 원격 검사 통과). 사용자 보류: 모바일 3대 M1 확인, 대기실 문구 재검토. 구현 후 필요한 것을 물으면 다시 안내.
- M6 자동 단절 정지·위임·만료 정리와 마피아는 미착수. 이번 범위는 정원/라이어 수와 M5까지.
- 탈락자는 같은 방 관전만 하며 표/후보에서 제외. 활성 판의 퇴장/강퇴·설정 변경은 기존처럼 먼저 판 취소.
- 점수는 round_results 유일 키로 한 번만 확정. 과거 확정 승수는 코드 rollback이 되돌리지 않는다.
- rollback은 m5→capacity→m4→themes→m3→m2. 확대된 기록이 있으면 백업/정리 전 rollback 거부. 실제 원격 미실행.
- M0 변경은 `codex-m0-local-preserved-before-m2-20261024` stash 보존.

## 환경
- Node 24, 기존 의존성 재사용. `.env.local` Git 제외. 비밀 키는 Edge만. Docker 재설치 없음.
- `npm run test`, `test:sql`, `lint`, `typecheck:edge`, `build`.
- CLI `SUPABASE_HOME`은 workspace `.cache/supabase`. 요청 훅 신뢰 승인은 아직 확인하지 않음.
