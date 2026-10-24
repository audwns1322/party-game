# HANDOFF (2026-10-24)

## 현재 상태
- 라이어 게임, React+TS+Vite / Supabase / Vercel. 작업 브랜치 `codex/m0-draft`, 배포 브랜치 `main`(Vercel 자동 배포).
- **M1 완료 + 전문가 테스트 보강 완료, 실기기(iOS/Android) 확인만 남음.** 방 생성·참가·대기실·재접속·다른 기기 이어하기, 방장 설정·강퇴·입장 잠금, 닉네임 사칭 차단, IP/방 기준 속도 제한, 연결 끊김 배너.
- 사이트: https://party-game-psi-pink.vercel.app — 개발 DB `party-game-dev`(wmgpshtqqsqwgyigxcwl). 원격 E2E·Realtime(입장 0.14초, 설정 0.9초 반영) 확인됨.
- 상세: `TEST_MATRIX.md`, 설계: `DECISIONS.md`(M1, M1 보강 절).

## 다음 작업
1. 사용자 휴대폰 3대 확인 후 M2: rounds·round_players·round_secrets·word_candidates·command_receipts, 라이어 배정, 역할 확인 (`CODEX_IMPLEMENTATION_PLAN.md` M2). 중간 입장자 `waiting_next_round` 처리 포함.
2. `scripts/setup.sh` (Node 설치, `npm ci`, `.env.local` 안내).

## 차단 요인·주의
- 클라우드 세션은 `*.supabase.co`·`*.vercel.app` 직접 요청 차단 → DB는 Supabase MCP, 실사이트는 데스크톱 앱 내장 브라우저로 확인.
- Supabase `apply_migration`은 DROP 포함 시 사용자 승인 창이 뜸(무응답 시 시간 초과).
- Vercel 커넥터는 팀 권한 승인 링크가 미리보기로 소진되어 실패 → Vercel 설정은 대시보드에서 사용자가 직접.
- 보류: command_receipts 멱등(M2), 연결 끊김 30초 위임·만료 정리 스케줄러(M6). POC `m0_private`는 운영 전 제거.

## 환경
- Node 24.19.0(.nvmrc). 클라우드에 없으면 `npm i --prefix <dir> node@24.19.0`.
- `.env.local`(Git 제외): 원격 URL + publishable 키(Supabase MCP `get_publishable_keys`). Vercel에도 같은 두 값 등록됨.
- 마이그레이션 파일명 = 원격 적용 버전. Edge 배포는 Supabase MCP `deploy_edge_function`(index + `_shared/room.ts·security.ts·server.ts`). CORS 허용 origin은 `_shared/server.ts` 기본값 + `APP_ALLOWED_ORIGINS`.
- 로컬 확인: PGlite 모의 API(실제 핸들러+마이그레이션) + 헤드리스 Chromium(npm `@sparticuz/chromium`). 작업 규칙 `CLAUDE.md`.
