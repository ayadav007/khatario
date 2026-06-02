'use client';

import React from 'react';
import { useLazyMountWhenVisible } from '@/hooks/useLazyMountWhenVisible';
import { isDashboardInsightsDisabled } from '@/lib/debug/runtime-isolation';
import { SalesInsightsCard } from '@/components/dashboard/SalesInsightsCard';

type DashboardSalesInsightsSectionProps = {
  businessId: string;
  dateRange: { start: string; end: string; label: string };
};

export function DashboardSalesInsightsSection({
  businessId,
  dateRange,
}: DashboardSalesInsightsSectionProps) {
  const { ref, mounted } = useLazyMountWhenVisible('80px');

  if (isDashboardInsightsDisabled()) {
    return null;
  }

  return (
    <div ref={ref}>
      {mounted ? (
        <SalesInsightsCard businessId={businessId} dateRange={dateRange} />
      ) : (
        <div className="h-40 rounded-lg border border-border bg-surface md:h-48" aria-hidden />
      )}
    </div>
  );
}
