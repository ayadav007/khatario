'use client';

import type { ReactNode } from 'react';
import { format } from 'date-fns';

/** Shared building blocks for the sales and purchase register reports. */

export const inr = (v: unknown) => {
  const n = Number(v) || 0;
  const s = `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < 0 ? `(${s})` : s;
};
export const qty = (v: unknown) => (Number(v) || 0).toLocaleString('en-IN', { maximumFractionDigits: 3 });
export const periodLabel = (p: string) => format(new Date(`${p}T00:00:00`), 'dd MMM yyyy');

export function SummaryCards({ cards }: { cards: Array<{ label: string; value: string; sub?: string }> }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((c) => (
        <div key={c.label} className="bg-white rounded-xl p-5 border border-gray-200 shadow-sm">
          <p className="text-sm text-gray-500 mb-1">{c.label}</p>
          <p className="text-2xl font-bold text-gray-900">{c.value}</p>
          {c.sub && <p className="text-xs text-gray-500 mt-1">{c.sub}</p>}
        </div>
      ))}
    </div>
  );
}

export function ReportTable({
  columns,
  rows,
  total,
  testId,
  rowClass,
}: {
  columns: Array<{ label: string; right?: boolean }>;
  rows: ReactNode[][];
  total?: ReactNode[];
  testId?: string;
  rowClass?: (index: number) => string;
}) {
  const align = (i: number) => (columns[i]?.right ? 'text-right tabular-nums' : 'text-left');
  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full" data-testid={testId}>
          <thead className="bg-gray-50 border-b border-gray-200">
            <tr>
              {columns.map((c, i) => (
                <th key={c.label} className={`px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider ${align(i)}`}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, ri) => (
              <tr key={ri} className={`hover:bg-gray-50 ${rowClass?.(ri) ?? ''}`}>
                {r.map((cell, ci) => (
                  <td key={ci} className={`px-4 py-3 whitespace-nowrap text-sm ${ci === 0 ? 'font-medium' : ''} ${align(ci)}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {total && (
            <tfoot className="bg-gray-50 border-t-2 border-gray-300">
              <tr data-testid={testId ? `${testId}-total` : undefined}>
                {total.map((cell, ci) => (
                  <td key={ci} className={`px-4 py-3 whitespace-nowrap text-sm font-semibold text-gray-900 ${align(ci)}`}>
                    {cell}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

export function StatusBadge({ status, paymentStatus }: { status: string; paymentStatus?: string }) {
  const label = status === 'final' ? (paymentStatus || 'unpaid').replace('_', ' ') : status;
  const cls =
    status === 'cancelled' ? 'bg-gray-100 text-gray-600 line-through' :
    status === 'draft' ? 'bg-gray-100 text-gray-700' :
    paymentStatus === 'paid' ? 'bg-green-100 text-green-800' :
    paymentStatus === 'partially_paid' ? 'bg-yellow-100 text-yellow-800' :
    'bg-red-100 text-red-800';
  return <span className={`px-2 py-1 text-xs font-medium rounded-full capitalize ${cls}`}>{label}</span>;
}

/** Downloads the first non-empty row array of `data` (checked in `rowKeys` order) as CSV. */
export function exportCsv(fileName: string, data: any, rowKeys: string[]) {
  const key = rowKeys.find((k) => Array.isArray(data?.[k]) && data[k].length > 0);
  if (!key) return;
  const rows: Record<string, unknown>[] = data[key];
  const cols = Object.keys(rows[0]).filter((c) => typeof rows[0][c] !== 'object' || rows[0][c] === null);
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
  const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(a.href);
}
