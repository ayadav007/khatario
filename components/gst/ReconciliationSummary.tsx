'use client';

import React from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import type { Gstr13bReconciliationPayload } from '@/components/gst/gstr13b-reconciliation-types';

function fmtInr(n: number) {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Props = {
  data: Gstr13bReconciliationPayload;
};

export function ReconciliationSummary({ data }: Props) {
  const matched = data.status === 'matched';
  const { stats, totals, meta, gst_period } = data;

  return (
    <div className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-text-primary">Summary</h2>
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${
                matched
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              {matched ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Matched
                </>
              ) : (
                <>
                  <XCircle className="h-3.5 w-3.5" />
                  Mismatch
                </>
              )}
            </span>
          </div>
          <p className="mt-1 text-sm text-text-secondary">
            Period <span className="font-mono text-text-primary">{gst_period}</span>
            <span className="mx-2 text-text-muted">·</span>
            <span title="How GSTR-1 and GSTR-3B figures were sourced">
              GSTR-1 heads: {meta.gstr1_head_source === 'filed_snapshot' ? 'Filed snapshot' : 'Live'}
            </span>
            <span className="mx-1 text-text-muted">·</span>
            <span>
              GSTR-3B: {meta.gstr3b_source === 'filed_snapshot' ? 'Filed snapshot' : 'Live'}
            </span>
          </p>
          <p className="mt-1 text-xs text-text-muted" title={meta.voucher_map_source}>
            Voucher-level map from live GSTR-1 generator (invoice/CDN traceability).
          </p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wide text-text-secondary">
            Net tax difference (Σ heads)
          </p>
          <p
            className={`text-2xl font-bold tabular-nums ${
              Math.abs(totals.difference) <= 1 ? 'text-green-700' : 'text-red-600'
            }`}
          >
            {fmtInr(totals.difference)}
          </p>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-border bg-gray-50/80 px-3 py-3">
          <p className="text-xs text-text-secondary">Vouchers compared</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-text-primary">
            {stats.total_vouchers_compared}
          </p>
        </div>
        <div className="rounded-lg border border-green-200 bg-green-50/60 px-3 py-3">
          <p className="text-xs text-green-800">Matched</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-green-900">{stats.matched}</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50/60 px-3 py-3">
          <p className="text-xs text-red-800">Mismatched</p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-red-900">{stats.mismatched}</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-3">
          <p className="text-xs text-amber-900">Missing (1↔3B)</p>
          <p className="mt-1 text-sm font-semibold tabular-nums text-amber-950">
            −3B: {stats.missing_in_ledger}
            <span className="mx-1 text-text-muted">|</span>−1: {stats.missing_in_gstr1}
          </p>
        </div>
      </div>

      {stats.b2cs_aggregated_rows > 0 && (
        <p className="mt-4 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
          B2CS includes {stats.b2cs_aggregated_rows} aggregated row(s) — not voucher-keyed in this drill-down.
        </p>
      )}
    </div>
  );
}
