# PWA (Progressive Web App) Setup

Khatario is configured as a Progressive Web App, allowing users to install it on their devices and use it offline (with limitations).

## What's Included

- **Service Worker** (`app/sw.ts`) – Caches assets and pages for offline use
- **Web App Manifest** (`app/manifest.json`) – Defines app name, icons, theme colors, display mode
- **Offline Fallback** (`app/offline/page.tsx`) – Shown when the user is offline and requests a page not in cache
- **PWA Icons** (`public/icons/`) – 192x192 and 512x512 PNG icons for install prompts

## How to Use

### Install the App

1. Open Khatario in Chrome, Edge, or Safari on your device
2. On **desktop**: Look for the install icon (⊕) in the address bar
3. On **mobile**: Use "Add to Home Screen" from the browser menu
4. The app will open in standalone mode (no browser UI)

### Regenerate Icons

If you want to customize the app icon:

```bash
npm run pwa:icons
```

This generates new icons from the script. To use your own logo, edit `scripts/generate-pwa-icons.js` to use your image path instead of the SVG.

### Build

The service worker is generated during `npm run build`. Output files:

- `public/sw.js` – Service worker
- `public/sw.js.map` – Source map
- Precache manifest (injected into sw.js)

## Features

| Feature | Status |
|---------|--------|
| Install to home screen | ✅ |
| Standalone display mode | ✅ |
| Offline fallback page | ✅ |
| Asset caching (JS, CSS, images) | ✅ |
| Runtime caching for API calls | ✅ (Network-first) |
| Theme color / splash screen | ✅ |

## Requirements

- **HTTPS** – PWAs require a secure context (localhost works for development)
- **Modern browser** – Chrome, Edge, Safari, Firefox (with varying support)

## Customization

- **Manifest**: Edit `app/manifest.json` for name, colors, icons
- **Theme color**: Update `themeColor` in manifest and `viewport.themeColor` in `app/layout.tsx`
- **Offline page**: Customize `app/offline/page.tsx`

## Troubleshooting

- **Install prompt not showing**: Ensure you're on HTTPS and have visited the site at least twice
- **Offline not working**: The service worker registers on first visit; refresh to activate
- **Old cache**: Clear site data or use DevTools → Application → Service Workers → Unregister
