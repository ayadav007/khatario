'use client';

import React from 'react';
import type { LucideIcon } from 'lucide-react';
import { Info } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export type DashboardKpiClickType = 'sales' | 'purchases' | 'collection' | 'profit';

export type DashboardKpiItem = {
  id: string;
  title: string;
  value: string;
  icon: LucideIcon;
  iconColor: string;
  valueColor: string;
  iconWellClassName: string;
  clickType?: DashboardKpiClickType;
  tooltipTitle: string;
  tooltipBody: string;
};

type DashboardFinancialSnapshotProps = {
  items: DashboardKpiItem[];
  onItemClick?: (type: DashboardKpiClickType) => void;
};

export function DashboardFinancialSnapshot({
  items,
  onItemClick,
}: DashboardFinancialSnapshotProps) {
  return (
    <div className="grid grid-cols-2 gap-2 md:gap-3">
      {items.map((kpi) => {
        const Icon = kpi.icon;
        const clickable = kpi.clickType && onItemClick;

        return (
          <Card
            key={kpi.id}
            padding="sm"
            hover={!!clickable}
            className={`min-h-[72px] md:min-h-[80px] ${clickable ? 'cursor-pointer active:scale-[0.98]' : ''}`}
            onClick={clickable ? () => onItemClick!(kpi.clickType!) : undefined}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-center gap-1">
                  <p className="truncate text-[11px] font-medium leading-tight text-text-secondary md:text-xs">
                    {kpi.title}
                  </p>
                  <div className="relative group shrink-0">
                    <Info
                      className="h-3 w-3 text-text-muted"
                      onClick={(e) => e.stopPropagation()}
                    />
                    <div className="pointer-events-none invisible absolute bottom-full left-0 z-20 mb-2 w-56 rounded-lg bg-gray-900 p-2.5 text-[11px] text-white opacity-0 shadow-lg transition-all group-hover:visible group-hover:opacity-100">
                      <p className="mb-1 font-semibold">{kpi.tooltipTitle}</p>
                      <p className="leading-relaxed text-gray-200">{kpi.tooltipBody}</p>
                    </div>
                  </div>
                </div>
                <p
                  className={`truncate text-base font-bold leading-tight md:text-lg ${kpi.valueColor}`}
                >
                  {kpi.value}
                </p>
              </div>
              <div
                className={`shrink-0 rounded-md p-1.5 md:p-2 ${kpi.iconWellClassName} ${kpi.iconColor}`}
              >
                <Icon className="h-4 w-4 md:h-[18px] md:w-[18px]" aria-hidden />
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
