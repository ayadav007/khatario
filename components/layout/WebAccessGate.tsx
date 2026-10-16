'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Smartphone } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

/** Pages a phone-only (Free) business can still open in the browser: choosing and paying for a plan. */
const ALLOWED_PREFIXES = ['/settings/subscription', '/settings/products', '/upgrade', '/profile'];

function isAllowed(pathname: string | null): boolean {
  if (!pathname) return false;
  return ALLOWED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * The Free Billing plan works only in the Khatario phone app (no `web_access` feature).
 * On the website such a business sees this screen instead of the app, except on the plan pages.
 */
export function WebAccessGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { business } = useAuth();
  const [allowed, setAllowed] = useState<boolean | null>(null);

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

  if (allowed !== false || isAllowed(pathname)) return <>{children}</>;

  return (
    <div className="mx-auto flex max-w-lg flex-col items-center px-4 py-16 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-50 text-primary-600">
        <Smartphone className="h-7 w-7" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-bold text-text-primary">The Free plan works in the Khatario phone app</h1>
      <p className="mt-3 text-text-secondary">
        Open the Khatario app on your phone to keep billing for free. To use Khatario on this computer as well, choose a
        paid plan.
      </p>
      <Link
        href="/settings/subscription"
        className="mt-6 inline-flex items-center justify-center rounded-xl bg-primary-600 px-6 py-3 font-semibold text-white hover:bg-primary-700"
      >
        See plans
      </Link>
    </div>
  );
}
