/**
 * Fallback route when the WebView has no history to pop (e.g. cold start deep link).
 * `router.back()` is preferred when the stack has a prior in-app page.
 */
const MOBILE_BACK_FALLBACKS: Record<string, string> = {
  '/invoices/new': '/dashboard',
  '/items/new': '/items',
  '/customers/new': '/customers',
  '/suppliers/new': '/suppliers',
  '/purchases/new': '/purchases',
};

const BOTTOM_NAV_ROOTS = new Set([
  '/dashboard',
  '/invoices',
  '/items',
  '/customers',
  '/more',
]);

function normalizePath(pathname: string | null): string {
  if (!pathname) return '/';
  return pathname.replace(/\/$/, '') || '/';
}

/** Only Home — hardware back minimizes the app. */
export function isAppExitRoot(pathname: string | null): boolean {
  return normalizePath(pathname) === '/dashboard';
}

/** Bottom-nav list screens (no history sentinel). Back goes to Home, not exit. */
export function isBottomNavTab(pathname: string | null): boolean {
  return BOTTOM_NAV_ROOTS.has(normalizePath(pathname));
}

/** Non-dashboard bottom tab — back should return to Home. */
export function isNonHomeBottomNavTab(pathname: string | null): boolean {
  const p = normalizePath(pathname);
  return p !== '/dashboard' && BOTTOM_NAV_ROOTS.has(p);
}

export function getMobileBackFallback(pathname: string | null): string | null {
  if (!pathname) return '/dashboard';
  const p = normalizePath(pathname);
  if (BOTTOM_NAV_ROOTS.has(p)) return null;
  if (MOBILE_BACK_FALLBACKS[p]) return MOBILE_BACK_FALLBACKS[p];
  if (p.startsWith('/invoices/')) return '/invoices';
  if (p.startsWith('/items/')) return '/items';
  if (p.startsWith('/customers/')) return '/customers';
  if (p.startsWith('/purchases')) return '/purchases';
  if (p.startsWith('/settings')) return '/more';
  return '/dashboard';
}

/** @deprecated Use isBottomNavTab — kept for call sites that skip sentinel push. */
export function isMobileBackRoot(pathname: string | null): boolean {
  return isBottomNavTab(pathname);
}
