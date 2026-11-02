'use client';

import React from 'react';
import Link from 'next/link';
import { AlertTriangle, ChevronRight } from 'lucide-react';

type NeedsAttentionStripProps = {
  receivablesOverdue: number;
  payablesOverdue: number;
  lowStockCount: number;
  pendingCount: number;
  onOpenPending: () => void;
};

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

const tileClass =
  'flex min-w-0 flex-col gap-1 rounded-xl bg-surface p-3 transition-shadow hover:shadow-medium md:gap-1.5 md:p-4';

function TileAction({ children }: { children: React.ReactNode }) {
  return (
    <span className="mt-auto inline-flex items-center gap-0.5 text-caption font-bold text-orange-700 dark:text-orange-300 md:text-xs">
      {children}
      <ChevronRight className="h-3.5 w-3.5" aria-hidden />
    </span>
  );
}

/**
 * Overdue money, low stock and pending work at the top of the dashboard. Warning colours stay
 * fixed (orange) whatever the business brand colour, so "overdue" never reads as good news.
 */
export function NeedsAttentionStrip({
  receivablesOverdue,
  payablesOverdue,
  lowStockCount,
  pendingCount,
  onOpenPending,
}: NeedsAttentionStripProps) {
  return (
    <section
      aria-labelledby="needs-attention-heading"
      className="rounded-2xl bg-orange-50 p-3 dark:bg-orange-950/30 md:p-4"
    >
      <h2
        id="needs-attention-heading"
        className="mb-3 flex items-center gap-2 text-sm font-bold text-text-primary md:text-base"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-orange-500 text-orange-950">
          <AlertTriangle className="h-4 w-4" aria-hidden />
        </span>
        Needs your attention
      </h2>
      <div className="grid grid-cols-2 gap-2 md:gap-3 lg:grid-cols-4">
        <Link href="/invoices?status=overdue" className={tileClass}>
          <span className="text-caption font-semibold text-text-secondary md:text-xs">Receivables overdue</span>
          <span className="truncate text-lg font-extrabold tabular-nums text-text-primary md:text-xl">
            {inr(receivablesOverdue)}
          </span>
          <TileAction>{receivablesOverdue > 0 ? 'View overdue' : 'Nothing overdue'}</TileAction>
        </Link>
        <Link href="/purchases?status=unpaid&aging_days_min=1&aging_days_max=9999" className={tileClass}>
          <span className="text-caption font-semibold text-text-secondary md:text-xs">Payables overdue</span>
          <span className="truncate text-lg font-extrabold tabular-nums text-text-primary md:text-xl">
            {inr(payablesOverdue)}
          </span>
          <TileAction>{payablesOverdue > 0 ? 'See bills' : 'Nothing overdue'}</TileAction>
        </Link>
        <Link href="/items?stock=low" className={tileClass}>
          <span className="text-caption font-semibold text-text-secondary md:text-xs">Low stock items</span>
          <span className="truncate text-lg font-extrabold tabular-nums text-text-primary md:text-xl">
            {lowStockCount} {lowStockCount === 1 ? 'item' : 'items'}
          </span>
          <TileAction>{lowStockCount > 0 ? 'Restock' : 'All stocked'}</TileAction>
        </Link>
        <button
          type="button"
          onClick={onOpenPending}
          className="flex min-w-0 flex-col gap-1 rounded-xl bg-primary-600 p-3 text-left text-on-primary transition-shadow hover:shadow-medium md:gap-1.5 md:p-4"
        >
          <span className="text-caption font-semibold opacity-75 md:text-xs">Pending actions</span>
          <span className="text-lg font-extrabold tabular-nums md:text-xl">{pendingCount}</span>
          <span className="mt-auto inline-flex items-center gap-0.5 text-caption font-bold md:text-xs">
            Review
            <ChevronRight className="h-3.5 w-3.5" aria-hidden />
          </span>
        </button>
      </div>
    </section>
  );
}
