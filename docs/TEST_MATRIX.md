# 검증 결과 — M0 (2026-10-21)

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
| 원격 Supabase/Vercel/실기기 | 미실행 | 프로젝트 미연결, 배포 안 함 |
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
