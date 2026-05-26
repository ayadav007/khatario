/**
 * Khatario app-shell service worker.
 * Caches static assets + key navigation routes for offline/PWA use.
 * API routes stay network-only.
 */

const CACHE_VERSION = 'khatario-shell-v2';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGE_CACHE = `${CACHE_VERSION}-pages`;
const SHELL_CACHE = `${CACHE_VERSION}-shell`;

/** Precache public routes only — /dashboard needs auth and is cached on visit. */
const SHELL_URLS = ['/login', '/offline', '/manifest.json'];

/** Cold-start offline bootstrap entry (Capacitor errorPath redirect). */
const OFFLINE_BOOTSTRAP_PATH = '/dashboard';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) =>
                key.startsWith('khatario-shell-') && !key.startsWith(CACHE_VERSION)
            )
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isNavigationRequest(request) {
  return (
    request.mode === 'navigate' ||
    (request.method === 'GET' &&
      request.headers.get('accept')?.includes('text/html'))
  );
}

async function matchCachedPageByPathname(pathname) {
  const cacheNames = [PAGE_CACHE, SHELL_CACHE];
  for (const name of cacheNames) {
    const cache = await caches.open(name);
    const keys = await cache.keys();
    for (const req of keys) {
      try {
        if (new URL(req.url).pathname === pathname) {
          const hit = await cache.match(req);
          if (hit) return hit;
        }
      } catch {
        /* ignore malformed cache keys */
      }
    }
  }
  return undefined;
}

async function offlineNavigationFallback(request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  const exact = await caches.match(request);
  if (exact) return exact;

  const byPath = await matchCachedPageByPathname(pathname);
  if (byPath) return byPath;

  if (pathname !== OFFLINE_BOOTSTRAP_PATH) {
    const dashboard = await matchCachedPageByPathname(OFFLINE_BOOTSTRAP_PATH);
    if (dashboard) return dashboard;
  }

  const login = await matchCachedPageByPathname('/login');
  if (login) return login;

  const offline = await caches.match('/offline');
  if (offline) return offline;

  return new Response('Offline', {
    status: 503,
    headers: { 'Content-Type': 'text/plain' },
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Never cache API responses — server remains source of truth.
  if (url.pathname.startsWith('/api/')) return;

  // Next.js static chunks — cache-first.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // Fonts, icons, manifest.
  if (
    url.pathname.startsWith('/icons/') ||
    url.pathname.endsWith('.woff2') ||
    url.pathname === '/manifest.json'
  ) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy));
            }
            return response;
          })
      )
    );
    return;
  }

  // HTML navigation — network-first with offline fallback.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(PAGE_CACHE).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => offlineNavigationFallback(request))
    );
  }
});
