# HANDOFF (2026-10-24)

## 현재 상태
- React+TS+Vite / Supabase / Vercel. `codex/m0-draft`에서 M2 구현, main 공개 frontend는 아직 M1.
- M2: 3~12명 방장 시작, 라이어 1명/참가자 스냅샷, 내장 75단어·직접 입력(라이어 후보 제외), 본인 역할 DTO·누르는 동안 표시·확인, 중간 입장 대기, 멱등 명령·판 취소. HINT 진입까지만 제공한다.
- 단위 18 + SQL/핸들러 통합 35 통과. 원격 HTTP/서버 Realtime 10개 검사, localhost UI 시작·확인·취소·종료 확인. 상세 `M2_VALIDATION.md` / `TEST_MATRIX.md` / `DECISIONS.md`.
- 개발 DB `party-game-dev`만 적용: migration 20261024130245, 20261024130708. game-command v1, room-command/room-snapshot/room-join v4. 테스트 방 4개 정리, 사용자 방 변경 없음.

## 다음 작업
- M2 초안 PR 검토 후 main 병합 시 공개 frontend 반영. M3 힌트·토론·타이머는 아직 시작하지 않았다.
- 사용자 보류: 모바일 3대 M1 인수 확인, 대기실 안내 문구 최종 재검토. 나중에 구현 후 필요한 것을 물으면 다시 안내한다.

## 주의
- M2에서는 판 참가자 퇴장·강퇴·설정 변경 전 방장이 판 취소. 단절 자동 정지/재개·위임·만료 정리는 M6.
- 원격 개발 검증 성공은 iOS/Android 실기기 검증이나 전체 게임 완주 성공이 아니다.
- 이전 로컬 M0 변경은 `codex-m0-local-preserved-before-m2-20261024` stash에 보존. 최신 코드 위로 무작정 pop하지 않는다.
- `m0_private` POC는 운영 전 제거 검토. rollback은 `supabase/rollback/m2.sql`(데이터 삭제 포함, 실제 원격에서는 미실행).

## 환경
- Node 24.19.0 / npm / .env.local(Git 제외) URL+publishable key. service_role은 Edge 런타임만 사용.
- `npm ci` 후 typecheck, lint, test, test:sql, typecheck:edge, build. Edge 타입은 Windows/Linux 공통 Node 래퍼.
- `M2_REMOTE_PROJECT=wmgpshtqqsqwgyigxcwl` 명시 후 원격 테스트. 잔여 `.cache/m2-remote-rooms.json`이 있으면 생성 방 정리부터 확인.
