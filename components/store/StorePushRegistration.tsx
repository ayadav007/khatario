'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useStore } from '@/lib/store/store-context';
import { isCapacitorNative } from '@/lib/capacitor/platform';

/**
 * Store-customer push inside the Capacitor shell. When a customer is signed in to this shop's
 * store and the page runs natively, the device is registered for the `customer` audience of this
 * shop only, and taps open the account or khata page. Renders nothing.
 */
export function StorePushRegistration({ subdomain }: { subdomain: string }) {
  const { customer } = useStore();
  const router = useRouter();
  const customerId = customer?.id;

  useEffect(() => {
    if (!customerId || !subdomain || !isCapacitorNative()) return;
    let cancelled = false;
    let cleanup: (() => Promise<void>) | null = null;
    void import('@/lib/push/client/capacitor-push').then(async ({ startCapacitorPush }) => {
      if (cancelled) return;
      cleanup = await startCapacitorPush({
        target: { kind: 'customer', subdomain },
        onTap: (plan) => router.push(plan.href),
      });
      if (cancelled) void cleanup();
    });
    return () => {
      cancelled = true;
      if (cleanup) void cleanup();
    };
  }, [customerId, subdomain, router]);

  return null;
}
