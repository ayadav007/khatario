'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionUsage } from '@/hooks/useSubscriptionUsage';
import { SubscriptionUsageBanner } from '@/components/subscription/SubscriptionUsageBanner';

/** Pages that already show a dedicated usage banner — avoid duplicate nudges. */
const SKIP_PATH_PREFIXES = [
  '/dashboard',
  '/items',
  '/customers',
  '/invoices',
  '/settings',
];

export function GlobalSubscriptionUsageStrip() {
  const pathname = usePathname();
  const { business } = useAuth();
  const { nudgeRows, loading } = useSubscriptionUsage(business?.id);

  const worst = useMemo(() => {
    if (nudgeRows.length === 0) return null;
    return nudgeRows.reduce((acc, row) => (row.percent > acc.percent ? row : acc));
  }, [nudgeRows]);

  const skipPath =
    pathname != null &&
    SKIP_PATH_PREFIXES.some((prefix) =>
      prefix === '/settings' ? pathname === '/settings' || pathname.startsWith('/settings/') : pathname === prefix
    );

  if (loading || !worst || !pathname || skipPath) {
    return null;
  }

  return (
    <SubscriptionUsageBanner
      businessId={business?.id}
      variant="inline"
      highlightLimit={worst.limitType}
    />
  );
}
