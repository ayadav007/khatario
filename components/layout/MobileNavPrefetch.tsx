'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';

/**
 * Routes to prefetch so offline client navigation can render cached RSC payloads.
 * Without prefetch, Next.js may update the URL/title but keep the previous page (often Home).
 */
const OFFLINE_PREFETCH_ROUTES = [
  '/dashboard',
  '/invoices',
  '/items',
  '/customers',
  '/more',
  '/invoices/new',
  '/purchases/new',
  '/purchases',
  '/estimates',
  '/sales-orders',
  '/delivery-challans',
  '/credit-notes',
  '/debit-notes',
  '/suppliers',
  '/purchase-orders',
  '/expenses',
  '/payments',
  '/reports',
  '/settings/offline-sync',
  '/settings',
] as const;

function prefetchRoutes(router: ReturnType<typeof useRouter>) {
  for (const href of OFFLINE_PREFETCH_ROUTES) {
    try {
      router.prefetch(href);
    } catch {
      /* ignore */
    }
  }
}

export function MobileNavPrefetch() {
  const router = useRouter();
  const { isOnline } = useNetworkStatus();

  useEffect(() => {
    prefetchRoutes(router);
  }, [router]);

  useEffect(() => {
    if (!isOnline) return;
    prefetchRoutes(router);
  }, [isOnline, router]);

  return null;
}
