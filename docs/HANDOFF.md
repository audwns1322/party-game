# HANDOFF (2026-10-28)

## 공개/로컬 상태
- main의 M5 기준은 PR #8 merge `264bc3c`. 현재 작업 `codex/m6-resilience`: M6 끊김 정지/복귀·방장 위임·예약 정리까지 구현·원격·데스크톱 검증 완료. main 통합과 공개 배포는 이 브랜치의 PR에서 관리한다. 최신 병합/배포 상태는 GitHub/Vercel 확인.
- 개발 DB는 M6 `20261028091227_m6_resilience`까지 적용, game-command v6·player-recover v4 배포 완료. 공개 사이트 `https://party-game-psi-pink.vercel.app`.
- 사용자 확정: 두 라이어를 모두 잡아야 시민 승리. 오답 확정 라이어 탈락 후 생존자 추가 토론/투표. 지목 라이어 정답이면 라이어 팀 전체 승리, 시민 오지목도 라이어 팀 승리.
- 단위 26 + SQL/핸들러 112 = 138개, 실제 M6 원격 14개 통과. build·lint·7개 Edge 타입 통과. 데스크톱 실제 끊김→유예→추가 기다림→자동 재개 확인. 상세 `M6_VALIDATION.md`, 이전 M5 검증은 `M5_VALIDATION.md`.

## 환경 해결/다음 작업
- 브라우저 GitHub `MyeongjunKim1`(Gmail) 계정은 다른 조직이라 개발 프로젝트 권한이 없었다. 로그아웃 후 GitHub `audwns1322`로 로그인해 party-game-dev 정상 접근. 이 프로젝트는 조직 `vikiiumpaxcuzoekgaxj` 소속이다.
- apply_migration 도구의 `Invalid or expired requestState`는 로그인 문제와 별개로 남아 있다. 공식 SQL Editor에서 migration+이력을 단일 트랜잭션으로 적용 후 재조회 확인했다. 파일/원격 버전은 M5 `20261028061221`, `20261028061939`, M6 `20261028091227`로 동일. 재적용하지 않는다. Edge 배포 도구는 정상 동작.
- 사용자 승인으로 기존 종료·만료 방 13개를 삭제했다. pg_cron `party-game-maintenance`는 5초 간격 active, 실제 성공 실행·실패 0개 확인. M6 테스트 방 2개도 종료 후 예약 삭제, 잔여 0개. Cron을 중복 설치하거나 기록을 복원하지 않는다.
- 원격 재현 스크립트 `tests/integration/m6-remote.mjs`, UUID만 담은 중복 실행 방지 원장은 `.cache/m6-remote-rooms.json`. token/복구 코드 원문은 파일/로그에 기록하지 않는다.
- 사용자에게 M6 결과를 보고하고 다음 단계 승인을 기다린다. M7 운영 QA·마피아는 시작하지 않는다.

## 보류와 주의
- 모바일 실기기·다중 기기 인수 및 시민 판정 버튼 직접 조작 미완료(서버 시민 판정은 원격 검사 통과). 사용자 보류: 모바일 3대 M1 확인, 대기실 문구 재검토. 구현 후 필요한 것을 물으면 다시 안내.
- M6는 기존 10초 heartbeat·30초 무응답 확정 + 복귀 유예 30초다. Presence는 신뢰하지 않는 빈 payload 재조회 신호. 실제 손실 즉시 확정을 보장하지 않는다. 물리 기기 전환·절전/비행기 모드 인수는 남아 있다.
- 탈락자는 같은 방 관전만 하며 표/후보에서 제외. 활성 판의 퇴장/강퇴·설정 변경은 기존처럼 먼저 판 취소.
- 점수는 round_results 유일 키로 한 번만 확정. 과거 확정 승수는 코드 rollback이 되돌리지 않는다.
- rollback은 m6→m5→capacity→m4→themes→m3→m2. 활성 판/확대된 기록이 있으면 안내에 따라 먼저 종료/백업한다. 삭제 기록은 rollback으로 복원하지 못한다. 실제 원격 rollback은 미실행.
- M0 변경은 `codex-m0-local-preserved-before-m2-20261024` stash 보존.

## 환경
- Node 24, 기존 의존성 재사용. `.env.local` Git 제외. 비밀 키는 Edge만. Docker 재설치 없음.
- `npm run test`, `test:sql`, `lint`, `typecheck:edge`, `build`.
- CLI `SUPABASE_HOME`은 workspace `.cache/supabase`. 요청 훅 신뢰 승인은 아직 확인하지 않음.
