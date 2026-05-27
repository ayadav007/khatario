'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Service worker fallback route (configured in next.config.mjs → fallbacks.document).
 * When a navigation request fails offline and the page wasn't in SW cache, the SW
 * sends the user here. We silently redirect to /dashboard which IS SW-precached.
 */
export default function OfflinePage() {
  const router = useRouter();
  useEffect(() => {
    router.replace('/dashboard');
  }, [router]);
  return null;
}
