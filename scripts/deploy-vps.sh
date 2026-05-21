#!/usr/bin/env bash
# Deploy Khatario on VPS after git pull / PR merge.
#
# Usage (on VPS) — always use bash, do NOT chmod +x:
#   bash scripts/deploy-vps.sh
#   bash scripts/deploy-vps.sh --no-pull
#
# One-time on VPS (optional, ignores executable-bit noise in git status):
#   git config core.fileMode false
#
# Optional in .env.production:
#   PM2_APP_NAME=khatario-staging
#   PM2_WORKER_NAME=todo-reminder-worker
#   GIT_BRANCH=main
#   MIGRATION_BASELINE=239

set -eo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

trap 'echo "❌ Deploy failed at line $LINENO" >&2' ERR

# Never edit deploy scripts on the VPS. chmod +x / CRLF drift makes git pull fail.
restore_deploy_scripts() {
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    return 0
  fi
  for f in scripts/deploy-vps.sh scripts/install-git-deploy-hook.sh; do
    if git ls-files --error-unmatch "$f" >/dev/null 2>&1; then
      git restore --source=HEAD --staged --worktree "$f" 2>/dev/null \
        || git checkout HEAD -- "$f" 2>/dev/null \
        || true
    fi
  done
}

NO_PULL=false
for arg in "$@"; do
  if [[ "$arg" == "--no-pull" ]]; then NO_PULL=true; fi
done

# Read KEY=VALUE without sourcing (safe for encryption keys / special chars).
read_env_var() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^["'\''"]//;s/["'\''"]$//' | tr -d '\r' || true
}

ENV_FILE=".env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE=".env"
fi

PM2_APP_NAME="$(read_env_var "$ENV_FILE" PM2_APP_NAME)"
PM2_WORKER_NAME="$(read_env_var "$ENV_FILE" PM2_WORKER_NAME)"
GIT_BRANCH="$(read_env_var "$ENV_FILE" GIT_BRANCH)"
PM2_APP_NAME="${PM2_APP_NAME:-khatario-staging}"
PM2_WORKER_NAME="${PM2_WORKER_NAME:-todo-reminder-worker}"
GIT_BRANCH="${GIT_BRANCH:-main}"

echo ""
echo "=========================================="
echo "  Khatario deploy — $(date -Iseconds)"
echo "  PM2 app: $PM2_APP_NAME"
echo "=========================================="
echo ""

if [[ "$NO_PULL" == false ]]; then
  restore_deploy_scripts
  echo ">> git pull origin $GIT_BRANCH"
  git fetch origin "$GIT_BRANCH"
  git merge --ff-only "origin/$GIT_BRANCH"
  restore_deploy_scripts
  echo ""
fi

echo ">> npm ci"
if [[ -f package-lock.json ]]; then
  npm ci
else
  npm install
fi
echo ""

echo ">> npm run db:migrate:pending"
npm run db:migrate:pending
echo ""

echo ">> npm run build"
npm run build
echo ""

echo ">> pm2 restart $PM2_APP_NAME --update-env"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env || pm2 start npm --name "$PM2_APP_NAME" -- start
  if pm2 describe "$PM2_WORKER_NAME" >/dev/null 2>&1; then
    echo ">> pm2 restart $PM2_WORKER_NAME --update-env"
    pm2 restart "$PM2_WORKER_NAME" --update-env
  fi
  pm2 save
else
  echo "⚠️  pm2 not found — restart the app manually"
fi

echo ""
echo "✅ Deploy finished"
echo ""
