# Server infrastructure & environments

**Read this before deploying, debugging production/staging issues, or building the Android APK.**

Khatario runs on **one Hostinger VPS** with **two isolated app stacks**. Staging stays a sandbox. Production is a second clone, database, port, and PM2 process.

---

## Environments

| | **Staging** | **Production** |
|---|---|---|
| Public URL | `https://staging.khatario.com` | `https://khatario.com` |
| Aliases | `{store}.staging.khatario.com` | `www.khatario.com`, `app.khatario.com`, `{store}.khatario.com` |
| Nginx vhost | `khatario-staging` | `khatario` |
| PM2 app name | `khatario-staging` | `khatario` |
| App path | `/var/www/khatario` | `/var/www/khatario-prod` |
| Postgres | `khatario` | `khatario_prod` |
| Next listen | staging `.env.production` `PORT` (currently not 3000/4000) | `127.0.0.1:3002` |
| Redis | DB index from staging URL | Redis DB **1** (`redis://…/1`) |
| Android `CAP_SERVER_URL` | `https://staging.khatario.com` | `https://khatario.com` |
| Status | Active sandbox | Provision with `scripts/setup-khatario-production.sh` |

`crl.khatario.com` is a separate nginx site — do not fold it into the app vhost.

### Common mistake

Do not run `npm run cap:sync` without `CAP_SERVER_URL`. Use the staging or production scripts in [Android builds](#android-builds).

---

## VPS layout

| Item | Value |
|---|---|
| Host | `srv902952` (Hostinger VPS, `31.97.186.149`) |
| Other apps on the box | Digitable (several PM2 names), `andaman` — leave them alone |
| Process manager | PM2 |
| Web server | nginx reverse proxy |
| Staging deploy | `cd /var/www/khatario && bash scripts/deploy-vps.sh` (git branch **`main`**) |
| Production deploy | `cd /var/www/khatario-prod && bash scripts/deploy-vps.sh` (git branch **`production`**, not `main`) |
| Staging CI | `.github/workflows/deploy-vps.yml` (push `main` → `VPS_APP_PATH`) |
| Production CI | `.github/workflows/deploy-vps-production.yml` (**workflow_dispatch** + pull **`production`**) |

GitHub staging deploy secrets were empty as of 2026-09-26 — deploys have been manual SSH. Fill `VPS_HOST`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_APP_PATH=/var/www/khatario` for staging, and `VPS_PROD_APP_PATH=/var/www/khatario-prod` for production.

### First-time production (on the VPS)

Push this repo to `main`, then:

```bash
cd /var/www/khatario
git pull origin main
bash scripts/setup-khatario-production.sh --with-certbot
```

That script does **not** restart `khatario-staging`. It:

1. Creates Postgres `khatario_prod`
2. Copies the **live staging schema** (`pg_dump --schema-only khatario`) plus catalog rows (`schema_migrations`, plans, feature registry). It does **not** load `database/schema.sql` and does **not** replay 001–288 on an empty DB. Staging businesses/users/invoices are **not** copied.
3. Clones `/var/www/khatario-prod`
4. Copies staging `.env.production`, then sets production URL/port/DB/PM2 and **new** `JWT_SECRET` + `CRON_SECRET`
5. Enables nginx `khatario` → `127.0.0.1:3002`
6. Optionally issues Let’s Encrypt for `khatario.com` and `*.khatario.com` (same Cloudflare DNS plugin as staging)
7. `npm ci` → `db:migrate:pending` (should be empty if the dump is current) → build → `pm2 start` name `khatario`

Smoke:

```bash
curl -sI -H 'Host: khatario.com' http://127.0.0.1/ | head
curl -sI https://khatario.com/login | head
pm2 list
```

Staging should still be `https://staging.khatario.com`. Production has no tenant data: sign up a real business on `khatario.com`.

### What goes live where

- **`main`** = staging only (`/var/www/khatario`). WhatsApp Cloud templates, signup OTP experiments, and other sandbox work stay here until you explicitly copy them.
- **`production`** = what `khatario.com` should run (`/var/www/khatario-prod`). `git pull` on production must **not** use `main`.
- Admin **Releases** (`/admin/releases`) lists commits on `main` that are not on `production`.

To ship one fix to production after it is on `main`:

```bash
git checkout production
git cherry-pick <commit-on-main>
git push origin production
```

Then on the VPS:

```bash
cd /var/www/khatario-prod
git fetch origin
git checkout production
git merge --ff-only origin/production
# once: echo GIT_BRANCH=production >> .env.production
bash scripts/deploy-vps.sh --no-pull
```

The `/admin` 500 fix is already on `production` (`64ea128`) without the later Meta WABA / OTP commits.

### Later production deploys

```bash
cd /var/www/khatario-prod
bash scripts/deploy-vps.sh
```

Env file: `/var/www/khatario-prod/.env.production`

- `PM2_APP_NAME=khatario`
- `PM2_START_SCRIPT=start:http` (nginx talks HTTP, not `server.js` HTTPS)
- `NEXT_PUBLIC_APP_URL=https://khatario.com`
- `GIT_BRANCH=production`

---

## nginx

**Staging** (`khatario-staging`): `staging.khatario.com` on :80 (Cloudflare HTTPS) and `*.staging.khatario.com` on :443 (Let’s Encrypt, DNS-only stores).

**Production** (`khatario`): `khatario.com`, `www`, `app`, `*.khatario.com`. Templates: `deploy/nginx/khatario.conf` (HTTP origin) and `deploy/nginx/khatario-ssl.conf` (after certbot).

Exact `server_name` on staging and `crl.khatario.com` still wins over `*.khatario.com`.

### Required proxy limits (both environments)

```nginx
client_max_body_size 12M;
proxy_read_timeout 120s;
proxy_send_timeout 120s;
```

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Android builds

The APK is a **thin Capacitor shell**. Rebuild only when native plugins, permissions, `server.errorPath`, or `CAP_SERVER_URL` change. Picking a customer from the phone book needs `@capacitor/contacts` in the APK (`READ_CONTACTS`).

```bash
npm run cap:android:staging:install
npm run cap:android:production:install   # only after https://khatario.com serves the app
```

`scripts/cap-android-build.mjs` sets `CAP_SERVER_URL` per environment.

- Staging: `"url": "https://staging.khatario.com/login"`
- Production: `"url": "https://khatario.com/login"`
- Both: `"errorPath": "offline.html"`

---

## Related services

| Service | Notes |
|---|---|
| PostgreSQL | Staging `khatario` and production `khatario_prod`; migrations via `npm run db:migrate:pending` in that clone |
| Redis | Shared process; production uses logical DB 1 so BullMQ queues do not mix |
| OCR | Optional `:4000` — not running as of 2026-09-26; camera extract uses Google Vision + Groq |
| WhatsApp workers | Tenant Baileys inbox — see `docs/WHATSAPP_INTEGRATION.md`. Not in PM2 yet |
| Platform Meta Cloud API | Save credentials in `/admin` → WhatsApp templates (encrypted in DB). Tenant Cloud API: Settings → WhatsApp. `META_WA_*` env is optional fallback only |
| Razorpay | Add `PLATFORM_RAZORPAY_*` to the **production** env; webhook `https://khatario.com/api/webhooks/platform-billing/razorpay` |
| Cron | Production needs `CRON_SECRET` (generated by setup) and a crontab hitting `https://khatario.com` |

---

## Debugging checklist

| Symptom | Likely cause |
|---|---|
| 404 on khatario.com | Production nginx site not enabled, or Cloudflare origin still missing the vhost |
| Digitable / tenant-home on a Khatario host | Request hit the default SSL vhost — production `:443` cert/vhost missing |
| 413 on extract | Wrong vhost `client_max_body_size` |
| Staging data on khatario.com | Accidentally proxied production nginx to the staging port |
| Login 500 on production | Empty/wrong `khatario_prod` or JWT not loaded (`pm2 restart khatario --update-env`) |

---

## Platform Meta WhatsApp templates (staging first)

Khatario’s **platform** WABA (help@ number) is managed in `/admin` → **WhatsApp templates**. Enter access token, WABA ID, phone number ID, app secret, and webhook verify token on that page. They are stored encrypted (`SECRETS_ENCRYPTION_KEY` or `PAYMENT_ENCRYPTION_KEY`, same as tenant SMTP). Never commit tokens.

Businesses save their own Cloud API values under **Settings → WhatsApp** (QR/Baileys connection stays on the same page).

`META_WA_*` in `.env.production` is an optional fallback if the database row is empty. Prefer the UI.

Webhook (Cloudflare → staging nginx → Next):

`https://staging.khatario.com/api/webhooks/meta-whatsapp`

Tenants using their own Meta app should subscribe that app to:

`https://staging.khatario.com/api/webhooks/meta-whatsapp?business_id={businessUuid}`

In Meta App Dashboard subscribe to **`message_template_status_update`**. After `git pull` + `bash scripts/deploy-vps.sh`, migrations `290` and `291` run with other pending migrations.

OTP still falls back to Baileys when `PLATFORM_WHATSAPP_BUSINESS_ID` is set and no **approved** Cloud API template exists for `signup_otp` / `demo_booking_otp`. Email remains the primary path for subscription notices.

### Platform admin PWA and push (staging and production)

The merchant app and the operator console are different installs.

| | Staging | Production |
|---|---|---|
| Admin URL | `https://staging.khatario.com/admin` | `https://khatario.com/admin` |
| Home-screen name | Khatario Admin (Staging) | Khatario Admin |

On each environment: open `/admin` in the phone browser → **Install app** → log in → **Enable alerts**. iPhone: Share → Add to Home Screen, then open the icon before enabling notifications.

Optional env (otherwise keys are generated and stored encrypted in `platform_settings`):

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Signup welcome email goes to the **business email** (often left blank). Operator email goes to active `platform_admins` emails or the inbox override under Admin → Settings → Notifications. Check email logs there if a signup was silent.

```bash
node scripts/debug-invoice-extract.js
node scripts/debug-whatsapp-ai-config.js
```
