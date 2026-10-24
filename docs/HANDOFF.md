# HANDOFF (2026-10-24)

## 현재 상태
- 라이어 게임, React+TS+Vite / Supabase / Vercel. 브랜치 `codex/m0-draft`.
- **M1 구현 완료, 실기기 검증 전.** 방 생성·참가(12명 상한·닉네임 중복 차단)·대기실(명단·방장·연결 상태·초대 링크/QR·방장 설정)·같은 브라우저 자동 복구·다른 기기 복구 코드(토큰+코드 회전)·나가기/방 종료.
- 개발 DB `party-game-dev`(wmgpshtqqsqwgyigxcwl)에 M1 migration·Edge 5개 배포, 원격 RPC 검증 통과. 상세 `TEST_MATRIX.md`, 설계 `DECISIONS.md` M1 절.
- M0의 Edge HTTP·Realtime 실검증은 M1 실기기 검증과 함께 진행하기로 함.

## 다음 작업
1. 실기기 3대 검증 (M1 완료 조건): Vercel 미리보기 배포 또는 PC IP origin을 `APP_ALLOWED_ORIGINS`에 등록 → 생성/참가/재접속/복구 확인, Realtime 반영 확인.
2. 사용자 확인 후 M2: rounds·round_players·round_secrets·word_candidates·command_receipts, 라이어 배정, 역할 확인 (`CODEX_IMPLEMENTATION_PLAN.md` M2).
3. `scripts/setup.sh` (Node 설치, `npm ci`, `.env.local` 안내).

## 차단 요인
- 클라우드 세션에서 `*.supabase.co` 직접 요청이 프록시에 막힘. DB는 Supabase MCP로 확인. 원격 HTTP/Realtime은 사용자 PC·휴대폰에서 확인.
- 보류: 요청 속도 제한·방 코드 브루트포스 방어, command_receipts 멱등, 연결 끊김 30초 위임(M6), 만료 정리 스케줄러(M6). POC `m0_private`는 운영 전 제거.

## 환경
- Node 24.19.0(.nvmrc). 클라우드에 없으면 `npm i --prefix <dir> node@24.19.0`.
- `.env.local`(Git 제외): 원격 URL + publishable 키. Supabase MCP `get_publishable_keys`로 재생성.
- 마이그레이션 파일명은 원격 적용 버전과 동일하게 유지. Edge 배포는 Supabase MCP `deploy_edge_function`(index + `_shared/room.ts·security.ts·server.ts`).
- 브라우저 확인: 로컬 PGlite 모의 서버 + 헤드리스 Chromium(npm `@sparticuz/chromium`)으로 가능. 작업 규칙 `CLAUDE.md`.
