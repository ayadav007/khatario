import { isPublicBusinessEmployeePath } from '@/lib/employee-portal/reserved-slugs';
import { TRUST_PAGE_PATHS } from '@/lib/marketing/static-paths';
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
  if (p === '/about') return true;
  // Trust pages: exact match, one trailing slash allowed.
  if (TRUST_PAGE_PATHS.includes(p.length > 1 && p.endsWith('/') ? p.slice(0, -1) : p)) return true;
  if (p.startsWith('/terms')) return true;
  if (p.startsWith('/privacy')) return true;
  if (p.startsWith('/guides')) return true;
  if (p === '/themes' || p.startsWith('/themes/')) return true;
  if (p === '/free-tools' || p === '/free-tools/' || p.startsWith('/free-tools/')) return true;
  if (p === '/blog' || p.startsWith('/blog/')) return true;
  if (p.startsWith('/solution/')) return true;
  /** Design-only previews under app/preview (noindex). */
  if (p.startsWith('/preview/')) return true;
  if (p.startsWith('/login')) return true;
  // Entire platform-admin tree: business AuthContext must not 401 → /login.
  if (p.startsWith('/admin')) return true;
  // Partner portal: separate session from business app.
  if (p.startsWith('/partners')) return true;
  if (p.startsWith('/attendance/login')) return true;
  if (p.startsWith('/attendance/kiosk')) return true;
  // Employee portal sign-in lives at /{business}/employees and has its own session.
  if (isPublicBusinessEmployeePath(p)) return true;
  if (p === '/offline') return true;
  return false;
}

/** @deprecated alias used during auth redirect refactors */
export const isStayOnPublicSurface = isPublicMarketingSurface;
