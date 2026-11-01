'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isCapacitorNative } from '@/lib/capacitor/platform';

/**
 * Business-user push inside the Capacitor shell. Mounted once in the signed-in app shell: when
 * the session (user + business) is known and the page runs natively, it registers the device and
 * routes notification taps. Renders nothing. Browsers skip it entirely.
 */
export function PushRegistration() {
  const { user, business, loading } = useAuth();
  const router = useRouter();
  const userId = user?.id;
  const businessId = business?.id;

  useEffect(() => {
    if (loading || !userId || !businessId || !isCapacitorNative()) return;
    let cancelled = false;
    let cleanup: (() => Promise<void>) | null = null;

    void import('@/lib/push/client/capacitor-push').then(async ({ startCapacitorPush }) => {
      if (cancelled) return;
      cleanup = await startCapacitorPush({
        target: { kind: 'business' },
        currentBusinessId: businessId,
        onTap: (plan) => {
          if (plan.switchBusinessId) {
            // The notification is for another business the user belongs to: switch, then open it
            // with a full load so every context picks up the new business.
            void fetch('/api/businesses/switch', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ business_id: plan.switchBusinessId }),
            })
              .catch(() => undefined)
              .finally(() => window.location.assign(plan.href));
            return;
          }
          router.push(plan.href);
        },
      });
      if (cancelled) void cleanup();
    });

    return () => {
      cancelled = true;
      if (cleanup) void cleanup();
    };
  }, [loading, userId, businessId, router]);

  return null;
}
