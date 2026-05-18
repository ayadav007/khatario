'use client';

import React from 'react';
import { HelpCircle, RefreshCw } from 'lucide-react';
import type { Gstr13bReconciliationMode } from '@/components/gst/gstr13b-reconciliation-types';

const MODE_OPTIONS: { value: Gstr13bReconciliationMode; label: string }[] = [
  { value: 'live_vs_live', label: 'Live vs Live' },
  { value: 'filed_vs_live', label: 'Filed vs Live' },
  { value: 'filed_vs_filed', label: 'Filed vs Filed' },
];

const MODE_TOOLTIP = [
  'Live vs Live — Current books (GSTR-1 generator) vs current ledger-based GSTR-3B.',
  'Filed vs Live — Filed GSTR-1 snapshot vs current books for GSTR-3B.',
  'Filed vs Filed — Filed GSTR-1 snapshot vs filed GSTR-3B snapshot (when available).',
].join('\n');

export type BranchOption = { id: string; name: string; branch_code?: string; gstin?: string };

type Props = {
  period: string;
  onPeriodChange: (period: string) => void;
  mode: Gstr13bReconciliationMode;
  onModeChange: (mode: Gstr13bReconciliationMode) => void;
  branches: BranchOption[];
  /** When null, `branch_id` is omitted from the API call (server default branch). */
  branchId: string | null;
  onBranchChange: (branchId: string | null) => void;
  onRefresh: () => void;
  loading: boolean;
};

export function ReconciliationFilters({
  period,
  onPeriodChange,
  mode,
  onModeChange,
  branches,
  branchId,
  onBranchChange,
  onRefresh,
  loading,
}: Props) {
  const showBranch = branches.length > 1;

  return (
    <div className="rounded-xl border border-border bg-white p-4 shadow-sm">
      <div className="flex flex-col gap-4 lg:flex-row lg:flex-wrap lg:items-end">
        <div className="min-w-[200px]">
          <label className="mb-1 block text-xs font-medium text-text-secondary">Return period</label>
          <input
            type="month"
            value={period}
            onChange={(e) => onPeriodChange(e.target.value)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
          />
          <p className="mt-1 text-[11px] text-text-muted" title="GST return month in YYYY-MM">
            Format YYYY-MM (GST filing period)
          </p>
        </div>

        <div className="min-w-[220px]">
          <label className="mb-1 flex items-center gap-1 text-xs font-medium text-text-secondary">
            Comparison mode
            <span className="inline-flex text-text-muted" title={MODE_TOOLTIP}>
              <HelpCircle className="h-3.5 w-3.5" aria-hidden />
            </span>
          </label>
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as Gstr13bReconciliationMode)}
            className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
            title={MODE_TOOLTIP}
          >
            {MODE_OPTIONS.map((o) => (
              <option
                key={o.value}
                value={o.value}
                title={
                  o.value === 'live_vs_live'
                    ? 'Current books vs current books'
                    : o.value === 'filed_vs_live'
                      ? 'Filed GSTR-1 vs current books'
                      : 'Filed vs filed snapshot'
                }
              >
                {o.label}
              </option>
            ))}
          </select>
          <p className="mt-1 max-w-md text-[11px] leading-snug text-text-muted">
            <span className="font-medium text-text-secondary">Live vs Live</span> — current books vs current books ·{' '}
            <span className="font-medium text-text-secondary">Filed vs Live</span> — filed data vs current books ·{' '}
            <span className="font-medium text-text-secondary">Filed vs Filed</span> — filed vs filed snapshot
          </p>
        </div>

        {showBranch && (
          <div className="min-w-[220px]">
            <label className="mb-1 block text-xs font-medium text-text-secondary">Branch</label>
            <select
              value={branchId ?? ''}
              onChange={(e) => {
                const v = e.target.value;
                onBranchChange(v === '' ? null : v);
              }}
              className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary-500"
              title="Reconciliation is run for one branch at a time. Empty uses the server default branch."
            >
              <option value="">Default branch (server)</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {b.branch_code ? ` (${b.branch_code})` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-end">
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:opacity-60"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}
