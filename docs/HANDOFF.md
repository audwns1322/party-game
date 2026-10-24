# HANDOFF (2026-10-24)

## 현재 상태
- React+TS+Vite / Supabase / Vercel. `codex/m2-draft` / 초안 PR #2에서 M2 보완, main 공개 frontend는 아직 M1.
- M2: 3~12명 방장 시작, 라이어 1명/참가자 스냅샷, 내장 75단어·직접 입력(라이어 후보 제외), 본인 역할 DTO·누르는 동안 표시·확인, 중간 입장 대기, 멱등 명령·판 취소. HINT 진입까지만 제공한다.
- 후속 리뷰에서 미확정 요청의 다른 상태 재사용, DB 배정 제약 누락, 원격 재시도 검사 누락을 재현·수정. 단위 20 + SQL/핸들러 37 통과, 수정된 원격 10개 검사 통과. 상세 `M2_VALIDATION.md`의 후속 검토 절.
- 개발 DB `party-game-dev`만 적용: M2 migration 20261024130245, 20261024130708, 20261024133903. game-command v2, room-command/room-snapshot/room-join v4. 이번 리뷰의 일회성 방 3개 종료·정리, 사용자 방 변경 없음.

## 다음 작업
- M2 초안 PR 검토 후 main 병합 시 공개 frontend 반영. M3 힌트·토론·타이머는 아직 시작하지 않았다.
- 개발·리뷰 규칙은 `AGENTS.md`. 요청 훅은 짧은 참조만 전달하며 실제 자동 실행은 사용자 신뢰 승인 후 확인한다.
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
