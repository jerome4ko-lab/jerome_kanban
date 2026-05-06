# Pace — 칸반 보드

React/Vite 프런트, Node.js 백엔드, PostgreSQL을 사용하는 멀티 유저 칸반 보드. 가입 코드 기반 회원가입과 유저별 데이터 격리를 지원하며, PWA로 설치 가능하다. 자체 호스팅 Ubuntu 서버에 Docker Compose로 배포한다.

## 요구 사항

**로컬 개발**
- Node.js 18 이상
- npm

**서버**
- Ubuntu (또는 Docker가 동작하는 Linux)
- Docker Engine + `docker compose` plugin
- SSH 키 등록 (배포 스크립트가 비밀번호 없이 동작하려면)

## 로컬 개발

```bash
cp .env.example .env
# .env의 DATABASE_URL의 호스트(db)를 localhost로 변경, 비밀번호/시크릿 설정
npm install
npm run dev      # 프런트 dev 서버 (port 5175)
# 백엔드까지 같이 띄우려면:
npm run build && npm run start   # 통합 서버 (port 4173)
```

## 환경 변수

`.env.example`을 복사해 `.env`로 만든 뒤 값을 채워 넣는다. **`.env`는 git에 커밋하지 않는다 — 서버에만 존재.**

| 키 | 필수 | 설명 |
| --- | --- | --- |
| `DATABASE_URL` | ✓ | PostgreSQL 접속 문자열. compose 내부에서는 호스트가 `postgres`. 로컬 개발 시 `localhost`로 변경. |
| `SESSION_SECRET` | ✓ | 세션 쿠키 서명용 시크릿. 충분히 긴 임의 문자열. |
| `SIGNUP_CODE` | ✓ | 회원가입 시 입력해야 하는 공유 시크릿. 미설정이면 가입 비활성화. |
| `ADMIN_PASSWORD` | 최초 1회 | users 테이블이 비어있을 때만 사용됨 — `jerome` admin 계정의 초기 비밀번호. 부트스트랩 후 제거 권장. |
| `ANTHROPIC_API_KEY` | | (선택) Anthropic API 키. |
| `ANTHROPIC_MODEL` | | (선택) 사용할 Claude 모델. 기본 `claude-sonnet-4-20250514`. |

HTTPS 도입 후에는 `docker-compose.yml`의 app 서비스 `environment`에 `NODE_ENV=production`을 추가해 Secure 쿠키를 활성화한다.

## 인증 / 회원가입

- 멀티 유저 시스템. 가입 코드를 아는 사람만 회원가입 가능.
- 비밀번호는 bcrypt(cost 12)로 해시 저장.
- 세션은 HMAC-SHA256 서명된 쿠키(`HttpOnly`, `SameSite=Lax`, 7일 만료)로 관리.
- 로그인 5회/분, 회원가입 3회/시간 IP 단위 레이트 리미트.
- 모든 데이터(칸반/구독/캘린더 메모)는 `user_id`로 격리. 다른 유저의 자원에는 접근 불가.

**최초 배포 시 `jerome` 계정 부트스트랩**:
1. 서버 `.env`에 `ADMIN_PASSWORD=...` 설정.
2. `docker compose up -d --build` — 시작 시 `users` 테이블이 비어있고 `ADMIN_PASSWORD`가 있으면 jerome 계정 자동 생성 + 기존 데이터 모두 jerome 소유로 백필.
3. 부트스트랩 후 `.env`에서 `ADMIN_PASSWORD`를 제거하고 컨테이너 재시작 권장.

추가 유저는 회원가입 화면(`SIGNUP_CODE` 필요)에서 가입한다.

## 배포

### 서버 최초 셋업 (1회)

```bash
ssh -p 2222 jerome@jerome-server.iptime.org
git clone git@github.com:jerome4ko-lab/jerome_kanban.git ~/jerome_kanban
cd ~/jerome_kanban
cp .env.example .env
# .env의 모든 값을 운영용으로 채움 (DATABASE_URL은 호스트 db 그대로)
docker compose up -d --build
```

### SSH 키 등록 (1회, 배포 스크립트 사용 전 필수)

```bash
ssh-copy-id -i ~/.ssh/id_ed25519.pub -p 2222 jerome@jerome-server.iptime.org
```

### 일상 배포

로컬에서 변경 사항을 commit한 후:

```bash
./scripts/deploy.sh
```

스크립트가 자동으로 수행:
1. 작업 트리가 깨끗한지 확인 (변경/스테이징/언트랙 검사)
2. 현재 브랜치를 `origin`에 push (upstream 없으면 자동 생성)
3. SSH로 서버 접속 → `git pull --ff-only` → `docker compose up -d --build` → `docker compose ps` 출력

첫 사용 시: `chmod +x scripts/deploy.sh`

## 데이터베이스

PostgreSQL은 `docker-compose.yml`의 `postgres` 서비스로 동작하며, 데이터는 명명 볼륨(`postgres_data`)에 영구 저장된다. 컨테이너를 재빌드해도 데이터는 보존된다.

**백업**:
```bash
ssh -p 2222 jerome@jerome-server.iptime.org \
  'cd ~/jerome_kanban && docker compose exec -T postgres pg_dump -U jerome kanban' > backup-$(date +%Y%m%d).sql
```

**복원**:
```bash
ssh -p 2222 jerome@jerome-server.iptime.org \
  'cd ~/jerome_kanban && docker compose exec -T postgres psql -U jerome kanban' < backup-YYYYMMDD.sql
```

## 트러블슈팅

**로그 실시간 확인**
```bash
ssh -p 2222 jerome@jerome-server.iptime.org \
  'cd ~/jerome_kanban && docker compose logs -f app'
```

**컨테이너 상태**
```bash
ssh -p 2222 jerome@jerome-server.iptime.org \
  'cd ~/jerome_kanban && docker compose ps'
```

**캐시 무시 강제 재빌드**
```bash
ssh -p 2222 jerome@jerome-server.iptime.org \
  'cd ~/jerome_kanban && docker compose build --no-cache && docker compose up -d'
```

**HTTPS 환경에서 로그인이 안 됨 / 세션이 끊김**
→ `docker-compose.yml`의 app 서비스 `environment`에 `NODE_ENV=production`이 있는지 확인. 누락되면 운영 환경에서 Secure 쿠키 플래그가 빠져 HTTPS 세션이 동작하지 않는다.

**jerome 계정으로 로그인 안 됨 (최초 배포 후)**
→ `ADMIN_PASSWORD`가 `.env`에 설정된 채로 컨테이너가 시작되었는지 확인. `docker compose logs app | grep schema`에서 부트스트랩 로그(`초기 admin 계정 'jerome' 부트스트랩 완료`) 확인.

**회원가입이 503으로 실패**
→ `.env`의 `SIGNUP_CODE`가 비어있음. 임의 문자열로 설정 후 컨테이너 재시작.

**로그인이 429로 차단됨**
→ 같은 IP에서 1분에 10회 이상 시도. 잠시 대기.

**롤백**
```bash
ssh -p 2222 jerome@jerome-server.iptime.org \
  'cd ~/jerome_kanban && git reset --hard HEAD~1 && docker compose up -d --build'
```
postgres 볼륨은 이미지 재빌드와 무관하게 보존된다.
