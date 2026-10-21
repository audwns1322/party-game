# 새 채팅 인수인계 — M0 초안

## 현재 상태

- React + TypeScript + Vite / Supabase / Vercel 기반 파티 게임. 첫 게임은 라이어 1종.
- **M0 부분 완료, M1 미착수. M0 완료 보고 및 사용자 확인 전 M1로 넘어가지 않는다.**
- 사용자가 새 채팅에서 이어서 작업하기 위해 현재 초안을 GitHub 별도 브랜치에 업로드하도록 요청했다.
- 이 초안은 실행 가능한 기본 화면과 보안 POC다. 방 생성/참가 버튼은 비활성화 상태이며 완성된 게임이 아니다.

## 먼저 읽을 문서

1. docs/PRD_FINAL_v1.0.md
2. docs/CODEX_IMPLEMENTATION_PLAN.md
3. docs/DECISIONS.md
4. docs/TEST_MATRIX.md
5. docs/EXTERNAL_SETUP.md

원본 ZIP에는 위 PRD/계획서 두 문서가 전부였으며 원문을 보존했다. PRD §2.4의 승패 문장 오기는 상세 상태 머신을 우선해 해석했으며 DECISIONS.md에 기록했다. 아직 승패 로직은 구현하지 않았다.

## 재현 및 검증

Node .nvmrc 버전, npm 사용. npm ci 이후 다음 명령이 현재 작업 공간에서 통과했다.

```sh
npm run typecheck
npm run typecheck:edge
npm run lint
npm test          # 보안 단위 테스트 10개
npm run test:sql  # 임베디드 PostgreSQL/WASM 통합 테스트 3개
npm run build
npm run dev
```

GitHub Actions workflow는 위 검사를 정의했으나 원격 CI 결과는 별도 확인해야 한다. 기존 클라우드의 실행 중 프로세스/캐시/설정 초안이 새 채팅에서 복원된다고 가정하지 않는다. 기존 체크아웃을 사용하고 명시 요청 없이 worktree를 만들지 않는다.

## 차단 요인과 바로 다음 작업

1. 로컬 Docker driver=vfs, 총 디스크=32GB. 공식 Supabase Postgres 17 이미지 레이어 복제 중 디스크가 가득 찼다. 해당 설치를 중단해 여유 약 21GB로 복구했으며 실행 중 Supabase 컨테이너는 없다. 동일한 환경에서 무작정 다시 다운로드하지 않는다.
2. 사용자가 개발용 원격 Supabase 프로젝트를 준비했다. URL: https://wmgpshtqqsqwgyigxcwl.supabase.co, ref: wmgpshtqqsqwgyigxcwl.
3. 공개 publishable 키는 기존 채팅에서 제공받아 Git 제외 .env.local에 등록했다. **이 파일/키는 GitHub에 올리지 않으므로 새 환경에서 다시 안전하게 등록해야 한다.** service_role/DB 비밀번호/관리 토큰은 제공받지 않았으며 요청 시 채팅에 비밀 원문을 받지 않는다.
4. 원격 URL로의 요청은 클라우드 프록시 CONNECT 403에서 차단됐다. 키 검증/DB 접속에 도달한 것이 아니다. 당시 클라우드 설정 초안에 해당 호스트와 공개 변수 요구사항을 저장했으나 적용/게시 완료는 확인되지 않았다. 새 세션의 실제 네트워크 정책과 바인딩을 다시 확인한다. 정책을 우회하지 않는다.
5. 사용자는 브라우저에 로그인 중이나, 이 클라우드 세션에 브라우저/데스크톱 조작 도구가 없어 화면 조작을 수행하지 않았다. 사용자 Windows Codex 앱에 로컬 Playwright MCP 설정 방법을 설명했지만 설치/연결되었다고 가정하지 않는다. URL/공개 키만으로 DB 마이그레이션·Edge 배포 권한이 생기지 않는다.
6. 원격 접근과 관리 인증이 준비되면 **개발용 프로젝트만 대상으로** 안전한 테스트 데이터 생성/정리 및 권한 검증을 설계한 후 마이그레이션/Edge HTTP/Realtime 검증을 마친다. 현재 tests/integration/m0.mjs는 실수 방지를 위해 로컬만 허용한다. 이 보호를 단순히 삭제하지 않는다.

## 미검증 범위

- 실제 Supabase pgTAP 12개, Edge→PostgREST→DB HTTP, 실제 Realtime Broadcast 송수신은 미실행.
- 임베디드 SQL 테스트 및 Deno 타입 검사 통과를 위 실제 스택의 성공으로 보고하지 않는다.
- POC m0_private.sessions는 운영 게임 모델이 아니다. 운영 배포 전 제거/전환을 검토한다.
- Supabase 원격 배포, Vercel 배포, 스마트폰/iOS/Android 테스트, M1~M7 게임 기능은 미완료.
