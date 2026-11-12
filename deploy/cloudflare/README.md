# Cloudflare edge rules

`scripts/cloudflare-edge-rules.mjs` holds the rules and applies them to the `khatario.com` zone. They are zone-wide, so they cover `khatario.com`, `www`, `app` and `staging.khatario.com`. They do **not** cover `*.staging.khatario.com` store hosts, which are DNS-only (grey cloud).

## Run it

Create an API token in Cloudflare (My Profile > API Tokens) with **Zone > Zone WAF > Edit**, limited to the `khatario.com` zone. Keep it out of the repo.

```bash
node scripts/cloudflare-edge-rules.mjs --print          # the rules as JSON, no network
CF_API_TOKEN=... CF_ZONE_ID=... node scripts/cloudflare-edge-rules.mjs          # dry run: shows keep/remove/add
CF_API_TOKEN=... CF_ZONE_ID=... node scripts/cloudflare-edge-rules.mjs --apply  # writes
```

The script replaces only rules whose description starts with `[khatario]`. Rules added by hand in the dashboard are kept and run after ours. Running it again is safe.

## What it sets

| Phase | Rule | Action |
|---|---|---|
| Custom rules | Payment, store and WhatsApp webhooks (`/api/webhooks/*`, `/api/payments/webhook*`, `/api/whatsapp/webhook`) | Skip the rest of our rules |
| Custom rules | Scanner probes: `.php`, `/.env`, `/.git`, `/wp-admin`, `/phpmyadmin`, `.asp`/`.jsp`, scanner user agents (sqlmap, nikto, nuclei...) | Block |
| Custom rules | SQL injection, XSS, path traversal, JNDI in the decoded URL and query string | Block |
| Custom rules | Scraping libraries (python-requests, curl, wget, scrapy, Go, axios...) and empty user agents on pages, not `/api/*` | Block |
| Rate limiting | Login, forgot/reset password and OTP routes, merchant, admin, partner, employee, customer portal, candidate, store and attendance: 10 requests per 10 s per IP | Block for 10 s |

Free plan allows 5 custom rules (we use 4) and 1 rate-limiting rule (10 s period, 10 s block). The app's own limits (5 logins per 15 min per IP, OTP limits per phone) still apply behind it.

Kept out on purpose:
- **`/api/*` is never challenged.** The Capacitor and Flutter apps call it and cannot solve a JavaScript challenge. Cron jobs call `/api/cron/*` with `curl` through Cloudflare.
- **HeadlessChrome is not blocked.** Playwright e2e runs against staging, and Lighthouse use it.
- **`/.well-known/` stays open** (Android asset links, Apple app links).
- **HEAD requests** skip the scraper rule so `curl -sI https://khatario.com/login` still works.
- Verified bots (`cf.client.bot`: Googlebot, Bingbot, WhatsApp/Facebook link previews) pass the scraper rule, which the SEO work needs.

## Dashboard settings the script does not touch

- **Do not turn on Bot Fight Mode on the Free plan.** It cannot be skipped per path, so it would challenge the Razorpay, Easebuzz, PhonePe, Shiprocket and Meta webhooks and the mobile apps. On Pro, use Super Bot Fight Mode with "Definitely automated: Block" and add `/api/*` to a skip rule first.
- **Managed rules:** the Cloudflare Free Managed Ruleset is on by default; leave it on. On Pro, deploy the Cloudflare Managed Ruleset and the OWASP Core Ruleset (paranoia level 1, threshold medium), first in Log mode for a week, then Block.
- **Pro rate limit:** rerun with `CF_RL_PERIOD=60 CF_RL_REQUESTS=30 CF_RL_TIMEOUT=600` for a 60 s window and a 10 minute block.

## After applying

1. Security > Events, filter by "Rule ID" or the `[khatario]` description, for 24 hours. A legitimate path showing up means a rule needs an exception.
2. On staging, run the login e2e (`PLAYWRIGHT_BASE_URL=https://staging.khatario.com PLAYWRIGHT_SKIP_WEBSERVER=1`). Ten parallel logins from one IP in 10 s will hit the edge limit; lower the worker count if so.
3. Make one test payment webhook and one WhatsApp message on staging and check they arrive.

## Gap: the origin is reachable without Cloudflare

These rules only see traffic that comes through Cloudflare. If someone finds the VPS IP, they can call nginx directly and skip all of it. The fix is a firewall on the VPS that accepts 80/443 only from Cloudflare's ranges (the same list as `set_real_ip_from` in `deploy/nginx/khatario-ssl.conf`), or Authenticated Origin Pulls. The DNS-only `*.staging.khatario.com` store hosts need direct access, so this needs planning before it is done.
