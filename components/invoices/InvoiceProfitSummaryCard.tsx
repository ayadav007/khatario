'use client';

import React from 'react';
import { Card } from '@/components/ui/Card';
import { clsx } from 'clsx';
import { LineChart } from 'lucide-react';

/** Matches GET /api/invoices/[id] `profit_summary` */
export interface InvoiceProfitSummaryDto {
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  margin_percent: number;
}

function formatRupee(n: number) {
  return `₹${Number(n ?? 0).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function isProfitSummary(value: unknown): value is InvoiceProfitSummaryDto {
  if (value === null || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  const keys = ['total_revenue', 'total_cost', 'total_profit', 'margin_percent'] as const;
  return keys.every((k) => typeof v[k] === 'number' && Number.isFinite(v[k] as number));
}

export function parseProfitSummary(value: unknown): InvoiceProfitSummaryDto | null {
  return isProfitSummary(value) ? value : null;
}

interface InvoiceProfitSummaryCardProps {
  summary: InvoiceProfitSummaryDto;
}

/**
 * Displays gross-profit figures from taxable line totals vs resolved purchase cost.
 */
export function InvoiceProfitSummaryCard({ summary }: InvoiceProfitSummaryCardProps) {
  const profitPositive = summary.total_profit >= 0;

  return (
    <Card padding="md" className="border border-border bg-surface">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-text-primary">Profit summary</h3>
          <p className="mt-1 text-xs text-text-muted">
            Revenue and cost estimated from invoice lines (taxable value vs purchase price).
          </p>
        </div>
        <LineChart className="h-4 w-4 shrink-0 text-text-muted" aria-hidden />
      </div>

      <dl className="mt-4 space-y-2.5 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">Revenue</dt>
          <dd className="font-medium text-text-primary tabular-nums">{formatRupee(summary.total_revenue)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-text-secondary">Cost</dt>
          <dd className="font-medium text-text-primary tabular-nums">{formatRupee(summary.total_cost)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4 border-t border-border pt-2">
          <dt className="font-medium text-text-primary">Profit</dt>
          <dd
            className={clsx(
              'font-semibold tabular-nums',
              profitPositive ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
            )}
          >
            {formatRupee(summary.total_profit)}
          </dd>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
          <dt className="text-text-secondary">Margin</dt>
          <dd>
            <span className="inline-flex items-center rounded-md border border-border bg-slate-50 px-2.5 py-1 text-sm font-bold text-text-primary tabular-nums dark:bg-slate-800/70">
              {Number(summary.margin_percent).toLocaleString('en-IN', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              })}
              %
            </span>
          </dd>
        </div>
      </dl>
    </Card>
  );
}
