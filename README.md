# 모두의 파티 — 라이어 게임 플랫폼

React + TypeScript + Vite / Supabase / Vercel. 현재 **M1(방 생성·참가·대기실·재접속) 구현 완료, 실기기 검증 전**. 게임 진행(M2~)은 아직 없다. 진행 상태는 `docs/HANDOFF.md`.

## 시작

Node 24 (`.nvmrc`: 24.19.0), npm.

```sh
npm ci
cp .env.example .env.local   # 개발 Supabase URL + publishable 키 입력
npm run dev                  # http://localhost:5173
```

검사: `npm run typecheck && npm run typecheck:edge && npm run lint && npm test && npm run test:sql && npm run build`.
`test:sql`은 실제 마이그레이션을 임베디드 PostgreSQL(PGlite)에 적용하고 실제 Edge 핸들러로 검증한다.

### 휴대폰에서 확인하기

Edge 함수는 `APP_ALLOWED_ORIGINS`에 등록된 origin만 허용한다(기본: localhost:5173). 같은 Wi-Fi의 휴대폰에서
`http://<PC IP>:5173`으로 접속하려면 그 origin을 Supabase Functions secret `APP_ALLOWED_ORIGINS`에 추가하거나,
Vercel 미리보기 HTTPS 주소를 등록해야 한다.

## 환경변수

`.env.example`을 `.env.local`로 복사한다. 실제 값은 커밋·채팅에 공유하지 않는다.

| 변수 | 위치 | 의미 |
| --- | --- | --- |
| VITE_SUPABASE_URL | 프런트 .env.local / Vercel 환경 설정 | 프로젝트 API URL. 로컬은 http://127.0.0.1:54321 |
| VITE_SUPABASE_PUBLISHABLE_KEY | 위와 동일 | 공개 publishable 키. 로컬 legacy anon 키도 SDK/POC에 사용 가능 |
| SUPABASE_URL | Edge 런타임 자동 제공 | 서버용 프로젝트 URL |
| SUPABASE_SERVICE_ROLE_KEY | Edge 런타임 자동 제공 | 서버 전용. VITE_*·브라우저·Git에 절대 넣지 않음 |
| APP_ALLOWED_ORIGINS | Supabase Functions secret 설정 또는 로컬 서버 전용 env 파일 | 허용 프런트 origin 쉼표 목록. 기본 localhost:5173, 127.0.0.1:5173. 운영에서는 HTTPS 실제 origin 명시 |
| SUPABASE_HOME | 로컬 CLI 실행 환경 | 클라우드에서 프로젝트 .cache/supabase 사용(스크립트에 포함) |
| SUPABASE_INTERNAL_IMAGE_REGISTRY | 로컬 CLI 실행 환경 | 공식 Docker Hub 미러 docker.io(스크립트에 포함) |

공개 키는 참가자 자격이 아니다. 참가자 원문 토큰은 256-bit 무작위 값이며 서버 DB에는 SHA-256만 저장한다. M0 토큰 발급은 테스트 픽스처 전용이고 사용자 발급 API는 M1 범위다. 서비스 키를 넣지 않아도 로컬 CLI가 Edge 환경을 구성한다. `supabase status` 출력에는 키가 포함되므로 로그/채팅에 붙여넣지 않는다.

## 로컬 보안 POC

```sh
npm run db:start
# 아래 명령은 로컬 DB 데이터를 삭제/재생성한다. 최초 또는 마이그레이션 재현 전용.
npm run db:reset
npm run functions:serve
```

다른 터미널에서:

```sh
npm run test:db
npm run test:integration
```

통합 테스트는 API_URL이 로컬 54321인지 확인한 뒤 임시 UUID 방/자격을 생성하고 종료 시 제거한다. 토큰/키를 출력하지 않는다. DB 테스트는 트랜잭션 rollback으로 픽스처를 제거한다. 실제 게임용 seed는 아직 없다.

- `GET /functions/v1/m0-snapshot?room_id=<UUID>`
- `Authorization: Bearer <64자리 hex 참가자 토큰>`, `apikey: <공개 키>`
- 본인 개인 DTO만 반환. 타인 player_id/role 파라미터는 권한을 부여하지 않는다.
- 라이어 응답은 word=null. 무자격 401, 미등록/다른 방/폐기 자격 403, 백엔드 장애 503.
- `m0_private.sessions`는 REST에 노출되지 않으며 anon/authenticated 접근 및 RPC 실행을 차단한다.
- Realtime payload는 방 UUID와 version만. 클라이언트는 이벤트를 신뢰해 상태를 바꾸지 않고 인증된 스냅샷을 재조회한다.

## 검증 명령

```sh
npm run typecheck
npm run lint
npm run typecheck:edge
npm test
npm run test:sql  # 임베디드 PostgreSQL 권한 검증; Docker 불필요
npm run build
npm run test:db           # 로컬 Supabase 필요
npm run test:integration  # 로컬 Supabase + functions:serve 필요
```

## 디렉터리

- `src/app`, `src/styles`: 모바일 기본 화면과 앱 진입점
- `src/lib`: 공개 Supabase 연결, 인증된 개인 조회, 공개 Realtime 알림
- `supabase/functions/_shared`: 서버 토큰 검증·DTO 허용 목록·CORS
- `supabase/functions/m0-snapshot`: 서버 전용 RPC 어댑터
- `supabase/migrations`, `supabase/tests`: 격리된 보안 POC SQL과 권한 테스트
- `tests/unit`, `tests/integration`: 보안 단위/실제 스택 통합 테스트
- `docs`: 원본 PRD/계획, 결정 기록, 테스트/외부 설정 안내

새 게임을 위한 범용 엔진은 아직 만들지 않는다. 공통 방 기능은 M1, liar 게임 경계는 M2에서 실제 필요에 맞춰 구성한다.

## 되돌리기

로컬 데이터는 필요 시 별도 백업 후 삭제한다. POC SQL만 제거하려면 로컬 관리자 연결에서 `drop function public.m0_snapshot(text, uuid); drop schema m0_private cascade;`를 실행한다. 운영 프로젝트에는 POC를 적용하지 않는다. 로컬 컨테이너 중단은 `SUPABASE_HOME=$PWD/.cache/supabase npx supabase stop`(키 출력 주의). 다른 작업이 시작한 서비스를 중단하지 않는다.

외부 프로젝트 연결 절차는 [EXTERNAL_SETUP.md](docs/EXTERNAL_SETUP.md), 명세 충돌과 보안 경계는 [DECISIONS.md](docs/DECISIONS.md), 검증 결과는 [TEST_MATRIX.md](docs/TEST_MATRIX.md)를 참고한다.

## M2: 라운드와 역할 확인

최신 구현은 M6까지 확장되어 최대 15명·라이어 1/2명과 결과/승점·끊김 정지/복구·방장 위임·자동 정리를 지원한다. 현재 상태는 [HANDOFF.md](docs/HANDOFF.md), 연결/정리 검증과 운영 한계는 [M6_VALIDATION.md](docs/M6_VALIDATION.md) 참조. 아래 M2 설명은 당시 단계의 기록이다.

3~12명이 접속한 대기실에서 방장이 시작하면 기본 단어 배정 또는 직접 입력 후보 제출 → 역할 확인 → HINT까지 진행한다. 후보는 시민의 것만 선정하고 본인 역할만 반환하며 라이어에게 정답은 보내지 않는다. 중간 입장자는 다음 판 대기다. 현재 판 취소는 점수 없이 대기실로 돌아간다. 실제 힌트 진행·토론·투표는 후속 단계다.

변경/검증/개발 배포/보류 항목은 [M2_VALIDATION.md](docs/M2_VALIDATION.md). 원격 테스트 `tests/integration/m2-remote.mjs`는 명시적인 개발 프로젝트 opt-in과 공개 key 설정이 필요하며, 이번 실행이 만든 테스트 방만 사용한다. Docker 설치는 필요 없다.
