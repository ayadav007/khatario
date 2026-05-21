# Server infrastructure & environments

**Read this before deploying, debugging production/staging issues, or building the Android APK.**

Khatario currently runs on a **single VPS** in **staging mode**. Production domain (`app.khatario.com`) is **not live yet** — do not assume it exists when building or testing.

---

## Environments

| | **Staging (current)** | **Production (future)** |
|---|---|---|
| Public URL | `https://staging.khatario.com` | `https://app.khatario.com` |
| Nginx vhost | `/etc/nginx/sites-available/khatario-staging` | Not configured yet |
| PM2 app name | `khatario-staging` (default in deploy script) | TBD (e.g. `khatario`) |
| App path on VPS | `/var/www/khatario` | Same path or separate — TBD |
| Android `CAP_SERVER_URL` | `https://staging.khatario.com` | `https://app.khatario.com` |
| Status | **Active — use this for all testing** | Planned after staging sign-off |

### Common mistake

The Capacitor default in `lib/capacitor/server-url.ts` is **`https://app.khatario.com`**. If you run `npm run cap:sync` without setting `CAP_SERVER_URL`, the APK loads production — which **does not have a proper nginx vhost yet** and may hit a catch-all server block (wrong limits, 413 errors, no PM2 logs).

**Always use the staging scripts** (see [Android builds](#android-builds)) until production is explicitly launched.

---

## VPS layout

| Item | Value |
|---|---|
| Host | `srv902952` (Hostinger VPS) |
| App root | `/var/www/khatario` |
| Process manager | PM2 |
| Web server | nginx → reverse proxy to Next.js |
| Deploy script | `bash scripts/deploy-vps.sh` |
| CI deploy | `.github/workflows/deploy-vps.yml` (push to `main` → SSH deploy) |

### Deploy flow (on VPS)

```bash
cd /var/www/khatario
bash scripts/deploy-vps.sh
# or after manual git pull:
bash scripts/deploy-vps.sh --no-pull
```

Steps: `npm ci` → `npm run db:migrate:pending` → `npm run build` → `pm2 restart khatario-staging --update-env`

Env file: `.env.production` (falls back to `.env`). Key vars:

- `PM2_APP_NAME=khatario-staging`
- `NEXT_PUBLIC_APP_URL=https://staging.khatario.com` (links in emails/PDFs should match the environment)

---

## nginx

**Staging** (`khatario-staging` site, enabled):

- Serves `staging.khatario.com`
- Proxies to the PM2 Next.js port for `khatario-staging`

**Production** (`app.khatario.com`):

- **Not set up yet** — DNS may point at the VPS, but there is no dedicated vhost in `sites-enabled`
- Requests to `app.khatario.com` can fall through to another server block (e.g. default 1 MB body limit → **HTTP 413** on large uploads)

### Required nginx settings (staging & future production)

For bill scan / invoice extract (`POST /api/invoices/extract`, up to ~10 MB photos):

```nginx
client_max_body_size 12M;
proxy_read_timeout 120s;
proxy_send_timeout 120s;
```

After editing:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

---

## Android builds

The APK is a **thin Capacitor shell** — it loads the remote web app via `server.url`. Web content updates on deploy; **rebuild the APK only when** native plugins, permissions, or `CAP_SERVER_URL` change.

### Use these scripts (do not rely on defaults)

```bash
# Staging — current default for all phone testing
npm run cap:android:staging:install

# Production — only after app.khatario.com is live + nginx vhost exists
npm run cap:android:production:install
```

Implementation: `scripts/cap-android-build.mjs` sets `CAP_SERVER_URL` explicitly per environment.

### Verify after sync

Check `android/app/src/main/assets/capacitor.config.json`:

- Staging: `"url": "https://staging.khatario.com/login"`
- Production: `"url": "https://app.khatario.com/login"`

### Manual (PowerShell on Windows)

```powershell
$env:CAP_SERVER_URL="https://staging.khatario.com"
npx cap sync android
cd android
.\gradlew.bat installDebug
```

Phone must be connected with USB debugging (`adb devices`).

---

## Related services

| Service | Notes |
|---|---|
| PostgreSQL | On VPS; migrations via `npm run db:migrate:pending` |
| OCR service | Optional on `:4000`; not started by deploy script — needed for PDF/fallback OCR |
| Invoice extract | `EXTRACTION_MODE=vision`, `INVOICE_VISION_PROVIDER=google` — camera path uses Google Vision + Groq |
| WhatsApp workers | Separate PM2 processes; see `docs/WHATSAPP_INTEGRATION.md` |

---

## Debugging checklist

| Symptom | Likely cause |
|---|---|
| 413 on `/api/invoices/extract`, no PM2 log | nginx `client_max_body_size` too small, or wrong vhost (e.g. app domain without config) |
| App loads wrong site | APK built without staging `CAP_SERVER_URL` |
| Subscription page 500 | Pending DB migration on VPS |
| "Feature not available in your plan" | Plan/trial limits — separate from extract/nginx issues |

Debug scripts (on VPS after deploy):

```bash
node scripts/debug-invoice-extract.js
node scripts/debug-whatsapp-ai-config.js
```

---

## Going to production (later)

1. Add nginx vhost for `app.khatario.com` (same body size limits as staging).
2. Set `NEXT_PUBLIC_APP_URL=https://app.khatario.com` in production env.
3. PM2 app name / port as needed.
4. Build APK with `npm run cap:android:production:install`.
5. Update this doc — mark production as active.
