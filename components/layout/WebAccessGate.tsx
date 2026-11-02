'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isInsidePhoneApp } from '@/lib/capacitor/platform';
import { shouldBlockWeb } from '@/lib/upgrade/web-gate';
import { UpgradeDialog } from '@/components/subscription/upgrade/UpgradeDialog';

const WEB_REQUEST = { variant: 'web' as const };

/**
 * The Free Billing plan works only in the Khatario phone app (no `web_access` feature).
 * On the website such a business sees the phone-only upgrade wall instead of the app, except on
 * the plan pages. Pages opened inside the phone app are never blocked.
 */
export function WebAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { business, logout } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [inPhoneApp, setInPhoneApp] = useState(false);

  useEffect(() => setInPhoneApp(isInsidePhoneApp()), []);

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    fetch(`/api/subscriptions/web-access?business_id=${encodeURIComponent(business.id)}`, { credentials: 'include' })
      .then((res) => (res.ok ? res.json() : { allowed: true }))
      .then((data: { allowed?: boolean }) => {
        if (!cancelled) setAllowed(data.allowed !== false);
      })
      .catch(() => {
        if (!cancelled) setAllowed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [business?.id]);

  if (!shouldBlockWeb({ allowed, inPhoneApp, pathname })) return <>{children}</>;

  return (
    <>
      <div className="min-h-[60vh]" aria-hidden />
      <UpgradeDialog request={WEB_REQUEST} onClose={() => undefined} onSignOut={logout} />
    </>
  );
}
