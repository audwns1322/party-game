# 검증 결과 — M0 (2026-10-21, 원격 항목 2026-10-24 추가)

**마일스톤 상태: 부분 완료. M1 미착수.** 실제 Supabase 스택 시작에 실패하여 M0 전체 인수 조건을 충족했다고 주장하지 않는다.

| 검증 | 결과 | 근거/한계 |
| --- | --- | --- |
| 첨부 문서 전체 분석, 기존 파일 인벤토리 | 완료 | 원본 2개 보존, 초기 README만 존재 |
| npm lockfile/고정 버전 설치 | 통과 | npm ci 재설치 검증 |
| React/TypeScript/Vite 빌드 | 통과 | npm run build |
| 프런트/공유 서버 코드 TS 검사 | 통과 | npm run typecheck |
| Edge 실제 진입점 Deno 타입 검사 | 통과 | npm run typecheck:edge |
| ESLint | 통과 | npm run lint |
| 보안 단위 테스트 | 10개 통과 | 토큰/해시, 미인증/다른 방/위조 요청, DTO 허용 목록, 라이어 단어 차단, 장애 fail-closed, CORS, 이벤트 비밀 필드 거부 |
| 동일 SQL + 임베디드 PostgreSQL 통합 | 3개 통과 | schema/table/RPC 권한 거부, RLS 활성화, 실제 핸들러→RPC, 본인 조회/타 방/라이어 차단, 폐기 자격 거부 |
| 개발 서버 HTTP | 통과 | Vite / 및 TSX 모듈 HTTP 200. 브라우저 UI 실기기 검증과 다름 |
| Supabase CLI 설치/init | 통과 | 2.121.0, 쓰기 가능한 CLI 홈 설정 |
| 로컬 Supabase 전체 시작 | 실패: 환경 차단 | Docker vfs의 이미지 레이어 누적 복제로 32GB 디스크 소진. 중단 후 여유 약 21GB 복구 |
| Supabase pgTAP 12개 | 미실행 | tests SQL 작성됨. 스택 시작 전에는 실제 통과 아님 |
| 실제 Edge→PostgREST→Postgres HTTP | 미실행 | tests/integration/m0.mjs 작성됨. 임베디드 테스트가 이를 대신하지 않음 |
| 실제 Realtime WebSocket 송수신 | 미실행 | payload/수신 파서 단위 테스트만 통과. 실제 송수신 테스트는 위 통합 파일 |
| 원격 Supabase 배포본 일치 | 통과 (2026-10-24) | party-game-dev에 migration `20261021071859_m0_security_poc`·Edge `m0-snapshot` v1(verify_jwt=false) 배포됨. 내용이 브랜치 파일과 동일(CRLF 차이만) |
| 원격 DB 권한 (Supabase MCP SQL) | 통과 (2026-10-24) | anon/authenticated: m0_private 스키마·테이블·RPC 권한 없음, service_role만 RPC 실행. RLS 활성, SECURITY DEFINER + 빈 search_path. 보안 advisor는 의도된 deny-all(`rls_enabled_no_policy` INFO)만 보고 |
| 원격 RPC 동작 (롤백 트랜잭션) | 통과 (2026-10-24) | 시민 본인 단어 조회, 라이어 단어 null, 타 방/미등록/폐기 자격 null. 트랜잭션 rollback 후 잔여 행 0 |
| 원격 Edge HTTP / Realtime / Vercel / 실기기 | 미실행 | 클라우드 세션에서 *.supabase.co 직접 요청이 프록시에서 차단(HTTP 000). Vercel 배포 안 함 |
| GitHub Actions | 미실행 | workflow 작성, 로컬 동일 검사 통과. push/원격 CI 실행 안 함 |

## M0를 마치기 위한 재검증

Docker overlay2 등 효율적인 저장 드라이버 또는 충분한 디스크가 제공되는 로컬 환경에서 `npm run db:start` → 새 로컬 데이터에 `npm run db:reset` → `npm run functions:serve` 순서로 실행한다. `npm run test:db` 12개와 `npm run test:integration` 5개(그중 실제 Broadcast)를 반드시 실행한다. 이후에는 M0 결과를 다시 보고하고 사용자 확인 전 M1로 넘어가지 않는다.

대안은 **개발용** Supabase 원격 프로젝트 연결이다. 현재 통합 스크립트는 실수로 원격 데이터를 변경하지 않도록 로컬만 허용한다. 원격을 선택하면 별도 안전한 테스트 픽스처/정리 경로와 권한을 확인해 원격 검증을 추가한다.

## 이후 PRD 인수 항목 (모두 미실행)

| PRD 번호 | 범위 | 예정 단계 |
| --- | --- | --- |
| 1 | 3/12인, 3판 완주 | M7 |
| 2–3 | 방장/외부인 비밀 보호 | M1–M7 (M0는 최소 POC만) |
| 4 | 내장/직접 입력 단어 | M2 |
| 5 | 힌트/토론 옵션 | M3 |
| 6 | 비밀 투표·재투표·무승부 | M4 |
| 7–8 | 정답 도전·이의 제기·시민 과반 | M5 |
| 9–12 | 단절/위임/복구/중간 입장 | M1/M6 |
| 13 | 전적 단일 반영 | M5 |
| 14 | 종료/만료 접근 차단 및 삭제 | M6 |
| 15 | iOS/Android 실기기 UI | M7 |

# 검증 결과 — M1 (2026-10-24)

| 검증 | 결과 | 근거/한계 |
| --- | --- | --- |
| 로컬 검사 | 통과 | typecheck, typecheck:edge(함수 6개), lint, 단위 15개, SQL 통합 12개(M1 9개), build |
| DB 권한 (PGlite + 원격) | 통과 | anon/authenticated: app_private 테이블·RPC 전부 거부, service_role만 public RPC. 원격은 권한 매트릭스 쿼리로 확인 |
| 정원·닉네임 (ROOM-01) | 통과 | 12명 후 13번째 ROOM_FULL, 대소문자 무시 중복 NICKNAME_TAKEN, 없는 코드 ROOM_NOT_FOUND |
| 인증·권한 (SEC-01, SEC-03) | 통과 | 타 방/미등록/누락 토큰 거부, 비방장 설정·종료 HOST_ONLY, 잘못된 설정 400, 오래된 version 409 |
| 복구·회전 | 통과 | 복구 후 이전 토큰·복구 코드 모두 거부, 새 토큰 동작 (로컬+원격) |
| 방장 위임·종료·만료 | 통과 | leave 시 다음 순서 위임, 종료/만료 후 스냅샷 410·참가 404·복구 403 |
| 원격 RPC 동작 | 통과 | 롤백 트랜잭션으로 생성·참가·중복·위조·복구·종료 확인, 잔여 행 0. 보안 advisor는 의도된 deny-all INFO만 |
| Edge 배포 | 통과 | room-create/join/player-recover/room-snapshot/room-command v1, verify_jwt=false(내부 인증). 배포본 = 브랜치 코드 |
| 브라우저 흐름 (헤드리스 Chromium, 모바일 뷰포트 3대) | 통과 | 실제 핸들러+마이그레이션 로컬 서버로 생성→복구 코드 표시→참가 2명→중복 닉네임 오류→방장 설정이 손님 화면 반영·손님은 수정 불가→새로고침 자동 복구→다른 기기 복구 후 이전 기기 차단 |
| 원격 E2E (Vercel → Edge → DB → Realtime) | 통과 (2026-10-24) | https://party-game-psi-pink.vercel.app, 데스크톱 앱 내장 브라우저 3세션: 생성(콜드 스타트 약 6초)·자동 복구·참가 2명, 입장이 방장 화면에 0.14초, 설정 변경이 손님 화면에 0.9초 반영(Realtime 동작). 손님 설정 select 비활성. 테스트 방은 종료 처리 |
| 실기기 3대 (iOS/Android) | 미실행 | 사용자 휴대폰 확인 필요 |
