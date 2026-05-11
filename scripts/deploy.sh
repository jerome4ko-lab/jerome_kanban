#!/usr/bin/env bash
set -euo pipefail

# ---- SSH 상수 ---------------------------------------------------------------
HOST="jerome-server.iptime.org"
PORT="2222"
USER="jerome"
REMOTE_PATH="~/docker/jerome_kanban"
# -----------------------------------------------------------------------------

step() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31mxx %s\033[0m\n' "$*" >&2; exit 1; }

cd "$(dirname "$0")/.."

step "작업 트리 상태 확인"
if ! git diff --quiet || ! git diff --cached --quiet; then
  fail "변경 사항이 있습니다. commit 또는 stash 후 다시 실행하세요."
fi
if [ -n "$(git ls-files --others --exclude-standard)" ]; then
  fail "추적되지 않은 파일이 있습니다. commit/stash 또는 .gitignore 처리 후 실행하세요."
fi

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
step "브랜치 '$BRANCH' 푸시"
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push
else
  echo "upstream 미설정 — origin/$BRANCH로 새로 push합니다."
  git push -u origin "$BRANCH"
fi

step "서버 배포: $USER@$HOST:$PORT"
ssh -p "$PORT" "$USER@$HOST" bash -s <<EOF
set -euo pipefail
cd $REMOTE_PATH
echo "==> git pull --ff-only"
git pull --ff-only
echo "==> docker compose up -d --build"
docker compose up -d --build
echo "==> docker compose ps"
docker compose ps
EOF

step "배포 완료"
