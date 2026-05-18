'use client';

export const dynamic = 'force-dynamic';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowLeft, Calendar, FileDown, Loader2, Printer } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { useAuth } from '@/contexts/AuthContext';
import { useBranch } from '@/contexts/BranchContext';
import { useToastContext } from '@/contexts/ToastContext';
import {
  buildCustomerStatementHtml,
  csvEscape,
  customerStatementSummary,
  customerVoucherLabel,
  formatInrStatement,
  formatStatementDateInput,
  getDefaultCustomerStatementPeriod,
  printHtmlInIframe,
} from '@/lib/party-statement-print';

type StatementData = {
  business?: { name?: string; phone?: string };
  party?: { name?: string; phone?: string };
  from_date: string;
  to_date: string;
  opening_balance: number;
  closing_balance: number;
  transactions: Array<{
    transaction_date: string;
    transaction_type: string;
    reference_number: string;
    description: string;
    debit: number | string;
    credit: number | string;
    running_balance: number;
  }>;
};

function buildStatementCsv(data: StatementData, partyName: string, bizName: string) {
  const lines: string[] = [];
  lines.push([csvEscape('Business'), csvEscape(bizName)].join(','));
  lines.push([csvEscape('Customer'), csvEscape(partyName)].join(','));
  lines.push([csvEscape('Period'), csvEscape(`${data.from_date} to ${data.to_date}`)].join(','));
  lines.push([csvEscape('Opening balance'), csvEscape(data.opening_balance)].join(','));
  lines.push([csvEscape('Closing balance'), csvEscape(data.closing_balance)].join(','));
  lines.push('');
  lines.push(
    ['Date', 'Voucher', 'Reference', 'Particulars', 'Debit', 'Credit', 'Balance']
      .map((h) => csvEscape(h))
      .join(',')
  );
  for (const t of data.transactions || []) {
    lines.push(
      [
        csvEscape(formatStatementDateInput(t.transaction_date)),
        csvEscape(customerVoucherLabel(t.transaction_type)),
        csvEscape(t.reference_number),
        csvEscape(t.description),
        csvEscape(t.debit ?? ''),
        csvEscape(t.credit ?? ''),
        csvEscape(t.running_balance ?? ''),
      ].join(',')
    );
  }
  return '\uFEFF' + lines.join('\r\n');
}

export default function CustomerStatementPage() {
  const params = useParams();
  const customerId = params.id as string;
  const { business, user } = useAuth();
  const { currentBranchId, isLoading: branchLoading } = useBranch();
  const toast = useToastContext();

  const [data, setData] = useState<StatementData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingCsv, setExportingCsv] = useState(false);

  const load = useCallback(async () => {
    if (!business?.id || !user?.id || branchLoading) return;
    setLoading(true);
    setError(null);
    try {
      const { from_date, to_date } = getDefaultCustomerStatementPeriod();
      const sp = new URLSearchParams({
        business_id: business.id,
        party_id: customerId,
        party_type: 'customer',
        user_id: user.id,
        from_date,
        to_date,
      });
      if (currentBranchId && currentBranchId !== 'ALL') {
        sp.set('branch_id', currentBranchId);
      }
      const res = await fetch(`/api/reports/party/statement?${sp.toString()}`);
      const json = await res.json();
      if (!res.ok) {
        const detail = typeof json?.details === 'string' ? ` — ${json.details}` : '';
        throw new Error(
          (typeof json?.error === 'string' ? json.error : json?.message || 'Could not load statement') + detail
        );
      }
      setData({
        ...json,
        opening_balance: Number(json.opening_balance ?? 0),
        closing_balance: Number(json.closing_balance ?? 0),
        transactions: Array.isArray(json.transactions) ? json.transactions : [],
      });
    } catch (e: any) {
      setError(e?.message || 'Could not load statement');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [business?.id, user?.id, customerId, currentBranchId, branchLoading]);

  useEffect(() => {
    load();
  }, [load]);

  const handlePrint = () => {
    if (!data || !business) return;
    const partyName = data.party?.name || 'Customer';
    const html = buildCustomerStatementHtml({
      businessName: data.business?.name || business.name || 'Business',
      businessPhone: data.business?.phone ?? business.phone,
      partyName,
      partyPhone: data.party?.phone ?? undefined,
      fromDate: data.from_date,
      toDate: data.to_date,
      openingBalance: data.opening_balance,
      closingBalance: data.closing_balance,
      transactions: data.transactions,
    });
    printHtmlInIframe(html);
  };

  const handleCsv = () => {
    if (!data || !business) return;
    setExportingCsv(true);
    try {
      const partyName = data.party?.name || 'Customer';
      const bizName = data.business?.name || business.name || '';
      const csv = buildStatementCsv(data, partyName, bizName);
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const safe = partyName.replace(/[^\w\-]+/g, '_').slice(0, 48) || 'customer';
      a.href = url;
      a.download = `statement-${safe}-${data.from_date}_to_${data.to_date}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast.success('CSV downloaded');
    } catch (e) {
      console.error(e);
      toast.error('Could not download CSV');
    } finally {
      setExportingCsv(false);
    }
  };

  const periodDisplay = data
    ? `${formatStatementDateInput(data.from_date)} – ${formatStatementDateInput(data.to_date)}`
    : '';

  const summary = data ? customerStatementSummary(data.closing_balance) : null;

  return (
    <div className="max-w-3xl mx-auto space-y-4 pb-24 md:pb-8 px-3 sm:px-0">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between print:hidden">
        <Link
          href={`/customers/${customerId}`}
          className="inline-flex items-center text-sm font-medium text-text-secondary hover:text-text-primary"
        >
          <ArrowLeft className="w-4 h-4 mr-2 shrink-0" />
          Back to customer
        </Link>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
            disabled={!data || loading}
            onClick={handlePrint}
          >
            <Printer className="w-4 h-4 mr-2" />
            Print / PDF
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="flex-1 sm:flex-none min-h-[44px] sm:min-h-0"
            disabled={!data || loading || exportingCsv}
            onClick={handleCsv}
          >
            {exportingCsv ? (
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            ) : (
              <FileDown className="w-4 h-4 mr-2" />
            )}
            CSV
          </Button>
        </div>
      </div>

      {loading && (
        <div className="flex justify-center py-20">
          <Loader2 className="w-10 h-10 animate-spin text-primary-500" />
        </div>
      )}

      {!loading && error && (
        <Card padding="md" className="border-amber-200 bg-amber-50">
          <p className="font-medium text-amber-900">Could not load statement</p>
          <p className="text-sm text-amber-800/90 mt-1">{error}</p>
          <Button variant="secondary" size="sm" className="mt-4" onClick={() => load()}>
            Retry
          </Button>
        </Card>
      )}

      {!loading && !error && data && summary && (
        <>
          <div className="statement-document rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-6 shadow-sm dark:border-slate-200/80 dark:bg-white">
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 border-b border-border pb-4 mb-4">
              <div>
                <h1 className="text-lg sm:text-xl font-bold text-text-primary">Party statement</h1>
                <p className="text-sm text-text-secondary mt-1">
                  {data.business?.name || business?.name}
                  {data.business?.phone || business?.phone
                    ? ` · ${data.business?.phone || business?.phone}`
                    : ''}
                </p>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">Period</p>
                <p className="text-sm font-medium text-text-primary">{periodDisplay}</p>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row sm:justify-between gap-4 mb-6">
              <div>
                <p className="text-xs text-text-muted">To</p>
                <p className="font-semibold text-text-primary">{data.party?.name || 'Customer'}</p>
                {data.party?.phone && <p className="text-sm text-text-secondary">Phone: {data.party.phone}</p>}
              </div>
              <div className="rounded-xl border border-slate-200 bg-slate-100 px-4 py-3 sm:px-5 sm:py-4 sm:min-w-[220px] shadow-sm">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">{summary.title}</p>
                <p className="text-2xl font-bold text-text-primary tabular-nums mt-1">
                  ₹ {formatInrStatement(summary.amount)}
                </p>
                <p className="text-xs text-text-muted mt-1">{summary.subtitle}</p>
              </div>
            </div>

            {/* Mobile: cards */}
            <div className="md:hidden space-y-3">
              {data.transactions.map((row, idx) => {
                const dr = Number(row.debit || 0);
                const cr = Number(row.credit || 0);
                return (
                  <div
                    key={`${row.reference_number}-${idx}`}
                    className="rounded-xl border border-border bg-slate-50 p-4 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs text-text-muted flex items-center gap-1">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          {formatStatementDateInput(row.transaction_date)}
                        </p>
                        <p className="font-mono text-xs text-text-secondary mt-1 truncate">{row.reference_number}</p>
                        <p className="text-sm text-text-primary mt-1">{row.description}</p>
                      </div>
                      <Chip variant="default" className="shrink-0 text-[10px] max-w-[120px] truncate">
                        {customerVoucherLabel(row.transaction_type)}
                      </Chip>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-sm pt-2 border-t border-border">
                      <div>
                        <span className="text-text-muted text-xs">Debit</span>
                        <p className="font-medium tabular-nums">{dr > 0 ? `₹ ${formatInrStatement(dr)}` : '—'}</p>
                      </div>
                      <div>
                        <span className="text-text-muted text-xs">Credit</span>
                        <p className="font-medium tabular-nums text-emerald-700 dark:text-emerald-800">
                          {cr > 0 ? `₹ ${formatInrStatement(cr)}` : '—'}
                        </p>
                      </div>
                    </div>
                    <p className="text-right text-sm font-semibold tabular-nums pt-1 border-t border-border">
                      Balance ₹ {formatInrStatement(Number(row.running_balance))}
                    </p>
                  </div>
                );
              })}
            </div>

            {/* Desktop: table */}
            <div className="hidden md:block overflow-x-auto rounded-xl border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-100 text-left text-slate-700">
                    <th className="px-3 py-2.5 font-semibold">Date</th>
                    <th className="px-3 py-2.5 font-semibold">Voucher</th>
                    <th className="px-3 py-2.5 font-semibold">Reference</th>
                    <th className="px-3 py-2.5 font-semibold">Particulars</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Debit</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Credit</th>
                    <th className="px-3 py-2.5 font-semibold text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.transactions.map((row, idx) => {
                    const dr = Number(row.debit || 0);
                    const cr = Number(row.credit || 0);
                    return (
                      <tr key={`${row.reference_number}-${idx}`} className="border-t border-border">
                        <td className="px-3 py-2.5 whitespace-nowrap text-text-primary">
                          {formatStatementDateInput(row.transaction_date)}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="text-xs font-medium text-text-secondary">
                            {customerVoucherLabel(row.transaction_type)}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs text-text-secondary">{row.reference_number}</td>
                        <td className="px-3 py-2.5 max-w-[200px] text-text-primary">{row.description}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-text-primary">{dr > 0 ? formatInrStatement(dr) : '—'}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700 dark:text-emerald-800">
                          {cr > 0 ? formatInrStatement(cr) : '—'}
                        </td>
                        <td className="px-3 py-2.5 text-right font-medium tabular-nums text-text-primary">
                          {formatInrStatement(Number(row.running_balance))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-6 rounded-xl bg-slate-100 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <span className="text-sm font-medium text-text-secondary">Closing balance (signed)</span>
              <span className="text-lg font-bold tabular-nums text-text-primary">
                ₹ {formatInrStatement(data.closing_balance)}
              </span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
