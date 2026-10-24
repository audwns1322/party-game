# HANDOFF (2026-10-24)

## 현재 상태
- M2 PR #2를 사용자 요청으로 main에 병합: `9a1331e139efc9c4f23d6013204b588778c219a6`. Vercel main 배포 성공.
- 현재 `codex/m3-draft` / 초안 PR #3: 힌트 1~3바퀴/현재 발언자 권한/멱등 완료, 토론 1·2·3·5분/무제한, 서버 기한 만료, 방장 정지·재개 구현. VOTE_1 진입까지만 제공하며 투표 자체는 M4.
- 단위 20 + SQL/핸들러 48 = 68개 통과. 타입·전체 Edge 타입·린트·빌드 통과. 개발 Supabase 실제 15개 원격 검사와 내장 브라우저 힌트→토론/정지·재개 확인. 상세 `M3_VALIDATION.md`.
- 개발 DB만 M3 migration `20261024135531` 적용. game-command v3, room-command/room-snapshot v5. 일회성 원격 테스트 방 종료·삭제 후 잔여 0 확인.

## 다음 작업
- M3 초안 PR 검토. 모바일 iOS/Android 실기기 화면·다중 기기 인수는 미완료이므로 최종 완료로 단정하지 않는다. M4는 시작하지 않았다.
- 개발·리뷰 규칙은 `AGENTS.md`. 요청 훅의 실제 자동 실행은 사용자 신뢰 승인 후 확인한다.
- 사용자 보류: 모바일 3대 M1 인수 확인, 대기실 안내 문구 최종 재검토. 구현 후 필요한 것을 물으면 다시 안내한다.

## 주의
- 타이머는 DB deadline 기준. 인증된 snapshot/heartbeat가 만료를 원자적으로 전환한다. 접속자가 없으면 다음 인증 요청 때 전환하며, 타이머 자체가 2시간 방 만료를 연장하지 않는다.
- 클라이언트 카운트다운은 표시용이며 시간 0에서 임의로 투표로 전환하지 않는다. Realtime 알림 누락 시 토론 중 2초 snapshot, 평소 10초 heartbeat로 복구.
- 현재 판 참가자 퇴장·강퇴·설정 변경은 먼저 판 취소. 단절 자동 정지·방장 자동 위임·만료 정리는 M6.
- M0 로컬 변경은 `codex-m0-local-preserved-before-m2-20261024` stash에 보존. 무작정 pop하지 않는다.
- rollback은 `supabase/rollback/m3.sql` → 필요시 `m2.sql`. M3 rollback은 활성 판이 있으면 거부한다. 실제 원격 rollback은 미실행.

## 환경
- Node 24.19.0, 설치된 의존성 재사용. `.env.local`은 Git 제외, URL+publishable key만. 비밀 키는 Edge 런타임에만 둔다.
- 로컬 Docker 재설치 없이 PGlite + 개발 원격 사용. 네트워크 제한 때문에 미리보기 서버도 네트워크 허용 실행이 필요할 수 있다.
- `npm run typecheck`, `lint`, `test`, `test:sql`, `typecheck:edge`, `build`.
- `M3_REMOTE_PROJECT=wmgpshtqqsqwgyigxcwl` 명시 후 `node tests/integration/m3-remote.mjs`. 실제 60초 기한을 기다린다. `.cache/m3-remote-rooms.json` 잔여 시 해당 일회성 방 정리부터 확인.
