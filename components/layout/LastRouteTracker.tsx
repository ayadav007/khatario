'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

export const LAST_APP_ROUTE_KEY = 'khatario_last_app_route';

/** Persists the last in-app route for SW offline fallback navigation. */
export function LastRouteTracker() {
  const pathname = usePathname();

  useEffect(() => {
    if (!pathname || pathname === '/offline') return;
    try {
      sessionStorage.setItem(LAST_APP_ROUTE_KEY, pathname);
    } catch {
      /* ignore quota */
    }
  }, [pathname]);

  return null;
}
