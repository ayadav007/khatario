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
| Todo reminders | PM2 `todo-reminder-worker` (`pm2 start npm --name todo-reminder-worker -- run worker:todo`, then `pm2 save`). Delivers BullMQ jobs at the exact time and sweeps the DB every 30s for anything due that the queue missed. Without it no todo reminder is ever delivered. Production clone: set `PM2_WORKER_NAME` to a separate name |
| WhatsApp workers | Tenant Baileys inbox — see `docs/WHATSAPP_INTEGRATION.md`. Not in PM2 yet |
| Platform Meta Cloud API | Save credentials in `/admin` → WhatsApp templates (encrypted in DB). Tenant Cloud API: Settings → WhatsApp. `META_WA_*` env is optional fallback only |
| Razorpay | Add `PLATFORM_RAZORPAY_*` to the **production** env; webhook `https://khatario.com/api/webhooks/platform-billing/razorpay` |
| Cron | Both environments need `CRON_SECRET` in `.env.production` and a crontab — see below |
| AI assistant | pgvector, `GROQ_API_KEY` / `GEMINI_API_KEY`, and the `kb-index-worker` PM2 process — see [AI assistant](#ai-assistant-staging-first) and `docs/ASSISTANT.md` |

### Cron (staging and production)

Trial expiry, trial/grace reminders (email + platform WhatsApp + in-app bell) and usage snapshots run from `/api/cron/check-subscriptions`. Without a crontab, trials never move to Free and nobody is reminded.

1. Put a random `CRON_SECRET` in that clone’s `.env.production` (`openssl rand -hex 32`), then `pm2 restart <app> --update-env`. Use a **different** secret per environment, and rotate it if it is ever pasted into chat or a ticket.
2. `crontab -e` as the deploy user (times are server time):

```cron
# Staging
15 3 * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/check-subscriptions >> /var/log/khatario-cron-staging.log 2>&1
45 0 * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/recurring-invoices >> /var/log/khatario-cron-staging.log 2>&1
0 9 * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/gst-compliance-alerts >> /var/log/khatario-cron-staging.log 2>&1
*/15 * * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/owner-daily-summary >> /var/log/khatario-cron-staging.log 2>&1
*/15 * * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/send-payment-reminders >> /var/log/khatario-cron-staging.log 2>&1
*/5 * * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/sales-funnel >> /var/log/khatario-cron-staging.log 2>&1
0 * * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/order-dispatch-alerts >> /var/log/khatario-cron-staging.log 2>&1
*/15 * * * * . /var/www/khatario/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://staging.khatario.com/api/cron/whatsapp-auto-resolve >> /var/log/khatario-cron-staging.log 2>&1
# Production (only after scripts/setup-khatario-production.sh)
30 3 * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/check-subscriptions >> /var/log/khatario-cron.log 2>&1
50 0 * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/recurring-invoices >> /var/log/khatario-cron.log 2>&1
5 9 * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/gst-compliance-alerts >> /var/log/khatario-cron.log 2>&1
*/15 * * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/owner-daily-summary >> /var/log/khatario-cron.log 2>&1
*/15 * * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/send-payment-reminders >> /var/log/khatario-cron.log 2>&1
*/5 * * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/sales-funnel >> /var/log/khatario-cron.log 2>&1
0 * * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/order-dispatch-alerts >> /var/log/khatario-cron.log 2>&1
*/15 * * * * . /var/www/khatario-prod/.env.production; curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://khatario.com/api/cron/whatsapp-auto-resolve >> /var/log/khatario-cron.log 2>&1
```

`/api/cron/whatsapp-auto-resolve` keeps the WhatsApp inbox tidy: chats owned by a removed or deactivated agent go back to Requesting, and chats an agent intervened in are resolved (handed back to the bot) once the customer has been silent for 24 hours. Businesses can switch auto-resolve off in Settings > WhatsApp > Inbox. Both steps only touch chats that still qualify, so repeated runs are safe.

`/api/cron/order-dispatch-alerts` WhatsApps the owner when paid orders have waited longer than the dispatch time set on the Orders page (only for businesses that switched the alert on). Each business gets at most one alert every 20 hours, so the hourly schedule is safe.

`/api/cron/sales-funnel` runs the WhatsApp sales funnel for Meta ad leads (Admin > Sales flow): it marks leads activated (first invoice) or converted (paid plan), then sends due follow-ups, as normal messages inside WhatsApp's 24-hour window and as approved templates outside it. Each follow-up goes at most once per lead, so repeated runs are safe. The demo video and uploaded images are stored in `storage/sales-flow` inside the app folder (override with `SALES_FLOW_MEDIA_DIR`); keep that folder across deploys.

`/api/cron/owner-daily-summary` sends the owner's evening summary (Settings > WhatsApp > Owner updates) from the business's own WhatsApp number once the owner's chosen time has passed in Indian time, whatever the server time zone. Each business gets at most one per day (`owner_whatsapp_links.last_summary_sent_on`), so the 15-minute schedule is safe to repeat.

`/api/cron/gst-compliance-alerts` runs the GST checks in `lib/gst/compliance`: Rule 37, the 30 November ITC and credit-note deadline, GSTR-3B due dates, e-way bill numbers, e-invoicing applicability and RCM self-invoices. It raises in-app notifications and emails critical alerts (via SMTP, counted against the plan's email limit) only when an alert is new or reaches a new stage, so an extra run the same day is harmless. `?as_on=YYYY-MM-DD` replays a date for testing and is silent (no bell, no email) unless `&notify=true` is added.

`/api/cron/recurring-invoices` raises recurring invoices due on the current IST date (00:45 server time assumes the server runs in IST; adjust if it is UTC). Each run date is claimed in `recurring_invoice_history`, so re-running the job the same day does not duplicate invoices.

`/api/cron/send-payment-reminders` sends payment-due and overdue WhatsApp reminders inside each business’s 15-minute local send window. It must run every 15 minutes. A missed tick is retried on the next run until the invoice is paid or, for a due reminder, until the due date has passed. Without this crontab line, no automatic payment reminder is sent. With `REDIS_URL` set, the run only queues reminders (BullMQ queue `payment-reminders`); a worker inside the app process sends them, spacing QR-linked numbers 4–8 s apart per business while Cloud API (Connect) sends go straight out. Do not add a separate PM2 worker for it: QR sockets live in the app process. After a restart, queued reminders resume on the next cron tick. Without Redis the cron request sends inline, capped at 50 QR reminders per business per run.

The JSON response’s `summary.notificationsSent` counts only reminders that actually reached someone (email, WhatsApp or in-app). `subscription_notifications.metadata.channels` shows which channels delivered. Other jobs under `app/api/cron/` (low stock, backups, HR) use the same Bearer header.

### Staging-only test settings

- `OTP_DEBUG_PHONES=7769870606` (comma-separated, or `*`) in **staging** `.env.production` shows the OTP on screen for those numbers only, and the storefront accepts `123456` for them. The code ignores it when `NEXT_PUBLIC_APP_URL` is `https://khatario.com`, so it can never open production — but still never set it there.
- Migration `301_branch_document_counters.sql` (separate invoice / proforma / bill-of-supply number series per branch) must be applied in each clone: `npm run db:migrate:pending` on the VPS.

### AI assistant (staging first)

Migration `302_rag_foundation.sql` creates the assistant tables. It works without pgvector (keyword search only), so deploys never fail on it. To turn on meaning-based search, per server:

1. Install pgvector for the running Postgres major version, e.g. `sudo apt install postgresql-16-pgvector` (check with `psql -c 'SHOW server_version'`).
2. In each clone: `npm run kb:enable-vector`, then `npm run kb:reindex -- --force` once keys are set.
3. Add to that clone's `.env.production`, then `pm2 restart <app> --update-env`:
   - `GROQ_API_KEY`, `GEMINI_API_KEY` (use separate keys for staging and production)
   - optional: `ASSISTANT_DAILY_TOKEN_BUDGET`, `ASSISTANT_RETENTION_DAYS`, `ASSISTANT_ENABLED=false` to hide it
4. Start the queue worker once (it also runs the nightly 03:00 IST re-index and retention). Production uses Redis DB 1, so its `REDIS_URL` must already point there:

```bash
pm2 start npm --name kb-index-worker -- run worker:kb   # staging
pm2 start npm --name kb-index-worker-prod -- run worker:kb   # production clone; set PM2_KB_WORKER_NAME=kb-index-worker-prod
pm2 save
```

`scripts/deploy-vps.sh` re-indexes after migrations (warning only on failure) and restarts `PM2_KB_WORKER_NAME` (default `kb-index-worker`) if it exists. Without the worker, add a cron line calling `/api/cron/assistant-maintenance` like the other cron jobs.

QA on staging before production: ask a pricing question on `/book-demo` (answer should cite the plans source), ask "demo book karna hai" (booking card), check `/admin/assistant` for the conversation, then run `npx playwright test e2e/assistant.spec.ts` with `PLAYWRIGHT_BASE_URL=https://staging.khatario.com PLAYWRIGHT_SKIP_WEBSERVER=1`.

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
