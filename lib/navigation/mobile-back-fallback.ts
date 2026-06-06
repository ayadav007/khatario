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

export function getMobileBackFallback(pathname: string | null): string | null {
  if (!pathname) return '/dashboard';
  const p = pathname.replace(/\/$/, '') || '/';
  if (BOTTOM_NAV_ROOTS.has(p)) return null;
  if (MOBILE_BACK_FALLBACKS[p]) return MOBILE_BACK_FALLBACKS[p];
  if (p.startsWith('/invoices/')) return '/invoices';
  if (p.startsWith('/items/')) return '/items';
  if (p.startsWith('/customers/')) return '/customers';
  if (p.startsWith('/purchases')) return '/purchases';
  if (p.startsWith('/settings')) return '/more';
  return '/dashboard';
}

export function isMobileBackRoot(pathname: string | null): boolean {
  if (!pathname) return false;
  const p = pathname.replace(/\/$/, '') || '/';
  return BOTTOM_NAV_ROOTS.has(p);
}
