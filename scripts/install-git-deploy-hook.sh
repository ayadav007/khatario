#!/usr/bin/env bash
# Install a git post-merge hook so `git pull` runs pending DB migrations automatically.
# Full deploy (build + pm2) still uses: ./scripts/deploy-vps.sh
#
# Usage: bash scripts/install-git-deploy-hook.sh

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOOK="$ROOT/.git/hooks/post-merge"

cat > "$HOOK" << 'EOF'
#!/bin/sh
# Auto-run pending migrations after git pull (merge).
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT" || exit 0

echo ""
echo ">> post-merge: running pending database migrations..."
if npm run db:migrate:pending; then
  echo ">> post-merge: migrations OK"
else
  echo ">> post-merge: migrations FAILED — run ./scripts/deploy-vps.sh or check logs"
  exit 1
fi
echo ""
EOF

chmod +x "$HOOK"
echo "Installed $HOOK"
echo ""
echo "Now every 'git pull' on this machine will run pending migrations."
echo "For full deploy (install + build + pm2 restart), use: ./scripts/deploy-vps.sh"
