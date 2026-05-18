'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2, Download } from 'lucide-react';
import { clsx } from 'clsx';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';

export type ProfitInvoiceRow = {
  invoice_id: string;
  invoice_number: string | null;
  date: string | null;
  customer_name: string | null;
  total_revenue: number;
  total_cost: number;
  total_profit: number;
  margin_percent: number;
};

function formatInr(n: number): string {
  if (!Number.isFinite(n)) return '₹0.00';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(n: number): string {
  if (!Number.isFinite(n)) return '0.00%';
  return `${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function monthToDateDefaults() {
  const to = new Date();
  const from = new Date(to.getFullYear(), to.getMonth(), 1);
  return {
    start_date: from.toISOString().slice(0, 10),
    end_date: to.toISOString().slice(0, 10),
  };
}

function escapeCsvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? '' : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function rowsToCsv(rows: ProfitInvoiceRow[]): string {
  const header = [
    'Invoice No',
    'Date',
    'Customer',
    'Revenue',
    'Cost',
    'Profit',
    'Margin %',
  ].join(',');
  const lines = rows.map((r) =>
    [
      escapeCsvCell(r.invoice_number ?? ''),
      escapeCsvCell(r.date ?? ''),
      escapeCsvCell(r.customer_name ?? ''),
      escapeCsvCell(Number(r.total_revenue).toFixed(2)),
      escapeCsvCell(Number(r.total_cost).toFixed(2)),
      escapeCsvCell(Number(r.total_profit).toFixed(2)),
      escapeCsvCell(Number(r.margin_percent).toFixed(2)),
    ].join(',')
  );
  return [header, ...lines].join('\r\n');
}

export default function ProfitByInvoiceReportPage() {
  const { business, user } = useAuth();
  const toast = useToastContext();
  const [startDate, setStartDate] = useState(monthToDateDefaults().start_date);
  const [endDate, setEndDate] = useState(monthToDateDefaults().end_date);
  const [rows, setRows] = useState<ProfitInvoiceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortProfitDesc, setSortProfitDesc] = useState(true);

  const load = useCallback(async () => {
    if (!business?.id || !user?.id) return;
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        business_id: business.id,
        user_id: user.id,
        start_date: startDate,
        end_date: endDate,
      });
      const res = await fetch(`/api/reports/profit-by-invoice?${params}`, {
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error ?? 'Failed to load report';
        setError(typeof msg === 'string' ? msg : 'Failed to load report');
        setRows([]);
        if (res.status !== 403) toast.error(typeof msg === 'string' ? msg : 'Failed to load report');
        return;
      }
      const list = Array.isArray(data.invoices) ? data.invoices : [];
      setRows(
        list.map((r: Record<string, unknown>) => ({
          invoice_id: String(r.invoice_id ?? ''),
          invoice_number: r.invoice_number != null ? String(r.invoice_number) : null,
          date: r.date != null ? String(r.date) : null,
          customer_name: r.customer_name != null ? String(r.customer_name) : null,
          total_revenue: Number(r.total_revenue) || 0,
          total_cost: Number(r.total_cost) || 0,
          total_profit: Number(r.total_profit) || 0,
          margin_percent: Number(r.margin_percent) || 0,
        }))
      );
    } catch (e) {
      console.error(e);
      setError('Network error');
      setRows([]);
      toast.error('Network error loading report');
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, startDate, endDate, toast]);

  useEffect(() => {
    if (business?.id && user?.id) {
      void load();
    }
  }, [business?.id, user?.id, load]);

  const sortedRows = useMemo(() => {
    const arr = [...rows];
    arr.sort((a, b) =>
      sortProfitDesc ? b.total_profit - a.total_profit : a.total_profit - b.total_profit
    );
    return arr;
  }, [rows, sortProfitDesc]);

  const exportCsv = useCallback(() => {
    const csv = rowsToCsv(sortedRows);
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `profit-by-invoice-${startDate}_${endDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [sortedRows, startDate, endDate]);

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 md:py-8">
      <Breadcrumbs />

      <div>
        <h1 className="text-2xl font-bold text-text-primary">Profit by invoice</h1>
        <p className="mt-1 text-sm text-text-secondary">
          Gross profit per finalized invoice (same basis as invoice detail profit summary).
        </p>
      </div>

      <Card padding="md" className="border border-border">
        <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-end">
          <label className="flex min-w-[10rem] flex-col gap-1 text-sm">
            <span className="font-medium text-text-secondary">Start date</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="input rounded-md border border-border bg-surface px-3 py-2 text-text-primary"
            />
          </label>
          <label className="flex min-w-[10rem] flex-col gap-1 text-sm">
            <span className="font-medium text-text-secondary">End date</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="input rounded-md border border-border bg-surface px-3 py-2 text-text-primary"
            />
          </label>
          <div className="flex flex-wrap gap-2 md:ml-auto">
            <Button
              variant="secondary"
              type="button"
              disabled={loading || sortedRows.length === 0}
              onClick={exportCsv}
            >
              <Download className="mr-2 h-4 w-4" aria-hidden />
              Export CSV
            </Button>
          </div>
        </div>
        <p className="mt-3 text-xs text-text-muted">
          Changing start or end date reloads the report.
        </p>
      </Card>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/35 dark:text-red-200">
          {error}
        </div>
      )}

      <Card padding="none" className="overflow-hidden border border-border">
        {loading ? (
          <div className="flex min-h-[240px] items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary-600" aria-hidden />
          </div>
        ) : sortedRows.length === 0 ? (
          !error ? (
            <div className="flex min-h-[200px] items-center justify-center px-6 py-16 text-text-secondary">
              No data found for this period.
            </div>
          ) : null
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-border bg-slate-50/95 text-left dark:bg-slate-900/60">
                  <th className="px-4 py-3 font-semibold text-text-primary">Invoice No</th>
                  <th className="px-4 py-3 font-semibold text-text-primary">Date</th>
                  <th className="px-4 py-3 font-semibold text-text-primary">Customer</th>
                  <th className="px-4 py-3 text-right font-semibold text-text-primary">Revenue</th>
                  <th className="px-4 py-3 text-right font-semibold text-text-primary">Cost</th>
                  <th className="px-4 py-3 text-right">
                    <button
                      type="button"
                      className="inline-flex w-full items-center justify-end gap-1.5 font-semibold text-text-primary hover:underline"
                      onClick={() => setSortProfitDesc((v) => !v)}
                      title={`Sort profit ${sortProfitDesc ? 'ascending' : 'descending'}`}
                    >
                      Profit
                      <span className="text-[11px] font-normal text-text-muted">
                        ({sortProfitDesc ? 'high→low' : 'low→high'})
                      </span>
                    </button>
                  </th>
                  <th className="px-4 py-3 text-right font-semibold text-text-primary">Margin</th>
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((r) => {
                  const profitPos = r.total_profit >= 0;
                  return (
                    <tr
                      key={r.invoice_id}
                      className="border-b border-border last:border-0 hover:bg-slate-50/80 dark:hover:bg-slate-800/50"
                    >
                      <td className="px-4 py-2.5 font-medium text-text-primary">
                        <Link
                          href={`/invoices/${r.invoice_id}`}
                          className="text-primary-600 hover:underline dark:text-primary-400"
                        >
                          {r.invoice_number ?? '—'}
                        </Link>
                      </td>
                      <td className="px-4 py-2.5 text-text-secondary tabular-nums">
                        {r.date ? new Date(r.date + 'T12:00:00').toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="max-w-[200px] truncate px-4 py-2.5 text-text-primary" title={r.customer_name ?? ''}>
                        {r.customer_name ?? '—'}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                        {formatInr(r.total_revenue)}
                      </td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-text-primary">
                        {formatInr(r.total_cost)}
                      </td>
                      <td
                        className={clsx(
                          'px-4 py-2.5 text-right font-medium tabular-nums',
                          profitPos ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
                        )}
                      >
                        {formatInr(r.total_profit)}
                      </td>
                      <td className="px-4 py-2.5 text-right font-bold tabular-nums text-text-primary">
                        {pct(r.margin_percent)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
