# Pace — 칸반 보드

React/Vite 프런트, Node.js 백엔드, PostgreSQL을 사용하는 개인용 칸반 보드. PWA로 설치 가능하며 자체 호스팅 Ubuntu 서버에 Docker Compose로 배포한다.

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

| 키 | 설명 |
| --- | --- |
| `DATABASE_URL` | PostgreSQL 접속 문자열. compose 내부에서는 호스트가 `postgres`. 로컬 개발 시 `localhost`로 변경. |
| `APP_PASSWORD` | 공유 로그인 비밀번호. |
| `SESSION_SECRET` | 세션 쿠키 서명용 시크릿. 충분히 긴 임의 문자열. |
| `ANTHROPIC_API_KEY` | (선택) Anthropic API 키. |
| `ANTHROPIC_MODEL` | (선택) 사용할 Claude 모델. 기본 `claude-sonnet-4-20250514`. |

`NODE_ENV`은 `docker-compose.yml`에서 `production`으로 설정한다 (운영 환경 Secure 쿠키 활성화 조건).

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

**로그인이 안 됨 / 세션이 끊김**
→ `docker-compose.yml`의 app 서비스 `environment`에 `NODE_ENV=production`이 있는지 확인. 누락되면 운영 환경에서 Secure 쿠키 플래그가 빠져 HTTPS 세션이 동작하지 않는다.

**롤백**
```bash
ssh -p 2222 jerome@jerome-server.iptime.org \
  'cd ~/jerome_kanban && git reset --hard HEAD~1 && docker compose up -d --build'
```
postgres 볼륨은 이미지 재빌드와 무관하게 보존된다.
