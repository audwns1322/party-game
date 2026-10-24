# M2 검증 — 2026-10-24

M2 구현·개발 원격 검증 완료. M3는 시작하지 않았다. 공개 사이트의 main 병합은 별도다.

## 후속 검토 및 보완 — 2026-10-24

기준 `baba411`을 PRD/구현 계획과 대조했다. 기존 53개 검사는 통과했지만 다음 결함이 추가 재현됐으며 M3 대신 M2 보완을 먼저 수행했다.

| 발견 | 영향 | 처리 |
| --- | --- | --- |
| P2: 클라이언트 pending 요청을 action/payload만으로 재사용 | 응답 유실 후 다른 탭에서 상태가 바뀌면 새 시작/취소가 예전 요청의 성공 결과를 재생해 동작하지 않을 수 있음 | 방 version·phase·payload·action이 모두 같은 미확정 요청만 재사용. 다른 상태는 새 request_id |
| P2: DB 배정 검사가 참가자 테이블의 NEW round_id만 확인 | 관리자 SQL/향후 코드에서 참가자 없는 활성 판 생성, 참가자를 종료된 판으로 옮기며 원래 활성 판의 배정을 깨뜨리는 변경 허용 | rounds INSERT/UPDATE 지연 검사 추가, 참가자 이동의 OLD/NEW 양쪽 검사 |
| P2: 원격 동시 시작 테스트가 첫 번째 요청 승리 때만 replay 검사 | 두 번째 요청이 승리하면 멱등 검사를 건너뛰고도 통과 | 승자 요청 ID를 보존해 항상 replay 검사 |

추가로 객체형 room_id/request_id가 문자열 강제 변환 오류로 503이 되던 입력 검증을 400으로 수정했다. 이 검토는 타인 비밀 접근 경로와 상태/배정/재시도 경계를 확인했으며 실기기 인수나 모든 네트워크 장애 조합을 검증한 것은 아니다.

- 새 DB 재현 2개와 클라이언트 요청 재사용 재현 1개는 수정 전 실패, 수정 후 통과.
- 최종 로컬: 단위 20 + SQL/핸들러 37 = 57개 통과. 타입·린트·전체 Edge 타입·빌드 통과.
- 수정된 실제 개발 원격 10개 검사 통과. 추가 관리자 트랜잭션에서 빈 활성 판 거부를 확인한 후 전체 rollback, 기존 활성 판 중 잘못된 배정 0건 확인.
- 추가 migration `20261024133903_m2_assignment_invariants` 및 game-command v2를 개발 프로젝트에 적용. 기존 migration은 수정하지 않았다. 이번 원격 검사에서 만든 방 3개는 종료·삭제 후 잔여 0 확인.
- Security Advisor는 private 기본 거부의 RLS 정책 없음 INFO만 10건이며 WARN/ERROR 없음.
- 보류한 두 항목은 유지. M3 미착수, main 미병합. 아래는 초기 구현 때의 기록이다.

## 구현
- private `rounds`, `round_players`, `round_secrets`, `word_candidates`, `command_receipts` 및 기본 단어 5분류×15개.
- 방장만 3~12명으로 시작. 모든 참가자가 최근 30초 내 접속해야 한다. 방 행 잠금, 단일 활성 판 partial unique index, 정확히 한 라이어/3~12명 deferred constraint.
- 암호학적 UUID 무작위 정렬로 라이어와 발언 순서를 각각 독립 선정한다. 공개 순서에서 라이어를 유추할 수 없게 했다.
- `LOBBY → COLLECT_WORDS(직접 입력만) → REVEAL_ROLE → HINT`. 배정은 한 트랜잭션에서 완료하므로 ASSIGNING을 외부에 노출하지 않는다.
- 직접 입력: 1인 1회, 공백 제외 2~30자/NFC, 제어·비가시 문자 거부. 전원 제출 후 시민 후보에서만 선택. 후보 제출 중 역할 미공개.
- 공개 roster에는 다른 사람의 역할·단어·후보 없음. 본인만 자기 역할을 보고 라이어 word는 항상 null. 중간 입장자는 waiting_next_round 및 round.me=null.
- `game-command` Edge: 자체 참가자 토큰 SHA-256 검증, 방/단계/버전/요청 ID 검증. expected_version은 기존 M1과 같은 방 version이며, 라운드 자체 version도 별도로 증가한다. 해당 판 id는 submit_word/ack_role payload에 바인딩한다.
- 동일 player/request_id + 동일 요청은 저장된 공개 결과만 재생하고 변경/중복 Broadcast 없음. 요청 내용을 바꾸면 409. 네트워크 재시도는 원래 버전/요청 ID를 재사용한다.
- 이벤트에는 room_id/version만 전송. HTTP 재조회가 권위이며 낮은 버전의 늦은 응답은 무시한다.
- 기존 대기실 경로에서 역할 확인 패널 표시, 누르는 동안만 역할 표시, release/cancel/blur/visibilitychange에 가림. 전원 확인 후 HINT 진입.
- 방장은 점수 없이 판을 취소할 수 있다. M2에서는 현재 판 참가자의 퇴장·강퇴·설정 변경은 취소 후 가능하고, 다음 판 대기자는 퇴장 가능하다. 자동 단절/재개 정책은 M6에서 구현한다.

## 초기 구현 검증 근거
| 검사 | 결과 |
| --- | --- |
| 프런트/공유 TS, 전체 Edge Deno 타입, ESLint, Vite build | 통과 |
| 단위 | 18개 통과 |
| PGlite SQL/실제 핸들러 통합 | 35개 통과 (기존 M0 3, M1 회귀 15, M2 17) |
| 원격 Edge HTTP + PostgreSQL + 서버 Broadcast | 10개 검사 통과 |
| 실제 원격 3명/12명 | 정확히 라이어 1명, 시민만 단어 수신 |
| 실제 동시 시작 | 두 요청 중 200 하나, 409 하나 |
| 동일 요청 재시도 | 같은 version 반환, 새 판 없음 |
| 중간 입장 | 역할 없음, ack 거부 |
| 원격 직접 입력 | 라이어 후보 제외, 전원 ack 후 HINT |
| 브라우저 (localhost 프런트 + 개발 Supabase) | 3명에서 시작 활성화, 역할 확인 화면, 확인 1/3 반영, 판 취소 후 대기실 복귀, 방 종료 |
| 화면 가림 | 키 입력을 놓은 뒤 역할/단어가 DOM에 없는 상태 확인. 누르는 중 화면 캡처와 iOS/Android 터치 실기기 확인은 미검증 |
| 테스트 정리 | 이번 실행 생성 방 4개만 종료·삭제, 잔여 0 확인. 사용자 방 562142 변경 없음 |

Security Advisor: WARN/ERROR 없음. private 기본 거부 모델의 RLS 정책 없음 INFO 10건. Performance Advisor의 FK 인덱스 누락은 보완했으며 남은 것은 신규 인덱스 미사용 INFO다. [RLS 안내](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [인덱스 안내](https://supabase.com/docs/guides/database/database-linter?lint=0005_unused_index).

## 개발 배포 및 재현
- 대상은 party-game-dev / wmgpshtqqsqwgyigxcwl만 사용. 운영 프로젝트/사용자 기존 방은 변경하지 않았다.
- 원격과 로컬 migration 버전: `20261024130245_m2_rounds`, `20261024130708_m2_fk_indexes`. MCP가 부여한 버전으로 로컬 이름을 맞춘다. 이전 M1 이력은 그대로 유지했다.
- game-command v1, room-command/room-snapshot/room-join v4를 개발 프로젝트에 배포했다. service_role은 Edge 런타임 제공 값만 사용하며 로컬/프런트로 복사하지 않는다.
- `npm ci`, `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:sql`, `npm run typecheck:edge`, `npm run build`.
- Windows Edge 검사를 위해 셸 glob/환경변수 구문을 Node 래퍼로 교체했다. Docker는 설치/기동하지 않았다.
- 원격 테스트: PowerShell `$env:M2_REMOTE_PROJECT='wmgpshtqqsqwgyigxcwl'` 후 `node tests/integration/m2-remote.mjs`. 공개 URL/key가 설정된 Git 제외 .env.local 필요. 스크립트는 최대 3개의 일회성 방을 만들고 finally에서 종료한다. 생성 UUID만 `.cache/m2-remote-rooms.json`에 남기며 재실행 전 관리 SQL로 해당 방만 정리/0행 확인하고 ledger를 제거한다. 잔여 ledger가 있으면 새 픽스처를 덮어쓰지 않는다. 키·참가 토큰은 출력하지 않는다.
- 로컬 Vite로 화면을 확인했고 공개 Vercel frontend는 아직 main의 M1이다. 공개 사이트에서 게임 시작을 보려면 PR 검토·main 병합/배포가 필요하다.

## 되돌리기 및 후속 범위
M2 frontend를 이전 커밋으로 되돌리면 기존 M1 클라이언트는 추가 round 필드를 무시한다. 개발 DB 완전 되돌리기가 필요하면 먼저 모든 활성 판을 안전하게 취소하고 백업한 뒤 `supabase/rollback/m2.sql`을 관리자 권한으로 검토·실행한다. 이 스크립트는 M2 데이터 삭제를 포함하므로 이번에는 실행하지 않았다. 이후 CLI의 migration repair로 M2 두 버전만 reverted 처리하고 구버전 Edge를 재배포해야 하며, PGlite에서 rollback 후 M1 service-role API 복구를 검증했다. 원격 되돌리기는 실행하지 않았다.

보류(사용자 요청): ① 모바일 3대 M1 인수 확인 ② 대기실 안내 문구 최종 재검토. 추후 사용자가 구현 후 필요한 것을 물으면 다시 안내한다. 이번 M2 시작/역할 패널 연결은 기능 구현이며 문구만 별도로 정리하는 작업은 보류 상태다.

M3 힌트/토론/타이머, M4 투표, M5 승패, M6 단절·위임·만료 정리, M7 출시 QA는 미구현이다. HINT에서는 다음 단계 준비 안내까지만 표시한다.
