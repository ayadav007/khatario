#!/usr/bin/env bash
# Deploy Khatario on VPS after git pull / PR merge.
#
# Usage (on VPS):
#   ./scripts/deploy-vps.sh
#   ./scripts/deploy-vps.sh --no-pull    # skip git pull (already pulled)
#
# Optional env (.env.production) — read safely, not sourced:
#   PM2_APP_NAME=khatario
#   PM2_WORKER_NAME=todo-reminder-worker
#   GIT_BRANCH=main
#   MIGRATION_BASELINE=239

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

NO_PULL=false
for arg in "$@"; do
  if [[ "$arg" == "--no-pull" ]]; then NO_PULL=true; fi
done

# Read a single KEY=VALUE from env files without sourcing (avoids bash parsing errors).
read_env_var() {
  local file="$1"
  local key="$2"
  if [[ ! -f "$file" ]]; then
    return 0
  fi
  grep -E "^${key}=" "$file" 2>/dev/null | tail -1 | cut -d= -f2- | sed 's/^["'\''"]//;s/["'\''"]$//' | tr -d '\r'
}

ENV_FILE=".env.production"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE=".env"
fi

PM2_APP_NAME="$(read_env_var "$ENV_FILE" PM2_APP_NAME)"
PM2_WORKER_NAME="$(read_env_var "$ENV_FILE" PM2_WORKER_NAME)"
GIT_BRANCH="$(read_env_var "$ENV_FILE" GIT_BRANCH)"
PM2_APP_NAME="${PM2_APP_NAME:-khatario}"
PM2_WORKER_NAME="${PM2_WORKER_NAME:-todo-reminder-worker}"
GIT_BRANCH="${GIT_BRANCH:-main}"

echo ""
echo "=========================================="
echo "  Khatario deploy — $(date -Iseconds)"
echo "=========================================="
echo ""

if [[ "$NO_PULL" == false ]]; then
  echo ">> git pull origin $GIT_BRANCH"
  git pull origin "$GIT_BRANCH"
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

echo ">> pm2 restart $PM2_APP_NAME"
if command -v pm2 >/dev/null 2>&1; then
  pm2 restart "$PM2_APP_NAME" --update-env || pm2 start npm --name "$PM2_APP_NAME" -- start
  if pm2 describe "$PM2_WORKER_NAME" >/dev/null 2>&1; then
    echo ">> pm2 restart $PM2_WORKER_NAME"
    pm2 restart "$PM2_WORKER_NAME" --update-env
  fi
  pm2 save
else
  echo "⚠️  pm2 not found — restart the app manually"
fi

echo ""
echo "✅ Deploy finished"
echo ""
