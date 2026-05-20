'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { format, endOfMonth, startOfMonth, subDays } from 'date-fns';
import { Calendar, Loader2 } from 'lucide-react';
import { Chip } from '@/components/ui/Chip';
import { Button } from '@/components/ui/Button';
import { clsx } from 'clsx';
import { useToastContext } from '@/contexts/ToastContext';
import { isCapacitorNative } from '@/lib/capacitor/platform';
import {
  customerStatementSummary,
  customerVoucherLabel,
  indianFinancialYearStartIndia,
} from '@/lib/party-statement-print';

type LedgerRangePreset = 'current_month' | 'last_30' | 'fy' | 'all';

const RANGE_LABELS: Record<LedgerRangePreset, string> = {
  current_month: 'Current month',
  last_30: 'Last 30 days',
  fy: 'This FY',
  all: 'All time',
};

function formatInr(n: number) {
  return `₹ ${Number(n).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatYmd(d: Date) {
  return format(d, 'yyyy-MM-dd');
}

function rangeForPreset(preset: LedgerRangePreset): { from_date?: string; to_date?: string; label: string } {
  const today = new Date();
  switch (preset) {
    case 'current_month': {
      const from = startOfMonth(today);
      const to = endOfMonth(today);
      return { from_date: formatYmd(from), to_date: formatYmd(to), label: `${format(from, 'dd MMM yyyy')} – ${format(to, 'dd MMM yyyy')}` };
    }
    case 'last_30': {
      const from = subDays(today, 30);
      const to = today;
      return { from_date: formatYmd(from), to_date: formatYmd(to), label: `${format(from, 'dd MMM yyyy')} – ${format(to, 'dd MMM yyyy')}` };
    }
    case 'fy': {
      const from = indianFinancialYearStartIndia(today);
      const to = today;
      return { from_date: formatYmd(from), to_date: formatYmd(to), label: `${format(from, 'dd MMM yyyy')} – ${format(to, 'dd MMM yyyy')}` };
    }
    default:
      return { label: 'All periods' };
  }
}

export type PartyLedgerRow = {
  reference_number: string;
  transaction_date: string;
  transaction_type: string;
  description: string;
  debit: number | string;
  credit: number | string;
  running_balance: number;
};

export function CustomerLedgerView({
  businessId,
  userId,
  customerId,
  branchId,
}: {
  businessId: string;
  userId: string;
  customerId: string;
  /** Optional branch filter; pass 'ALL' to omit */
  branchId?: string | null;
}) {
  const toast = useToastContext();
  const [preset, setPreset] = useState<LedgerRangePreset>('current_month');
  const range = useMemo(() => rangeForPreset(preset), [preset]);

  const [rows, setRows] = useState<PartyLedgerRow[]>([]);
  const [openingBalance, setOpeningBalance] = useState<number>(0);
  const [closing, setClosing] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [sharing, setSharing] = useState(false);

  function buildStatementPdfUrl() {
    const sp = new URLSearchParams({
      business_id: businessId,
      party_type: 'customer',
      party_id: customerId,
      user_id: userId,
      from_date: range.from_date || '',
      to_date: range.to_date || '',
    });
    if (branchId && branchId !== 'ALL') sp.set('branch_id', branchId);
    return `/api/reports/party/statement/pdf?${sp.toString()}`;
  }

  async function downloadStatementPdf() {
    if (!range.from_date || !range.to_date) {
      toast.warning('Select a date range to download statement');
      return;
    }
    setDownloading(true);
    try {
      const url = buildStatementPdfUrl();
      // Works well on web; on native shells it will still open a viewer/downloader.
      window.open(url, '_blank');
    } finally {
      setDownloading(false);
    }
  }

  async function shareStatementPdf() {
    if (!range.from_date || !range.to_date) {
      toast.warning('Select a date range to share statement');
      return;
    }
    setSharing(true);
    try {
      const url = buildStatementPdfUrl();
      const res = await fetch(url, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as any)?.error || 'Failed to generate statement PDF');
      }
      const blob = await res.blob();

      if (isCapacitorNative()) {
        const { Filesystem, Directory } = await import('@capacitor/filesystem');
        const { Share } = await import('@capacitor/share');

        const base64 = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result.includes(',') ? result.split(',')[1] : result);
          };
          reader.onerror = () => reject(new Error('Could not read statement'));
          reader.readAsDataURL(blob);
        });

        const filename = `statement-${customerId}-${range.from_date}-${range.to_date}.pdf`;
        await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        const result = await Filesystem.getUri({ path: filename, directory: Directory.Cache });

        await Share.share({
          title: 'Customer statement',
          text: 'Customer statement PDF',
          files: [result.uri],
          dialogTitle: 'Share statement',
        });
        return;
      }

      const file = new File([blob], `statement-${range.from_date}-${range.to_date}.pdf`, {
        type: 'application/pdf',
      });
      if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title: 'Customer statement', files: [file] });
        return;
      }

      // Fallback: open download in a new tab
      window.open(url, '_blank');
    } catch (e: any) {
      toast.error(e?.message || 'Could not share statement');
    } finally {
      setSharing(false);
    }
  }

  useEffect(() => {
    if (!businessId || !userId || !customerId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const sp = new URLSearchParams({
          business_id: businessId,
          party_type: 'customer',
          party_id: customerId,
          user_id: userId,
        });
        if (branchId && branchId !== 'ALL') sp.set('branch_id', branchId);
        if (range.from_date) sp.set('from_date', range.from_date);
        if (range.to_date) sp.set('to_date', range.to_date);
        const res = await fetch(`/api/reports/party/ledger?${sp.toString()}`);
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          const msg =
            typeof data?.error === 'string' ? data.error : data?.message || 'Could not load ledger';
          const detail = typeof data?.details === 'string' ? data.details : '';
          setError(detail ? `${msg} — ${detail}` : msg);
          setRows([]);
          setOpeningBalance(0);
          setClosing(null);
          return;
        }
        setRows(Array.isArray(data.transactions) ? data.transactions : []);
        setOpeningBalance(typeof data.opening_balance === 'number' ? data.opening_balance : Number(data.opening_balance || 0));
        setClosing(typeof data.closing_balance === 'number' ? data.closing_balance : null);
      } catch {
        if (!cancelled) {
          setError('Could not load ledger');
          setRows([]);
          setOpeningBalance(0);
          setClosing(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [businessId, userId, customerId, branchId, range.from_date, range.to_date]);

  const totals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const r of rows) {
      debit += Number(r.debit || 0);
      credit += Number(r.credit || 0);
    }
    return { debit, credit };
  }, [rows]);

  const summary = useMemo(() => {
    if (typeof closing !== 'number') return null;
    return customerStatementSummary(closing);
  }, [closing]);

  return (
    <div className="space-y-4">
      <p className="text-xs text-text-muted">Debit increases amount due; credit is payment received.</p>

      <div>
        <p className="text-sm font-semibold text-text-primary mb-2">Select Duration</p>
        <select
          className="input h-11 text-base w-full"
          value={preset}
          onChange={(e) => setPreset(e.target.value as LedgerRangePreset)}
        >
          {(Object.keys(RANGE_LABELS) as LedgerRangePreset[]).map((k) => (
            <option key={k} value={k}>
              {RANGE_LABELS[k]}
            </option>
          ))}
        </select>
      </div>

      {summary && !loading && !error ? (
        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="text-sm font-semibold text-text-primary">
            Ledger Summary <span className="text-text-muted font-normal">({range.label})</span>
          </div>

          <div className="mt-4 rounded-lg border border-border bg-slate-50 p-4 text-center">
            <div className="text-xs text-text-muted">Net Balance</div>
            <div
              className={clsx(
                'mt-1 text-3xl font-bold tabular-nums',
                summary.signedClosing > 0.005
                  ? 'text-error'
                  : summary.signedClosing < -0.005
                    ? 'text-emerald-700'
                    : 'text-text-primary'
              )}
            >
              {formatInr(summary.amount)} {summary.signedClosing > 0.005 ? 'Dr' : summary.signedClosing < -0.005 ? 'Cr' : ''}
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <div className="rounded-lg border border-border bg-surface p-3 text-center">
              <div className="text-xs text-text-muted">Total Debit (-)</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatInr(totals.debit)}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-surface p-3 text-center">
              <div className="text-xs text-text-muted">Total Credit (+)</div>
              <div className="mt-1 text-lg font-semibold tabular-nums text-text-primary">
                {formatInr(totals.credit)}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin text-primary-500" />
        </div>
      ) : null}

      {!loading && error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="font-medium">Ledger could not be loaded</p>
          <p className="mt-1 text-amber-800/90">{error}</p>
        </div>
      ) : null}

      {!loading && !error && rows.length === 0 ? (
        <div className="text-center py-10 text-text-secondary">No ledger entries in this period.</div>
      ) : null}

      {!loading && !error && rows.length > 0 ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-text-primary">Transaction history</div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm min-w-[520px]">
              <thead className="border-b border-border bg-slate-50 text-[10px] uppercase tracking-wide text-text-muted">
                <tr>
                  <th className="text-left py-2 px-3 font-semibold">Transactions</th>
                  <th className="text-right py-2 px-3 font-semibold">Debit</th>
                  <th className="text-right py-2 px-3 font-semibold">Credit</th>
                </tr>
              </thead>
              <tbody>
                {/* Opening balance (only meaningful when we have a range start) */}
                {range.from_date ? (
                  <tr className="border-b border-border">
                    <td className="py-2 px-3">
                      <div className="font-semibold text-text-primary">Opening balance</div>
                      <div className="text-xs text-text-muted">(on {format(new Date(range.from_date), 'dd MMM yyyy')})</div>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-text-primary">
                      {openingBalance > 0 ? formatInr(openingBalance) : '—'}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-700">
                      {openingBalance < 0 ? formatInr(Math.abs(openingBalance)) : '—'}
                    </td>
                  </tr>
                ) : null}

                {rows.map((row, idx) => {
                  const dr = Number(row.debit || 0);
                  const cr = Number(row.credit || 0);
                  return (
                    <tr key={`${row.reference_number}-${row.transaction_date}-${idx}`} className="border-b border-border last:border-0">
                      <td className="py-2 px-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="font-medium text-text-primary">
                            {customerVoucherLabel(row.transaction_type)}
                          </div>
                          <div className="text-xs text-text-muted whitespace-nowrap">
                            {format(new Date(row.transaction_date), 'dd MMM yyyy')}
                          </div>
                        </div>
                        <div className="text-xs text-text-muted mt-0.5">
                          {row.reference_number} • {row.description}
                        </div>
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-text-primary">
                        {dr > 0 ? formatInr(dr) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right tabular-nums text-emerald-700">
                        {cr > 0 ? formatInr(cr) : '—'}
                      </td>
                    </tr>
                  );
                })}

                <tr className="border-t border-border bg-slate-50">
                  <td className="py-2 px-3 font-semibold text-text-primary">Grand Total</td>
                  <td className="py-2 px-3 text-right font-semibold tabular-nums text-text-primary">
                    {formatInr(totals.debit)}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold tabular-nums text-text-primary">
                    {formatInr(totals.credit)}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="flex gap-3 pt-2">
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => void downloadStatementPdf()}
              disabled={downloading || sharing || loading}
            >
              {downloading ? 'Downloading…' : 'Download'}
            </Button>
            <Button
              variant="primary"
              className="flex-1"
              onClick={() => void shareStatementPdf()}
              disabled={downloading || sharing || loading}
            >
              {sharing ? 'Sharing…' : 'Share'}
            </Button>
          </div>
          <p className="text-[11px] text-text-muted">
            Download/Share will attach the statement PDF in the next step (native WhatsApp share).
          </p>
        </div>
      ) : null}
    </div>
  );
}

