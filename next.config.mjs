import withPWAInit from '@ducanh2912/next-pwa';

/** Bust PWA runtime + precache on every production build (fixes stale dashboard after deploy). */
const APP_BUILD_ID =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.GITHUB_SHA ||
  process.env.APP_BUILD_ID ||
  `local-${Date.now()}`;

const withPWA = withPWAInit({
  dest: 'public',
  // Disable in development (avoids cache confusion during hot reload)
  disable: process.env.NODE_ENV === 'development',
  // We register the SW ourselves via ServiceWorkerRegistration.tsx
  register: false,
  // Fallback page when navigation fails offline and page hasn't been cached yet
  fallbacks: {
    document: '/offline',
  },
  workboxOptions: {
    // New build → new cache namespace; old pages-cache / next-static entries are dropped.
    cacheId: `khatario-${APP_BUILD_ID.slice(0, 12)}`,
    // Take over immediately — new SW activates without waiting for old tabs to close
    skipWaiting: true,
    clientsClaim: true,
    // Pre-warm the dashboard into the SW cache during install so it is
    // available on cold-start offline even before the user has navigated there.
    additionalManifestEntries: [
      { url: '/dashboard', revision: APP_BUILD_ID },
      { url: '/login', revision: APP_BUILD_ID },
      { url: '/items', revision: APP_BUILD_ID },
      { url: '/customers', revision: APP_BUILD_ID },
      { url: '/invoices', revision: APP_BUILD_ID },
      { url: '/more', revision: APP_BUILD_ID },
    ],
    runtimeCaching: [
      // ── Static Next.js assets — immutable (hash-versioned), cache forever ─
      {
        urlPattern: /^\/_next\/static\/.+/i,
        handler: 'CacheFirst',
        options: {
          cacheName: 'next-static',
          expiration: { maxEntries: 500, maxAgeSeconds: 365 * 24 * 60 * 60 },
        },
      },
      // ── Next.js image optimisation ────────────────────────────────────────
      {
        urlPattern: /^\/_next\/image\?.+/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'next-images',
          expiration: { maxEntries: 100, maxAgeSeconds: 7 * 24 * 60 * 60 },
        },
      },
      // ── API calls — NEVER cache ───────────────────────────────────────────
      // All business data must come from the server; stale API responses would
      // show wrong totals, deleted records, etc.
      {
        urlPattern: /\/api\//i,
        handler: 'NetworkOnly',
      },
      // ── App pages — network first, fall back to last cached HTML ──────────
      // This enables cold-start offline:
      //   1. SW serves the last-cached HTML for the route
      //   2. React hydrates client-side
      //   3. AuthContext reads from localStorage (shouldTrustCachedSession = true)
      //   4. Dashboard reads IDB entity cache → shows last synced data
      //   5. Other pages render with empty state + offline banner
      {
        urlPattern: ({ request }) => request.mode === 'navigate',
        handler: 'NetworkFirst',
        options: {
          cacheName: 'pages-cache',
          // Prefer fresh HTML after deploy; fall back to cache only when offline/slow.
          networkTimeoutSeconds: 5,
          expiration: { maxEntries: 32, maxAgeSeconds: 24 * 60 * 60 },
        },
      },
      // ── Public static assets (fonts, icons, images) ───────────────────────
      {
        urlPattern: /\.(?:png|jpg|jpeg|svg|gif|ico|webp|woff|woff2|ttf|eot)$/i,
        handler: 'StaleWhileRevalidate',
        options: {
          cacheName: 'static-assets',
          expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 },
        },
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  env: {
    NEXT_PUBLIC_APP_BUILD_ID: APP_BUILD_ID,
  },
  reactStrictMode: true,
  serverExternalPackages: ["pdf-parse", "tesseract.js", "@techstark/opencv-js", "sharp"],
  images: {
    domains: [],
  },
  swcMinify: true,
  compiler: {
    removeConsole: process.env.NODE_ENV === "production",
  },
  webpack: (config, { isServer }) => {
    config.optimization = {
      ...config.optimization,
      moduleIds: "deterministic",
      runtimeChunk: "single",
    };

    if (isServer) {
      config.externals = [...(config.externals || []), "baileys-pro"];
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
        crypto: false,
        stream: false,
        url: false,
        zlib: false,
        http: false,
        https: false,
        assert: false,
        os: false,
        path: false,
      };
    }
    return config;
  },
};

export default withPWA(nextConfig);
