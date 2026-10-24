# HANDOFF (2026-10-24)

## 현재 상태
- 라이어 게임 1종, React+TS+Vite / Supabase / Vercel. 브랜치 `codex/m0-draft`.
- **M0 거의 완료, M1 미착수.** 원격 개발 DB(`party-game-dev`, wmgpshtqqsqwgyigxcwl)에 M0 migration·Edge `m0-snapshot` 배포됨, 브랜치와 동일.
- 원격 DB 권한·RPC 동작(본인/라이어 단어 차단/타 방·폐기 거부), 로컬 typecheck·lint·단위 10·SQL 3·build 통과. 상세는 `TEST_MATRIX.md`.

## 다음 작업
1. 원격 Edge HTTP + Realtime 송수신 실검증 → M0 완료 보고 → 사용자 확인 후 M1.
2. M1: `rooms`·`players` 마이그레이션, 방 생성/참가/대기실/재접속 (`CODEX_IMPLEMENTATION_PLAN.md` M1).
3. `scripts/setup.sh` 작성 (Node 설치, `npm ci`, `.env.local` 안내).

## 차단 요인
- 클라우드 세션에서 `*.supabase.co` 직접 요청이 프록시에 막힘. Edge/Realtime 검증은 사용자 PC 실행 또는 네트워크 허용 목록 추가 필요. DB 확인은 Supabase MCP로 가능.
- `tests/integration/m0.mjs`는 로컬만 허용(원격 실수 방지). 원격용은 안전한 픽스처/정리 경로를 따로 설계.
- POC `m0_private.sessions`는 운영 모델 아님. M1 이후 제거 검토.

## 환경
- Node 24.19.0(.nvmrc), npm. 클라우드에 없으면 `npm i --prefix <dir> node@24.19.0`로 설치.
- `.env.local`(Git 제외)에 원격 URL + publishable 키. 새 환경에서 Supabase MCP `get_publishable_keys`로 재생성. service_role은 쓰지 않는다.
- 연결: GitHub(푸시 가능), Supabase MCP. 작업 규칙은 `CLAUDE.md`.
- 원본 계획 문서: `PRD_FINAL_v1.0.md`, `CODEX_IMPLEMENTATION_PLAN.md`, `DECISIONS.md`.
