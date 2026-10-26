#!/usr/bin/env bash
# Deploy Khatario on VPS after git pull / PR merge.
#
# Usage (on VPS) — always use bash, do NOT chmod +x:
#   bash scripts/deploy-vps.sh
#   bash scripts/deploy-vps.sh --no-pull
#   bash scripts/deploy-vps.sh --full       # run every step, ignoring what changed since the last deploy
#
# Steps that only matter when their files change (npm ci, assistant knowledge re-index) are skipped
# when nothing they depend on changed since the last finished deploy. That commit is kept in
# .git/khatario-last-deploy; without it every step runs.
#
# One-time on VPS (optional, ignores executable-bit noise in git status):
#   git config core.fileMode false
#
# Optional in .env.production:
#   PM2_APP_NAME=khatario-staging
#   PM2_WORKER_NAME=todo-reminder-worker
#   PM2_KB_WORKER_NAME=kb-index-worker   # npm run worker:kb (assistant knowledge index)
#   GIT_BRANCH=main          # staging clone
#   GIT_BRANCH=production    # /var/www/khatario-prod — do not point production at main
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
FULL=false
for arg in "$@"; do
  if [[ "$arg" == "--no-pull" ]]; then NO_PULL=true; fi
  if [[ "$arg" == "--full" ]]; then FULL=true; fi
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
PM2_ECOSYSTEM="$(read_env_var "$ENV_FILE" PM2_ECOSYSTEM)"
PM2_START_SCRIPT="$(read_env_var "$ENV_FILE" PM2_START_SCRIPT)"
GIT_BRANCH="$(read_env_var "$ENV_FILE" GIT_BRANCH)"
PM2_APP_NAME="${PM2_APP_NAME:-khatario-staging}"
PM2_WORKER_NAME="${PM2_WORKER_NAME:-todo-reminder-worker}"
PM2_KB_WORKER_NAME="$(read_env_var "$ENV_FILE" PM2_KB_WORKER_NAME)"
PM2_KB_WORKER_NAME="${PM2_KB_WORKER_NAME:-kb-index-worker}"
PM2_START_SCRIPT="${PM2_START_SCRIPT:-start}"
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

# Commit of the last finished deploy, kept inside .git so it never shows up as a change.
GIT_DIR_PATH="$(git rev-parse --git-dir 2>/dev/null || true)"
STATE_FILE="${GIT_DIR_PATH:+$GIT_DIR_PATH/khatario-last-deploy}"
CURRENT_COMMIT="$(git rev-parse HEAD 2>/dev/null || true)"
PREV_DEPLOY=""
if [[ "$FULL" == false && -n "$STATE_FILE" && -f "$STATE_FILE" ]]; then
  PREV_DEPLOY="$(tr -d '[:space:]' < "$STATE_FILE")"
  if [[ -n "$PREV_DEPLOY" ]] && ! git cat-file -e "${PREV_DEPLOY}^{commit}" 2>/dev/null; then
    PREV_DEPLOY=""
  fi
fi
if [[ -n "$PREV_DEPLOY" ]]; then
  echo ">> changes since the last deploy: ${PREV_DEPLOY:0:12}..${CURRENT_COMMIT:0:12}"
else
  echo ">> no record of the last deploy (or --full): running every step"
fi
echo ""

# True when any of the given paths changed since the last finished deploy, or there is no record of one.
changed_since_deploy() {
  if [[ -z "$PREV_DEPLOY" ]]; then
    return 0
  fi
  ! git diff --quiet "$PREV_DEPLOY" HEAD -- "$@"
}

# onnxruntime-node (staff face check) would otherwise download its CUDA add-on on linux/x64;
# the face models run on the CPU, so skip it.
export ONNXRUNTIME_NODE_INSTALL=skip

# Dependencies only change with package.json, the lockfile or patch-package patches.
if [[ -d node_modules ]] && ! changed_since_deploy package.json package-lock.json patches; then
  echo ">> npm ci skipped: package.json, package-lock.json and patches/ unchanged since the last deploy"
else
  echo ">> npm ci"
  # The VPS shell often has NODE_ENV=production, which makes npm skip
  # devDependencies. The build needs TypeScript and Tailwind, and postinstall
  # runs patch-package from devDependencies.
  if [[ -f package-lock.json ]]; then
    NODE_ENV=development npm ci --include=dev
  else
    NODE_ENV=development npm install --include=dev
  fi
fi
echo ""

# Khatario Staff face check (YuNet + SFace, matched on this server). Skips files already in place.
echo ">> npm run face:models"
if ! npm run face:models; then
  echo "⚠️  Face models missing — staff check-ins with face check go to manager review until fixed (deploy continues)"
fi
echo ""

echo ">> npm run db:migrate:pending"
npm run db:migrate:pending
echo ""

# Help docs only. Plans and marketing pages are re-indexed by kb-index-worker when an admin saves
# them and nightly at 03:00. Runs when knowledge/ or the indexing code changed, or when a help-doc
# source was left in error (for example the embedding quota ran out part-way last time).
REINDEX_REASON=""
if changed_since_deploy knowledge lib/rag/ingest lib/rag/embed.ts lib/rag/config.ts; then
  REINDEX_REASON="knowledge/ or the indexing code changed"
else
  # Inside an if, so a non-zero exit does not trip the ERR trap.
  if node scripts/kb/markdown-in-error.js; then
    KB_CHECK=0
  else
    KB_CHECK=$?
  fi
  if [[ "$KB_CHECK" -eq 10 ]]; then
    REINDEX_REASON="help-doc sources left in error"
  elif [[ "$KB_CHECK" -ne 0 ]]; then
    REINDEX_REASON="could not check knowledge source status"
  fi
fi
if [[ -n "$REINDEX_REASON" ]]; then
  echo ">> assistant knowledge re-index (help docs): $REINDEX_REASON"
  # Unchanged documents are still skipped by content hash; only changed chunks are embedded.
  if ! NODE_ENV=production npx ts-node --project tsconfig.worker.json --transpile-only \
    -r tsconfig-paths/register -r dotenv/config scripts/kb/reindex.ts \
    dotenv_config_path="$ENV_FILE" --source=markdown; then
    echo "⚠️  Knowledge re-index reported errors — check kb_sources in /admin/assistant (deploy continues)"
  fi
else
  echo ">> assistant knowledge re-index skipped: knowledge/ and indexing code unchanged, no source in error"
fi
echo ""

# The build typechecks .next/types first; types left from the last build still point at
# pages deleted since then. next build regenerates them, and the running server never reads them.
rm -rf .next/types

echo ">> npm run build"
npm run build
echo ""

if command -v pm2 >/dev/null 2>&1; then
  if pm2 describe "$PM2_APP_NAME" >/dev/null 2>&1; then
    # reload: in cluster mode PM2 replaces instances one at a time with no downtime; in fork mode
    # it behaves like restart.
    echo ">> pm2 reload $PM2_APP_NAME --update-env"
    pm2 reload "$PM2_APP_NAME" --update-env
  elif [[ -n "$PM2_ECOSYSTEM" && -f "$PM2_ECOSYSTEM" ]]; then
    echo ">> pm2 start $PM2_ECOSYSTEM"
    pm2 start "$PM2_ECOSYSTEM"
  else
    echo ">> pm2 start npm --name $PM2_APP_NAME -- run $PM2_START_SCRIPT"
    pm2 start npm --name "$PM2_APP_NAME" -- run "$PM2_START_SCRIPT"
  fi
  # Without this worker no todo reminder (and so no reminder popup) is ever delivered.
  if pm2 describe "$PM2_WORKER_NAME" >/dev/null 2>&1; then
    echo ">> pm2 restart $PM2_WORKER_NAME --update-env"
    pm2 restart "$PM2_WORKER_NAME" --update-env
  else
    echo ">> pm2 start npm --name $PM2_WORKER_NAME -- run worker:todo"
    pm2 start npm --name "$PM2_WORKER_NAME" -- run worker:todo
  fi
  if pm2 describe "$PM2_KB_WORKER_NAME" >/dev/null 2>&1; then
    echo ">> pm2 restart $PM2_KB_WORKER_NAME --update-env"
    pm2 restart "$PM2_KB_WORKER_NAME" --update-env
  fi
  pm2 save
else
  echo "⚠️  pm2 not found — restart the app manually"
fi

# Only a finished deploy is recorded, so after a failed one every changed step runs again.
if [[ -n "$STATE_FILE" && -n "$CURRENT_COMMIT" ]]; then
  echo "$CURRENT_COMMIT" > "$STATE_FILE"
fi

echo ""
echo "✅ Deploy finished"
echo ""
