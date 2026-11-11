'use client';

import React, { memo } from 'react';
import { Info } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { probeDashboardRefresh } from '@/lib/debug/dashboard-refresh-probe';

export type DashboardKpiClickType = 'sales' | 'purchases' | 'collection' | 'profit';

export type DashboardKpiItem = {
  id: string;
  title: string;
  value: string;
  /** Colour of the bar across the top of the card (a `border-t-*` class). */
  topBorderClassName: string;
  valueColor: string;
  clickType?: DashboardKpiClickType;
  tooltipTitle: string;
  tooltipBody: string;
};

type DashboardFinancialSnapshotProps = {
  items: DashboardKpiItem[];
  /** Period the totals cover, e.g. "Today" or "01 Sep – 02 Nov". */
  periodLabel: string;
  /** Shown at the right of the heading, e.g. the date range picker. */
  actions?: React.ReactNode;
  /** Hide the period text on desktop when the picker there already says it (Today, This Week…). */
  hideDesktopPeriodLabel?: boolean;
  onItemClick?: (type: DashboardKpiClickType) => void;
};

/** "How the business did": the four period totals. */
export const DashboardFinancialSnapshot = memo(function DashboardFinancialSnapshot({
  items,
  periodLabel,
  actions,
  hideDesktopPeriodLabel = false,
  onItemClick,
}: DashboardFinancialSnapshotProps) {
  probeDashboardRefresh('kpi-strip-rerender');
  return (
    <section className="space-y-2 md:space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 className="text-base font-bold text-text-primary md:text-lg">How the business did</h2>
        <div className="flex items-center gap-3">
          <p
            className={`text-caption font-medium text-text-secondary md:text-xs ${
              hideDesktopPeriodLabel ? 'lg:hidden' : ''
            }`}
          >
            {periodLabel}
          </p>
          {actions}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4">
        {items.map((kpi) => {
          const clickable = kpi.clickType && onItemClick;

          return (
            <Card
              key={kpi.id}
              padding="none"
              hover={!!clickable}
              className={`border-t-4 px-3 py-3 md:px-5 md:py-4 ${kpi.topBorderClassName} ${
                clickable ? 'cursor-pointer active:scale-[0.98]' : ''
              }`}
              onClick={clickable ? () => onItemClick!(kpi.clickType!) : undefined}
            >
              <div className="flex items-center gap-1">
                <p className="truncate text-2xs font-semibold uppercase tracking-wider text-text-secondary md:text-caption">
                  {kpi.title}
                </p>
                <div className="relative group shrink-0">
                  <Info
                    className="h-3 w-3 text-text-muted"
                    onClick={(e) => e.stopPropagation()}
                  />
                  <div className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg bg-gray-900 p-2.5 text-caption text-white opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
                    <p className="mb-1 font-semibold">{kpi.tooltipTitle}</p>
                    <p className="leading-relaxed text-gray-200">{kpi.tooltipBody}</p>
                  </div>
                </div>
              </div>
              <p
                className={`mt-1.5 truncate text-lg font-extrabold leading-tight tabular-nums md:mt-2 md:text-2xl ${kpi.valueColor}`}
              >
                {kpi.value}
              </p>
            </Card>
          );
        })}
      </div>
    </section>
  );
});
