# HANDOFF (2026-10-28)

## 현재 상태
- main: M3·토론 건너뛰기·테마/혼선 PR #5 반영(`a54ac53`). 공개 주소는 https://party-game-psi-pink.vercel.app.
- 테마/혼선 구현: 테마 9개, 기본·혼선 라이어, 혼선 이지·하드, 직접 입력 방장 테마 + 1인 1단어 구현. 명칭은 사용자 확정 **혼선 라이어**.
- 단위 20 + SQL/핸들러 62 = 82개, 타입·전체 Edge 타입·린트·빌드 통과. 실제 개발 Supabase 테마 원격 34개 통과, 단어 확장 후 M3 원격 24개 재통과. 세부 `THEMES_VALIDATION.md`.
- 개발 DB migration `20261026065002_themes_word_modes`, room-command v6 적용. 기존 auth·RPC 서명·RLS 유지. 테마와 난이도는 판 시작 시 고정하며 본인 단어만 전달.

- 후속 `codex/expand-theme-words`: 테마마다 30개, 총 270개로 확장. migration `20261026070733_expand_theme_words` 적용. 기존 단어/조합·현재 판 유지. 무작위 추첨이므로 재등장 자체를 차단하는 기능은 아님.
- M3 재점검: 힌트·토론·서버 기한·정지/재개·건너뛰기 구현 완료. 최대 12명×3바퀴(36턴) 추가 통과. 모바일 화면/다중 기기 인수는 아직 미완료. `M3_VALIDATION.md` 최신 점검 절 참조.

- 2026-10-28 연결 복구 후 9개 테마×30개 실제 DB 재확인, 중단 당시 남은 일회성 M3 테스트 방 정리 완료. 데이터 재적용·기능 재설치 없음.

## 다음 작업과 보류
- 기능 PR/공개 배포 상태는 GitHub에서 확인한다. 모바일 실기기·다중 기기 인수 미완료. M4 투표는 시작하지 않았다.
- 사용자 보류: 모바일 3대 M1 인수 확인, 대기실 안내 문구 최종 재검토. 구현 후 필요한 것을 물으면 다시 안내한다.
- 개발 규칙 `AGENTS.md`. 요청 훅은 설정되어 있으나 실제 자동 실행은 사용자 신뢰 승인 후 확인한다.

## 주의
- 기본 제시어만 혼선 라이어 지원. 직접 입력은 방장 테마 필수, 기본 라이어로 1인 1단어. 테마와 게임 방식 변경은 판 취소 후 가능.
- DB 서버 기한으로 토론 전환. 인증 snapshot/heartbeat가 만료를 한 번 확정한다. 무접속 시 다음 요청에서 전환. 방장 skip_timer:true는 기한 전 조기 종료 허용.
- 현재 판 퇴장·강퇴·설정 변경은 먼저 판 취소. 연결 단절 자동 정지·방장 자동 위임·만료 정리는 M6.
- M0 로컬 변경은 `codex-m0-local-preserved-before-m2-20261024` stash에 보존. 무작정 pop하지 않는다.
- rollback은 `themes_word_modes.sql` → 필요시 `m3.sql` → `m2.sql`. 활성 판을 취소하고 관리자만 실행. 실제 원격 rollback 미실행.

## 환경
- Node 24 / 설치된 의존성 재사용. `.env.local` Git 제외, URL+publishable key만. 비밀 키는 Edge 런타임에만 둔다. Docker 재설치 없이 PGlite + 개발 원격 사용.
- `npm run typecheck`, `lint`, `test`, `test:sql`, `typecheck:edge`, `build`.
- `THEMES_REMOTE_PROJECT=wmgpshtqqsqwgyigxcwl` 명시 후 `node tests/integration/themes-remote.mjs`. `.cache/themes-remote-rooms.json` 잔여 시 UUID 대상 방 정리부터 확인.
- CLI는 `SUPABASE_HOME`을 workspace `.cache/supabase`로 지정한다. 기본 사용자 홈의 설정 디렉터리는 이 환경에서 쓰기 제한될 수 있다.
