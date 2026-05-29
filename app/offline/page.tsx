'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { dispatchOfflineBlockedFlash } from '@/contexts/OfflineBannerContext';
import { isOfflineCapable } from '@/lib/offline/offline-capable-routes';
import { LAST_APP_ROUTE_KEY } from '@/components/layout/LastRouteTracker';

/**
 * Service worker fallback when a navigation request fails offline.
 * Returns to the last in-app route instead of always forcing dashboard.
 */
export default function OfflinePage() {
  const router = useRouter();

  useEffect(() => {
    let target = '/dashboard';
    try {
      target = sessionStorage.getItem(LAST_APP_ROUTE_KEY) || '/dashboard';
    } catch {
      /* ignore */
    }

    if (!isOfflineCapable(target)) {
      dispatchOfflineBlockedFlash();
      router.replace('/dashboard');
      return;
    }

    router.replace(target);
  }, [router]);

  return null;
}
