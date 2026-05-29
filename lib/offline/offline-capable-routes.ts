/** Routes that work offline with local cache (read-only or queued writes). */

const OFFLINE_CAPABLE_EXACT = new Set([
  '/dashboard',
  '/items',
  '/customers',
  '/invoices',
  '/invoices/new',
  '/purchases/new',
  '/more',
]);

const OFFLINE_CAPABLE_PREFIXES = [
  '/items/',
  '/customers/',
  '/invoices/new',
] as const;

function normalizePath(pathname: string | null | undefined): string {
  if (!pathname) return '/';
  const base = pathname.split('?')[0]?.split('#')[0] ?? '/';
  return base.replace(/\/$/, '') || '/';
}

/** True when the route has local cache or offline create support. */
export function isOfflineCapable(pathname: string | null | undefined): boolean {
  const p = normalizePath(pathname);
  if (OFFLINE_CAPABLE_EXACT.has(p)) return true;
  for (const prefix of OFFLINE_CAPABLE_PREFIXES) {
    if (p.startsWith(prefix)) return true;
  }
  return false;
}

export function isOfflineBlockedHref(href: string): boolean {
  try {
    const url = href.startsWith('http')
      ? new URL(href)
      : new URL(href, 'https://local.invalid');
    return !isOfflineCapable(url.pathname);
  } catch {
    return !isOfflineCapable(href);
  }
}
