# HANDOFF (2026-10-29)

## 현재 점검 작업
- 최신 원격 main은 PR #9 병합 `e0a2f67`. 새 체크아웃 `work/party-game`의 `codex/fix-room-rejoin`에서 재참가 오류를 수정했으며 아래 M6 기록은 이전 작업 환경 기준이다.
- GitHub와 현재 로컬에는 `codex/mafia-mvp`, `57d2e5a`, 마피아 소스가 없다. 그러나 개발 DB `wmgpshtqqsqwgyigxcwl`에는 MAF-1 `20261029090000_mafia_lobby`, MAF-2 `20261029110000_mafia_assignment`, MAF-3 `20261029140000_mafia_night`가 모두 적용되어 있다. 소스 부재와 DB 미적용을 혼동하지 않는다. 이 migration들은 재실행하지 않는다.
- 개발 DB의 `mafia_rounds`, `mafia_round_players`, `mafia_night_actions`와 배포된 room-command v8(2026-10-29 15:42 KST)을 확인했다. 배포 소스 4개와 SQL 함수 정의 12개는 이 체크아웃의 상위 `../recovered-remote/`에 읽기 전용 증거로 회수했다. 해당 SQL은 완전한 migration이 아니며 실행 금지. 프런트엔드와 원래 테스트는 아직 회수하지 못했다. GitHub와 DB가 서로 다른 상태이므로 원본 복구 전 새 구현/덮어쓰기를 하지 않는다.
- 권한 상실 화면의 재참가 버튼이 같은 SPA 경로로 이동해 세션/오류 상태가 남는 문제를 문서 내비게이션 링크로 수정했다. 기존 세션 삭제 후 앱이 다시 초기화되어 참가 화면으로 이동한다.
- 재참가 UI 회귀 2개 추가. 단위+SQL/핸들러 총 140개, TypeScript, lint, Vite build, Edge 7개 타입 검사 통과. 실제 브라우저에서 로컬 모의 API의 403 응답 후 재참가 링크를 눌러 같은 방의 닉네임 입력 화면으로 전환됨을 확인했다. 실제 DB 인수 테스트는 아니다.
- 기존 node_modules와 Deno 캐시를 재사용했다. 기존 체크아웃/stash는 보존. 재참가 수정은 PR 검토 대상으로 정리하며 DB 변경·원격 DB 테스트·main 병합·공개 배포는 하지 않는다.

## 공개/로컬 상태
- main은 M6 PR #9 병합 `e0a2f67`. 재참가 수정은 PR #10 `https://github.com/audwns1322/party-game/pull/10`의 초안으로 미병합이다.
- 개발 DB는 위 MAF-3까지 적용되어 main보다 앞서 있다. game-command v6·player-recover v4·room-command v8. 공개 사이트 `https://party-game-psi-pink.vercel.app`의 홈은 라이어 화면이며 마피아 선택 UI는 확인되지 않았다.
- 사용자 확정: 두 라이어를 모두 잡아야 시민 승리. 오답 확정 라이어 탈락 후 생존자 추가 토론/투표. 지목 라이어 정답이면 라이어 팀 전체 승리, 시민 오지목도 라이어 팀 승리.
- 단위 26 + SQL/핸들러 112 = 138개, 실제 M6 원격 14개 통과. build·lint·7개 Edge 타입 통과. 데스크톱 실제 끊김→유예→추가 기다림→자동 재개 확인. 상세 `M6_VALIDATION.md`, 이전 M5 검증은 `M5_VALIDATION.md`.

## 환경 해결/다음 작업
- 브라우저 GitHub `MyeongjunKim1`(Gmail) 계정은 다른 조직이라 개발 프로젝트 권한이 없었다. 로그아웃 후 GitHub `audwns1322`로 로그인해 party-game-dev 정상 접근. 이 프로젝트는 조직 `vikiiumpaxcuzoekgaxj` 소속이다.
- apply_migration 도구의 `Invalid or expired requestState`는 로그인 문제와 별개로 남아 있다. 공식 SQL Editor에서 migration+이력을 단일 트랜잭션으로 적용 후 재조회 확인했다. 파일/원격 버전은 M5 `20261028061221`, `20261028061939`, M6 `20261028091227`로 동일. 재적용하지 않는다. Edge 배포 도구는 정상 동작.
- 사용자 승인으로 기존 종료·만료 방 13개를 삭제했다. pg_cron `party-game-maintenance`는 5초 간격 active, 실제 성공 실행·실패 0개 확인. M6 테스트 방 2개도 종료 후 예약 삭제, 잔여 0개. Cron을 중복 설치하거나 기록을 복원하지 않는다.
- 원격 재현 스크립트 `tests/integration/m6-remote.mjs`, UUID만 담은 중복 실행 방지 원장은 `.cache/m6-remote-rooms.json`. token/복구 코드 원문은 파일/로그에 기록하지 않는다.
- 다음 작업은 마피아 원본 프런트엔드/테스트 회수와 배포 서버 정의 대조다. DB가 이미 MAF-3 상태임을 전제로 진행한다. 이번 감사는 읽기 전용이며 MAF-3 기능 정확성을 새로 검증한 것은 아니다.

## 대화 누락 조사 및 복구 기준
- 현재 Codex 대화 `01a18609-5239-7553-a41b-d168b3b8ef60`의 로컬 원본과 기록 DB 모두 2026-10-29 14:14~16:00 KST 구간에 공백이 있다. 조사한 원본에서 compaction/rollback 이벤트는 찾지 못했다. 사용자 착오나 단순 화면 숨김으로 단정하지 않는다.
- 앱 버전 26.1021.31345, 업데이트 상태 restart_required. 내부 API 미지원 오류를 확인했지만 누락과 인과관계는 미확정이다. 진단용 DB 복사본/대화 원본은 상위 `../history-db/`에 보존했다. 실제 앱 DB를 수정하거나 초기화하지 않는다.
- 새 대화/재개 시 이 파일의 GitHub·DB 차이를 먼저 확인한다. 과거 답변의 "마피아는 미적용"을 현재 상태로 재사용하지 않는다.

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
