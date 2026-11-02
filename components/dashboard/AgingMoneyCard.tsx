'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { ChevronDown, Info, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';

export interface AgingBreakdown {
  current: number;
  days_1_15: number;
  days_16_30: number;
  days_31_45: number;
  days_45_plus: number;
  total: number;
}

type AgingMoneyCardProps = {
  title: string;
  total: number;
  aging: AgingBreakdown;
  /** "New" button target. */
  newHref: string;
  /** List page the current and overdue rows filter, e.g. `/invoices`. */
  listHref: string;
  tooltipLines: React.ReactNode[];
};

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Receivables or payables: unpaid total, a current/overdue split bar and the overdue ageing.
 * Current (green) and overdue (orange) are fixed status colours, not the business brand colours.
 */
export function AgingMoneyCard({ title, total, aging, newHref, listHref, tooltipLines }: AgingMoneyCardProps) {
  const [showAging, setShowAging] = useState(false);
  const overdue = aging.days_1_15 + aging.days_16_30 + aging.days_31_45 + aging.days_45_plus;
  const split = aging.current + overdue;
  const currentPct = split > 0 ? (aging.current / split) * 100 : 0;
  const overduePct = split > 0 ? 100 - currentPct : 0;

  return (
    <Card padding="none" className="flex flex-col gap-3 border border-border p-3 md:gap-3.5 md:p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <h3 className="truncate text-sm font-bold text-text-primary md:text-base">{title}</h3>
          <div className="relative group shrink-0">
            <Info className="h-3.5 w-3.5 cursor-help text-text-muted md:h-4 md:w-4" />
            <div className="invisible absolute bottom-full left-0 z-10 mb-2 w-64 rounded-lg bg-gray-900 p-3 text-xs text-white opacity-0 shadow-lg transition-all duration-200 group-hover:visible group-hover:opacity-100">
              <p className="mb-2 font-semibold">{title}:</p>
              <ul className="list-inside list-disc space-y-1">
                {tooltipLines.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
              <div className="absolute left-4 top-full h-0 w-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
            </div>
          </div>
        </div>
        <Link
          href={newHref}
          className="btn-primary inline-flex h-8 shrink-0 items-center gap-0.5 px-2.5 text-xs md:h-9 md:px-3"
        >
          <Plus className="h-3.5 w-3.5 md:h-4 md:w-4" />
          New
        </Link>
      </div>

      <div>
        <p className="text-2xs font-semibold uppercase tracking-wider text-text-secondary md:text-caption">Unpaid</p>
        <p className="truncate text-xl font-extrabold tabular-nums text-text-primary md:text-2xl">{inr(total)}</p>
      </div>

      <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-700" aria-hidden>
        <div className="bg-emerald-600" style={{ width: `${currentPct}%` }} />
        <div className="bg-orange-500" style={{ width: `${overduePct}%` }} />
      </div>

      <div className="space-y-1">
        <Link
          href={`${listHref}?status=unpaid&aging_days_min=0&aging_days_max=0`}
          className="flex min-h-9 items-center justify-between gap-2 rounded-md px-1 text-xs transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/30 md:text-sm"
        >
          <span className="flex items-center gap-2 text-text-primary">
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-600" aria-hidden />
            Current
          </span>
          <span className="font-bold tabular-nums text-text-primary">{inr(aging.current)}</span>
        </Link>

        <button
          type="button"
          onClick={() => setShowAging(!showAging)}
          aria-expanded={showAging}
          className="flex min-h-9 w-full items-center justify-between gap-2 rounded-md px-1 text-xs font-bold text-orange-700 transition-colors hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950/30 md:text-sm"
        >
          <span className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-orange-500" aria-hidden />
            Overdue
          </span>
          <span className="flex items-center gap-1 tabular-nums">
            {inr(overdue)}
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform duration-200 md:h-4 md:w-4 ${showAging ? 'rotate-180' : ''}`}
            />
          </span>
        </button>

        {showAging ? (
          <div className="ml-2 space-y-0.5 border-l-2 border-orange-200 pl-3 dark:border-orange-900">
            {[
              { label: '1-15 Days', min: 1, max: 15, amount: aging.days_1_15 },
              { label: '16-30 Days', min: 16, max: 30, amount: aging.days_16_30 },
              { label: '31-45 Days', min: 31, max: 45, amount: aging.days_31_45 },
              { label: 'Above 45 days', min: 46, max: 9999, amount: aging.days_45_plus },
            ].map(({ label, min, max, amount }) => (
              <Link
                key={label}
                href={`${listHref}?status=unpaid&aging_days_min=${min}&aging_days_max=${max}`}
                className="flex items-center justify-between rounded px-1 py-1.5 transition-colors hover:bg-orange-50 dark:hover:bg-orange-950/25"
              >
                <span className="text-caption text-text-secondary md:text-xs">{label}</span>
                <span className="text-xs font-medium tabular-nums text-text-primary md:text-sm">{inr(amount)}</span>
              </Link>
            ))}
          </div>
        ) : null}
      </div>
    </Card>
  );
}
