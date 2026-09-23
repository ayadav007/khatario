import { extractStoreSubdomain } from '@/lib/store/subdomain';

/**
 * Routes where a stale cached session must not hydrate the app shell or call
 * authenticated APIs (marketing, signup, legal, public store, etc.).
 */
export function isPublicMarketingSurface(
  pathname: string,
  host?: string | null,
): boolean {
  const resolvedHost =
    host ?? (typeof window !== 'undefined' ? window.location.host : null);
  if (extractStoreSubdomain(resolvedHost)) return true;

  const p = pathname || '';
  if (p === '/') return true;
  if (p === '/store' || p.startsWith('/store/')) return true;
  if (p.startsWith('/signup')) return true;
  if (p.startsWith('/book-demo')) return true;
  if (p.startsWith('/terms')) return true;
  if (p.startsWith('/privacy')) return true;
  if (p.startsWith('/guides')) return true;
  if (p.startsWith('/login')) return true;
  if (p.startsWith('/admin/login')) return true;
  if (p.startsWith('/attendance/login')) return true;
  if (p.startsWith('/attendance/kiosk')) return true;
  if (p === '/offline') return true;
  return false;
}

/** @deprecated alias used during auth redirect refactors */
export const isStayOnPublicSurface = isPublicMarketingSurface;
