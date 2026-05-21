'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { ChevronDown, Info, Plus } from 'lucide-react';
import Link from 'next/link';

interface AgingBreakdown {
  current: number;
  days_1_15: number;
  days_16_30: number;
  days_31_45: number;
  days_45_plus: number;
  total: number;
}

interface ReceivablesCardProps {
  total: number;
  aging: AgingBreakdown;
}

const rowClass =
  'flex min-h-9 items-center justify-between rounded-md border px-2.5 py-2 md:min-h-10 md:rounded-lg md:px-3 md:py-2.5';

export const ReceivablesCard: React.FC<ReceivablesCardProps> = ({ total, aging }) => {
  const [showAging, setShowAging] = useState(false);
  const overdue = aging.days_1_15 + aging.days_16_30 + aging.days_31_45 + aging.days_45_plus;

  return (
    <Card padding="sm" className="border border-border md:!p-5">
      <div className="mb-2 flex items-start justify-between gap-2 md:mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <h3 className="text-sm font-semibold text-text-primary md:text-base">
              Total Receivables
            </h3>
            <div className="relative group shrink-0">
              <Info className="h-3.5 w-3.5 text-text-muted cursor-help md:h-4 md:w-4" />
              <div className="absolute left-0 bottom-full mb-2 w-64 p-3 bg-gray-900 text-white text-xs rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-10">
                <p className="font-semibold mb-2">Total Receivables:</p>
                <ul className="space-y-1 list-disc list-inside">
                  <li>
                    <strong>Current:</strong> Invoices not yet due (within payment terms)
                  </li>
                  <li>
                    <strong>Overdue:</strong> Invoices past their due date, broken down by days
                    overdue
                  </li>
                  <li>Click on any section to view filtered invoices</li>
                </ul>
                <div className="absolute left-4 top-full w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-900" />
              </div>
            </div>
          </div>
          <p className="mt-0.5 text-[11px] text-text-secondary md:text-xs">
            Unpaid ₹{total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </p>
        </div>
        <Link href="/invoices/new" className="shrink-0">
          <Button variant="primary" size="sm" className="h-8 gap-0.5 px-2.5 text-xs md:h-9 md:px-3">
            <Plus className="h-3.5 w-3.5 md:h-4 md:w-4" />
            New
          </Button>
        </Link>
      </div>

      <div className="space-y-1.5 md:space-y-2">
        <Link
          href="/invoices?status=unpaid&aging_days_min=0&aging_days_max=0"
          className={`${rowClass} cursor-pointer border-emerald-200/90 bg-gradient-to-r from-emerald-50 via-green-50 to-teal-50 transition-all hover:from-emerald-100 hover:via-green-100 hover:to-teal-100 dark:border-emerald-800/55 dark:from-emerald-950/50 dark:via-green-950/40 dark:to-teal-950/35 dark:hover:from-emerald-900/55 dark:hover:via-green-900/45 dark:hover:to-teal-900/40`}
        >
          <span className="text-[11px] font-medium uppercase tracking-wide text-emerald-900 dark:text-emerald-200 md:text-xs">
            Current
          </span>
          <span className="text-sm font-bold tabular-nums text-emerald-900 dark:text-emerald-200 md:text-base">
            ₹{aging.current.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
          </span>
        </Link>

        <div>
          <button
            type="button"
            onClick={() => setShowAging(!showAging)}
            className={`${rowClass} w-full border-red-100 bg-red-50 transition-colors hover:bg-red-100 dark:border-red-900 dark:bg-red-950/35 dark:hover:bg-red-950/50`}
          >
            <span className="text-[11px] font-medium uppercase tracking-wide text-red-700 dark:text-red-300 md:text-xs">
              Overdue
            </span>
            <div className="flex items-center gap-1.5">
              <span className="text-sm font-bold tabular-nums text-red-700 dark:text-red-300 md:text-base">
                ₹{overdue.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-red-700 transition-transform duration-200 dark:text-red-300 md:h-4 md:w-4 ${showAging ? 'rotate-180' : ''}`}
              />
            </div>
          </button>

          {showAging ? (
            <div className="mt-1.5 space-y-0.5 border-l-2 border-red-200 pl-3 dark:border-red-900 md:mt-2 md:space-y-1">
              {[
                { label: '1-15 Days', min: 1, max: 15, amount: aging.days_1_15 },
                { label: '16-30 Days', min: 16, max: 30, amount: aging.days_16_30 },
                { label: '31-45 Days', min: 31, max: 45, amount: aging.days_31_45 },
                { label: 'Above 45 days', min: 46, max: 9999, amount: aging.days_45_plus },
              ].map(({ label, min, max, amount }) => (
                <Link
                  key={label}
                  href={`/invoices?status=unpaid&aging_days_min=${min}&aging_days_max=${max}`}
                  className="flex items-center justify-between rounded px-1 py-1.5 transition-colors hover:bg-red-50 dark:hover:bg-red-950/25"
                >
                  <span className="text-[11px] text-text-secondary md:text-xs">{label}</span>
                  <span className="text-xs font-medium tabular-nums text-text-primary md:text-sm">
                    ₹{amount.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
};
