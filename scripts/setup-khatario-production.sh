#!/usr/bin/env bash
# One-time production bootstrap on the shared Hostinger VPS.
# Leaves /var/www/khatario (staging) and PM2 khatario-staging untouched.
#
# Run as root on srv902952 AFTER this commit is on main (or copy the script up):
#   bash /var/www/khatario/scripts/setup-khatario-production.sh
#
# Optional:
#   bash scripts/setup-khatario-production.sh --with-certbot
#   bash scripts/setup-khatario-production.sh --skip-build   # nginx/db/env only
#
# Staging env is copied (API keys, SMTP). JWT_SECRET and CRON_SECRET are
# generated fresh so staging cookies cannot open production.
#
# Database: copies the LIVE staging *schema* (pg_dump --schema-only from
# `khatario`) plus catalog rows (plans/features/migration history).
# Does NOT copy businesses, users, invoices, or stores. Do not replay
# database/schema.sql or 001–288 on an empty DB.

set -euo pipefail

STAGING_ROOT="${STAGING_ROOT:-/var/www/khatario}"
PROD_ROOT="${PROD_ROOT:-/var/www/khatario-prod}"
PROD_DB="${PROD_DB:-khatario_prod}"
PROD_PORT="${PROD_PORT:-3002}"
PROD_URL="${PROD_URL:-https://khatario.com}"
GIT_BRANCH="${GIT_BRANCH:-main}"
NGINX_SITE_NAME="khatario"
CF_INI="${CF_INI:-/etc/letsencrypt/cloudflare.ini}"

WITH_CERTBOT=false
SKIP_BUILD=false
for arg in "$@"; do
  case "$arg" in
    --with-certbot) WITH_CERTBOT=true ;;
    --skip-build) SKIP_BUILD=true ;;
  esac
done

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root (on the VPS)." >&2
  exit 1
fi
if [[ ! -d "$STAGING_ROOT/.git" ]]; then
  echo "Staging clone not found at $STAGING_ROOT" >&2
  exit 1
fi
if [[ ! -f "$STAGING_ROOT/.env.production" ]]; then
  echo "Missing $STAGING_ROOT/.env.production" >&2
  exit 1
fi
if ss -lnt | grep -q ":${PROD_PORT} "; then
  echo "Port $PROD_PORT is already in use. Pick another PROD_PORT." >&2
  exit 1
fi

echo ""
echo "=========================================="
echo "  Khatario PRODUCTION bootstrap"
echo "  dir:  $PROD_ROOT"
echo "  db:   $PROD_DB"
echo "  port: $PROD_PORT"
echo "  url:  $PROD_URL"
echo "=========================================="
echo ""

echo ">> postgres database $PROD_DB"
if sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='${PROD_DB}'" | grep -qx 1; then
  echo "   already exists"
else
  sudo -u postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE ${PROD_DB} OWNER postgres;"
  echo "   created"
fi

echo ">> clone schema from staging database khatario (not schema.sql / not empty migrate)"
PROD_TABLES="$(sudo -u postgres psql -d "$PROD_DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'")"
PROD_TABLES="${PROD_TABLES//[[:space:]]/}"
if [[ "${PROD_TABLES:-0}" -gt 10 ]]; then
  echo "   $PROD_DB already has ${PROD_TABLES} tables — skip dump"
else
  sudo -u postgres pg_dump --schema-only --no-owner --no-acl khatario \
    | sudo -u postgres psql -v ON_ERROR_STOP=1 "$PROD_DB"
  echo "   schema restored"

  DUMP_T=()
  for t in \
    schema_migrations \
    platform_features \
    feature_flags \
    subscription_plans \
    subscription_plan_features \
    subscription_plan_limits
  do
    if sudo -u postgres psql -d khatario -tAc "SELECT to_regclass('public.${t}')" | grep -q "${t}"; then
      DUMP_T+=(-t "$t")
    fi
  done
  if [[ ${#DUMP_T[@]} -gt 0 ]]; then
    sudo -u postgres pg_dump --data-only --disable-triggers --no-owner --no-acl \
      "${DUMP_T[@]}" khatario \
      | sudo -u postgres psql -v ON_ERROR_STOP=1 "$PROD_DB"
    echo "   catalog + schema_migrations copied (${#DUMP_T[@]} tables)"
  fi
fi

echo ">> git clone $PROD_ROOT"
if [[ -d "$PROD_ROOT/.git" ]]; then
  git -C "$PROD_ROOT" fetch origin "$GIT_BRANCH"
  git -C "$PROD_ROOT" merge --ff-only "origin/$GIT_BRANCH"
else
  ORIGIN="$(git -C "$STAGING_ROOT" remote get-url origin)"
  git clone --branch "$GIT_BRANCH" "$ORIGIN" "$PROD_ROOT"
fi
git -C "$PROD_ROOT" config core.fileMode false

echo ">> write $PROD_ROOT/.env.production (from staging, secrets rotated)"
python3 - "$STAGING_ROOT/.env.production" "$PROD_ROOT/.env.production" "$PROD_DB" "$PROD_PORT" "$PROD_URL" <<'PY'
import secrets, sys
from urllib.parse import urlsplit, urlunsplit

src, dest, db_name, port, app_url = sys.argv[1:6]
raw = open(src, encoding="utf-8", errors="replace").read().splitlines()

# Last assignment wins (staging file has a duplicate NEXT_PUBLIC_APP_URL).
order = []
vals = {}
for line in raw:
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    if "=" not in line:
        continue
    key, _, value = line.partition("=")
    key = key.strip()
    if not key:
        continue
    if key not in vals:
        order.append(key)
    vals[key] = value.rstrip("\r")

def set_key(key, value):
    if key not in vals:
        order.append(key)
    vals[key] = value

set_key("NODE_ENV", "production")
set_key("PORT", port)
set_key("HOST", "127.0.0.1")
set_key("HOSTNAME", "127.0.0.1")
set_key("DB_NAME", db_name)
set_key("NEXT_PUBLIC_APP_URL", app_url)
set_key("PM2_APP_NAME", "khatario")
set_key("PM2_START_SCRIPT", "start:http")
set_key("PM2_ECOSYSTEM", "deploy/pm2/khatario.config.cjs")
set_key("JWT_SECRET", secrets.token_urlsafe(48))
set_key("CRON_SECRET", secrets.token_urlsafe(32))

mig = vals.get("MIGRATION_DATABASE_URL", "")
if mig:
    parts = urlsplit(mig)
    set_key("MIGRATION_DATABASE_URL", urlunsplit(parts._replace(path="/" + db_name)))

redis = vals.get("REDIS_URL", "redis://127.0.0.1:6379")
if redis:
    parts = urlsplit(redis)
    set_key("REDIS_URL", urlunsplit(parts._replace(path="/1")))

vals.pop("REMINDER_TEST_MINUTES", None)
order = [k for k in order if k in vals]

with open(dest, "w", encoding="utf-8") as fh:
    fh.write("# Generated by scripts/setup-khatario-production.sh — do not commit\n")
    for key in order:
        fh.write(f"{key}={vals[key]}\n")
print("   wrote env (JWT_SECRET and CRON_SECRET are new; not printed)")
PY
chmod 600 "$PROD_ROOT/.env.production"

echo ">> nginx site $NGINX_SITE_NAME"
NGINX_HTTP="$PROD_ROOT/deploy/nginx/khatario.conf"
NGINX_SSL="$PROD_ROOT/deploy/nginx/khatario-ssl.conf"
if [[ ! -f "$NGINX_HTTP" ]]; then
  NGINX_HTTP="$STAGING_ROOT/deploy/nginx/khatario.conf"
  NGINX_SSL="$STAGING_ROOT/deploy/nginx/khatario-ssl.conf"
fi
if [[ ! -f "$NGINX_HTTP" ]]; then
  echo "   nginx template missing — git pull origin main on staging first" >&2
  exit 1
fi
cp "$NGINX_HTTP" "/etc/nginx/sites-available/${NGINX_SITE_NAME}"
ln -sfn "/etc/nginx/sites-available/${NGINX_SITE_NAME}" "/etc/nginx/sites-enabled/${NGINX_SITE_NAME}"
nginx -t
systemctl reload nginx

if [[ "$WITH_CERTBOT" == true ]]; then
  echo ">> certbot wildcard for khatario.com + *.khatario.com"
    if [[ ! -f "$CF_INI" ]]; then
    echo "   missing $CF_INI — skip certbot" >&2
  else
    certbot certonly --dns-cloudflare \
      --dns-cloudflare-credentials "$CF_INI" \
      --dns-cloudflare-propagation-seconds 20 \
      -d khatario.com -d "*.khatario.com" \
      --non-interactive --agree-tos --keep-until-expiring \
      || echo "   certbot failed — HTTP origin still works behind Cloudflare"
    if [[ -f /etc/letsencrypt/live/khatario.com/fullchain.pem ]]; then
      cp "$NGINX_SSL" "/etc/nginx/sites-available/${NGINX_SITE_NAME}"
      nginx -t && systemctl reload nginx
      echo "   installed TLS nginx site"
    fi
  fi
fi

if [[ "$SKIP_BUILD" == true ]]; then
  echo ">> skip npm ci / migrate / build (--skip-build)"
  echo "   later: cd $PROD_ROOT && bash scripts/deploy-vps.sh --no-pull"
  echo ""
  echo "✅ nginx + database + env ready. Staging unchanged."
  exit 0
fi

echo ">> first production deploy (npm ci, migrate, build, pm2)"
cd "$PROD_ROOT"
bash scripts/deploy-vps.sh --no-pull

echo ""
echo "✅ Production process should be PM2 name: khatario"
echo "   Staging (khatario-staging) was not restarted by this script."
echo ""
echo "Smoke:"
echo "  curl -sI -H 'Host: khatario.com' http://127.0.0.1/ | head"
echo "  curl -sI https://khatario.com/login | head"
echo ""
echo "Still required before paying customers:"
echo "  - PLATFORM_RAZORPAY_* in $PROD_ROOT/.env.production, then pm2 restart khatario --update-env"
echo "  - Razorpay webhook https://khatario.com/api/webhooks/platform-billing/razorpay"
echo "  - crontab Bearer CRON_SECRET against https://khatario.com"
echo "  - GitHub secret VPS_PROD_APP_PATH=/var/www/khatario-prod"
echo "  - Signup / platform admin on khatario_prod (no staging tenants were copied)"
echo ""
