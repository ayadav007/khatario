'use client';

import React from 'react';
import { useLazyMountWhenVisible } from '@/hooks/useLazyMountWhenVisible';
import { isDashboardChartsDisabled } from '@/lib/debug/runtime-isolation';
import { CashFlowChart } from '@/components/dashboard/CashFlowChart';
import { SalesVsPurchasesChart } from '@/components/dashboard/SalesVsPurchasesChart';

type DashboardChartsSectionProps = {
  businessId: string;
  chartDateRange: { start: string; end: string };
};

export function DashboardChartsSection({
  businessId,
  chartDateRange,
}: DashboardChartsSectionProps) {
  const { ref, mounted } = useLazyMountWhenVisible('200px');

  if (isDashboardChartsDisabled()) {
    return null;
  }

  return (
    <div ref={ref} className="grid grid-cols-1 gap-stack-section md:gap-stack-page lg:grid-cols-2">
      {mounted ? (
        <>
          <CashFlowChart businessId={businessId} />
          <SalesVsPurchasesChart businessId={businessId} dateRange={chartDateRange} />
        </>
      ) : (
        <>
          <div className="h-36 rounded-lg border border-border bg-surface md:h-48" aria-hidden />
          <div className="h-36 rounded-lg border border-border bg-surface md:h-48" aria-hidden />
        </>
      )}
    </div>
  );
}
