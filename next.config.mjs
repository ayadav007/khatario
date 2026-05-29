import withPWAInit from '@ducanh2912/next-pwa';

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
    // Take over immediately — new SW activates without waiting for old tabs to close
    skipWaiting: true,
    clientsClaim: true,
    // Pre-warm the dashboard into the SW cache during install so it is
    // available on cold-start offline even before the user has navigated there.
    // revision: null → SW treats it as opaque (always re-fetches on install).
    additionalManifestEntries: [
      { url: '/dashboard', revision: null },
      { url: '/login', revision: null },
      { url: '/items', revision: null },
      { url: '/customers', revision: null },
      { url: '/invoices', revision: null },
      { url: '/more', revision: null },
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
          networkTimeoutSeconds: 8,
          expiration: { maxEntries: 50, maxAgeSeconds: 7 * 24 * 60 * 60 },
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
