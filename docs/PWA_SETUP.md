# PWA (Progressive Web App) Setup

Khatario supports installable PWA behavior and offline app-shell caching on the **web deploy** (staging/production).

## What's included

| Asset | Purpose |
|-------|---------|
| `public/sw.js` | App-shell service worker (static assets + navigation fallback) |
| `app/manifest.json` | Install prompt metadata |
| `app/offline/page.tsx` | Offline navigation fallback |
| `components/system/ServiceWorkerRegistration.tsx` | Registers SW on remote origin |

**Android cold-start offline** uses Capacitor `errorPath` — see **`docs/COLD_START_OFFLINE.md`**.

## Install the app

1. Open Khatario in Chrome, Edge, or Safari
2. **Desktop:** install icon in the address bar
3. **Mobile:** “Add to Home Screen”

## Regenerate icons

```bash
npm run pwa:icons
```

## Service worker behavior

Registered automatically on `staging.khatario.com` / `app.khatario.com` (not on Capacitor local error pages).

| Resource | Strategy |
|----------|----------|
| `/api/*` | Network only |
| `/_next/static/*` | Cache-first |
| HTML pages | Network-first → cache → `/offline` |

After changing `public/sw.js`, bump the `CACHE_VERSION` constant and redeploy.

## Requirements

- **HTTPS** (localhost OK for dev)
- At least **one online visit** before offline shell cache is populated

## Troubleshooting

- **Install prompt missing:** HTTPS + two visits required
- **Offline not working:** Check DevTools → Application → Service Workers
- **Stale cache:** Use `public/clear-cache.html` or clear site data

## Related

- `docs/COLD_START_OFFLINE.md` — full offline architecture
- `docs/SERVER_INFRASTRUCTURE.md` — staging vs production URLs
