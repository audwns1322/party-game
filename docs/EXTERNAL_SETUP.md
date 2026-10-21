# 외부 서비스 연결 — M0

## 지금 사용자 비밀은 필요하지 않음

로컬 보안 POC는 Docker Supabase를 사용한다. 현재 클라우드 설정과 실제 프로세스의 변수 이름을 확인했으며 Supabase/Vercel 바인딩은 없다. 원격 연결이나 배포를 완료했다고 주장하지 않는다. 로컬 개발 검증을 위해 사용자 비밀을 임의로 생성하거나 요청하지 않는다.

## 원격 개발 프로젝트 연결이 필요할 때

1. Supabase Dashboard에서 **개발용** 프로젝트 생성 또는 기존 개발 프로젝트 선택. 운영 데이터가 있는 프로젝트에 POC를 적용하지 않는다. 연결할 프로젝트 ref와 개발용 여부를 알려주면 충분하며 비밀 키는 채팅에 붙여넣지 않는다.
2. 프로젝트 URL과 공개 publishable 키를 `.env.local` 또는 Vercel 개발/미리보기 환경 설정에 등록. 이 두 값만 VITE_*로 노출한다.
3. Supabase CLI를 사용자 권한으로 연결하려면 로컬의 보안 설정에서 Supabase 로그인/CLI 인증을 구성한다. 필요할 때만 SUPABASE_ACCESS_TOKEN을 환경 비밀 관리에 등록한다. DB 비밀번호 역시 비밀 관리자에서만 제공한다. 토큰/비밀번호는 브라우저 변수로 쓰지 않는다.
4. Edge 런타임은 SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY를 제공한다. service_role은 사용자에게 달라고 하거나 Vercel 프런트에 넣을 필요가 없다. APP_ALLOWED_ORIGINS에는 실제 개발 프런트 HTTPS origin만 등록한다.
5. POC의 원격 배포는 기본 범위 밖이다. 운영 모델과 migration이 준비된 이후 별도의 개발 환경에서 권한/HTTP/Realtime 테스트를 다시 수행한다. 로컬 성공은 원격 성공의 증거가 아니다.

## Vercel (M7 배포 시)

GitHub의 audwns1322/party-game를 연결하고 Vite preset, build=`npm run build`, output=`dist` 설정. URL/공개 키만 등록한다. service_role·DB 비밀번호·참가자 토큰은 등록하지 않는다. 나중에 SPA의 /room/:code 경로가 추가되면 라우팅 rewrite도 검증한다. 현재는 배포 프로젝트를 생성하지 않았다.

## 네트워크와 플랜

- 현재 공식 사이트 supabase.com/vercel.com 직접 요청은 프록시 정책 403. 두 도메인을 기존 프리셋을 보존해 환경 설정 초안에 추가했다. 사용자 환경 설정에서 검토·저장 후 게시해야 재사용 환경에 반영된다. 초안 저장은 런타임 허용이나 게시 완료를 뜻하지 않는다.
- 원격 개발 연결 시 선택한 `<project-ref>.supabase.co`, CLI 관리 작업에는 api.supabase.com 등 실제 필요한 목적지를 별도 추가한다. 모든 supabase 도메인을 추측으로 넓게 허용하지 않는다.
- 로컬 기본 이미지 public.ecr.aws가 차단되어 지원되는 Docker Hub 경로로 전환. 별도의 ECR 네트워크 완화는 필요하지 않았다.
- Supabase Free Realtime 수치는 DECISIONS.md 공식 원본 조사 참고. Vercel Hobby의 현재 쿼터·상업 서비스 자격은 출시 전 검증해야 한다. 무료 운영/무제한 접속은 보장하지 않는다.

## 선택한 원격 개발 대상

- 사용자 제공 URL: https://wmgpshtqqsqwgyigxcwl.supabase.co
- 프로젝트 ref: wmgpshtqqsqwgyigxcwl
- URL 설정 및 목적지 허용 초안 저장. 공개 publishable 키는 사용자 제공 값으로 Git 제외 .env.local에 등록했다. 원격 배포 권한은 아직 등록되지 않았다.
- 현재 목적지 요청은 네트워크 프록시 CONNECT 403으로 차단되어 원격 서비스 상태/인증은 미검증. Supabase가 반환한 접근 거부가 아니다.
- 프런트 공개 키 등록은 DB 마이그레이션/Edge 배포 권한을 부여하지 않는다. 관리 인증은 다음 연결 단계에서 별도로 구성한다.
