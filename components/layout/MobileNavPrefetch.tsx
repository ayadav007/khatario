'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

/** Prefetch bottom-nav routes so offline navigation can use the client router cache. */
const MOBILE_NAV_ROUTES = [
  '/dashboard',
  '/invoices',
  '/items',
  '/customers',
  '/more',
  '/invoices/new',
  '/purchases/new',
  '/settings/offline-sync',
];

export function MobileNavPrefetch() {
  const router = useRouter();
  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    if (!isOnline) return;
    for (const href of MOBILE_NAV_ROUTES) {
      try {
        router.prefetch(href);
      } catch {
        /* ignore */
      }
    }
  }, [isOnline, router]);

  return null;
}
