'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { isInsidePhoneApp } from '@/lib/capacitor/platform';
import { webGateView } from '@/lib/upgrade/web-gate';
import { UpgradeDialog } from '@/components/subscription/upgrade/UpgradeDialog';
import { PlanCheckFailedScreen } from '@/components/layout/AppGateScreens';

const WEB_REQUEST = { variant: 'web' as const };

/**
 * The Free Billing plan works only in the Khatario phone app (no `web_access` feature).
 * On the website such a business sees the phone-only upgrade wall instead of the app, except on
 * the plan pages. Pages opened inside the phone app are never blocked.
 *
 * Fails closed (SUB-19): if the plan check errors, the gate shows a retry, not the app. The one exception is
 * a network error while the browser reports it is offline: the installed web app keeps working offline, and
 * the server layout (app/(app)/layout.tsx) checks the plan on every page load anyway.
 */
export function WebAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { business, logout } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [inPhoneApp, setInPhoneApp] = useState(false);

  useEffect(() => setInPhoneApp(isInsidePhoneApp()), []);

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    fetch(`/api/subscriptions/web-access?business_id=${encodeURIComponent(business.id)}`, { credentials: 'include' })
      .then(async (res) => {
        if (!res.ok) throw new Error(`web-access ${res.status}`);
        return (await res.json()) as { allowed?: boolean };
      })
      .then((data) => {
        if (cancelled) return;
        setFailed(false);
        setAllowed(data.allowed !== false);
      })
      .catch(() => {
        if (cancelled) return;
        if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // offline: no answer, keep the app
        setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [business?.id, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((n) => n + 1);
  }, []);

  const view = webGateView({ allowed, failed, inPhoneApp, pathname });
  if (view === 'app') return <>{children}</>;
  if (view === 'retry') return <PlanCheckFailedScreen onRetry={retry} />;

  return (
    <>
      <div className="min-h-[60vh]" aria-hidden />
      <UpgradeDialog request={WEB_REQUEST} onClose={() => undefined} onSignOut={logout} />
    </>
  );
}
