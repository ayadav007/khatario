'use client';

import React from 'react';
import type { ReconciliationException, ReconciliationExceptionType } from '@/components/gst/gstr13b-reconciliation-types';

const TYPE_LABEL: Record<ReconciliationExceptionType, string> = {
  missing_invoice: 'Missing invoice',
  extra_invoice: 'Extra invoice',
  tax_mismatch: 'Tax mismatch',
  date_mismatch: 'Date mismatch',
  cdn_mismatch: 'CDN mismatch',
};

const TYPE_STYLE: Record<ReconciliationExceptionType, string> = {
  missing_invoice: 'border-amber-200 bg-amber-50 text-amber-900',
  extra_invoice: 'border-violet-200 bg-violet-50 text-violet-900',
  tax_mismatch: 'border-red-200 bg-red-50 text-red-900',
  date_mismatch: 'border-blue-200 bg-blue-50 text-blue-900',
  cdn_mismatch: 'border-orange-200 bg-orange-50 text-orange-900',
};

function fmtInr(n: number | undefined) {
  if (n === undefined) return '—';
  return `₹${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

type Props = {
  exceptions: ReconciliationException[];
  onRowClick: (ex: ReconciliationException) => void;
  activeKey?: string | null;
};

export function reconciliationExceptionKey(ex: ReconciliationException) {
  return `${ex.type}:${ex.invoice_id ?? ex.document_id ?? ex.details}`;
}

export function ReconciliationExceptions({ exceptions, onRowClick, activeKey }: Props) {
  if (exceptions.length === 0) {
    return (
      <div className="rounded-xl border border-green-200 bg-green-50/50 px-4 py-8 text-center text-sm text-green-900">
        No structured exceptions — voucher-level view may still show matched rows only.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm overflow-hidden">
      <div className="border-b border-border bg-gray-50 px-4 py-3">
        <h3 className="text-sm font-semibold text-text-primary">Exceptions</h3>
        <p className="mt-0.5 text-xs text-text-secondary">
          Click a row to filter the voucher table. Clear filters in the table to reset.
        </p>
      </div>
      <div className="max-h-[320px] overflow-y-auto overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="sticky top-0 z-10 border-b border-border bg-gray-100 text-left text-xs font-medium uppercase tracking-wide text-text-secondary">
              <th className="whitespace-nowrap px-4 py-2">Type</th>
              <th className="whitespace-nowrap px-4 py-2">Document</th>
              <th className="whitespace-nowrap px-4 py-2 text-right">Difference</th>
              <th className="px-4 py-2">Description</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {exceptions.map((ex) => {
              const k = reconciliationExceptionKey(ex);
              const active = activeKey === k;
              const id = ex.invoice_id ?? ex.document_id ?? '—';
              return (
                <tr
                  key={k}
                  onClick={() => onRowClick(ex)}
                  className={`cursor-pointer transition-colors ${
                    active ? 'bg-gray-100' : 'hover:bg-gray-50'
                  }`}
                >
                  <td className="whitespace-nowrap px-4 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[ex.type]}`}
                    >
                      {TYPE_LABEL[ex.type]}
                    </span>
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-text-primary">{id}</td>
                  <td className="px-4 py-2 text-right tabular-nums text-text-primary">{fmtInr(ex.difference)}</td>
                  <td className="px-4 py-2 text-text-secondary">{ex.details}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
