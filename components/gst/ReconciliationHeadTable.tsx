'use client';

import React from 'react';
import { HelpCircle } from 'lucide-react';
import type { Gstr13bReconciliationPayload } from '@/components/gst/gstr13b-reconciliation-types';

function fmtInr(n: number) {
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(diff: number, base: number) {
  if (base === 0) return diff === 0 ? '0%' : '—';
  return `${((diff / base) * 100).toFixed(2)}%`;
}

type Props = {
  data: Gstr13bReconciliationPayload;
};

const HEADS = ['igst', 'cgst', 'sgst', 'cess'] as const;

export function ReconciliationHeadTable({ data }: Props) {
  const { head_wise } = data;

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border bg-gray-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Head-wise output tax</h3>
        <span
          className="inline-flex text-text-muted"
          title="Compared to GSTR-3B outward supplies (ledger basis) plus cess. Tolerance ±₹1 per head."
        >
          <HelpCircle className="h-4 w-4" />
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-border bg-gray-100 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
              <th className="whitespace-nowrap px-4 py-3">Tax head</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">GSTR-1</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">GSTR-3B</th>
              <th className="whitespace-nowrap px-4 py-3 text-right">Difference</th>
              <th className="whitespace-nowrap px-4 py-3 text-right" title="(Difference ÷ GSTR-3B) × 100">
                % vs 3B
              </th>
              <th className="whitespace-nowrap px-4 py-3 text-center">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {HEADS.map((h) => {
              const row = head_wise[h];
              const ok = row.status === 'matched';
              return (
                <tr
                  key={h}
                  className={ok ? 'bg-white' : 'bg-red-50/40'}
                >
                  <td className="px-4 py-3 font-medium uppercase text-text-primary">{h}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-primary">{fmtInr(row.gstr1)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-primary">{fmtInr(row.gstr3b)}</td>
                  <td
                    className={`px-4 py-3 text-right tabular-nums font-medium ${
                      ok ? 'text-green-700' : 'text-red-600'
                    }`}
                  >
                    {fmtInr(row.difference)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-text-secondary">
                    {pct(row.difference, row.gstr3b)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${
                        ok
                          ? 'border-green-200 bg-green-50 text-green-800'
                          : 'border-red-200 bg-red-50 text-red-800'
                      }`}
                    >
                      {ok ? 'Matched' : 'Mismatch'}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
