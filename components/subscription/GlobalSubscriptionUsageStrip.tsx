'use client';

import { useMemo } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { useSubscriptionUsage } from '@/hooks/useSubscriptionUsage';
import { SubscriptionUsageBanner } from '@/components/subscription/SubscriptionUsageBanner';

/** Pages that already show a dedicated usage banner — avoid duplicate nudges. */
const SKIP_PATHS = new Set([
  '/dashboard',
  '/items',
  '/customers',
  '/invoices',
  '/settings/users',
]);

export function GlobalSubscriptionUsageStrip() {
  const pathname = usePathname();
  const { business } = useAuth();
  const { nudgeRows, loading } = useSubscriptionUsage(business?.id);

  const worst = useMemo(() => {
    if (nudgeRows.length === 0) return null;
    return nudgeRows.reduce((acc, row) => (row.percent > acc.percent ? row : acc));
  }, [nudgeRows]);

  if (loading || !worst || !pathname || SKIP_PATHS.has(pathname)) {
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
