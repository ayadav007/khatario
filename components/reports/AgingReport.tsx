'use client';

import React, { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronDown, ChevronRight, Download, FileText, Loader2 } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AccessDenied } from '@/components/common/AccessDenied';
import { useAuth } from '@/contexts/AuthContext';
import { buildApiUrl } from '@/lib/api-helpers';

type OpenItem = {
  transaction_id: string | null;
  transaction_type: string;
  reference_number: string;
  invoice_date: string;
  due_date: string | null;
  original_amount: number;
  outstanding: number;
  days_overdue: number;
};

type AgingEntry = {
  party_id: string | null;
  party_name: string;
  total_outstanding: number;
  bucket_not_due: number;
  bucket_0_30: number;
  bucket_31_60: number;
  bucket_61_90: number;
  bucket_90_plus: number;
  on_account: number;
  transactions: OpenItem[];
};

type Totals = Omit<AgingEntry, 'party_id' | 'party_name' | 'transactions'>;

const COLUMNS: Array<{ key: keyof Totals; label: string; className?: string }> = [
  { key: 'bucket_not_due', label: 'Not due' },
  { key: 'bucket_0_30', label: '1-30 Days' },
  { key: 'bucket_31_60', label: '31-60 Days' },
  { key: 'bucket_61_90', label: '61-90 Days' },
  { key: 'bucket_90_plus', label: '90+ Days' },
  { key: 'on_account', label: 'Unapplied credits' },
  { key: 'total_outstanding', label: 'Total', className: 'font-semibold' },
];

const cellClass = (c: (typeof COLUMNS)[number], value: number) =>
  [c.className, c.key === 'bucket_90_plus' && value > 0.005 ? 'text-red-600' : ''].filter(Boolean).join(' ');

const money = (n: number) => {
  const s = `₹${Math.abs(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  return n < -0.005 ? `(${s})` : s;
};
const fmtDate = (d: string | null) => (d ? format(new Date(`${d.slice(0, 10)}T00:00:00`), 'dd MMM yyyy') : '—');

function dueLabel(item: OpenItem) {
  if (item.outstanding < 0) return 'Credit';
  if (item.days_overdue < 0) return `Due in ${-item.days_overdue} d`;
  if (item.days_overdue === 0) return 'Due today';
  return `${item.days_overdue} d overdue`;
}

export function AgingReport({ kind }: { kind: 'receivables' | 'payables' }) {
  const { business, user } = useAuth();
  const [asOnDate, setAsOnDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [rows, setRows] = useState<AgingEntry[]>([]);
  const [totals, setTotals] = useState<Totals | null>(null);
  const [glBalance, setGlBalance] = useState<number | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; code?: string } | null>(null);

  const isAr = kind === 'receivables';
  const partyLabel = isAr ? 'Customer' : 'Supplier';
  const docLabel = isAr ? 'Invoice' : 'Bill';

  useEffect(() => {
    if (!business?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(
          buildApiUrl(`/api/reports/aging/${kind}`, { business_id: business.id, user_id: user?.id || '', as_on_date: asOnDate })
        );
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError({
            message: body.message || body.error || `Failed to fetch ${kind} aging report`,
            code: body.code || (res.status === 403 || res.status === 401 ? 'ACCESS_DENIED' : 'FETCH_ERROR'),
          });
          setRows([]);
          setTotals(null);
          return;
        }
        setRows(body.aging || []);
        setTotals(body.totals || null);
        setGlBalance(typeof body.gl_balance === 'number' ? body.gl_balance : null);
      } catch {
        if (!cancelled) setError({ message: `Failed to fetch ${kind} aging report`, code: 'NETWORK_ERROR' });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [business?.id, user?.id, asOnDate, kind]);

  const toggle = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">{isAr ? 'Receivables' : 'Payables'} Aging Report</h1>
          <p className="text-sm text-text-secondary mt-1">
            Outstanding {isAr ? 'invoices' : 'bills'} aged by due date. Unlinked {isAr ? 'receipts' : 'payments'} and
            notes are set off against the oldest open {isAr ? 'invoices' : 'bills'} first.
          </p>
        </div>
        <Button onClick={() => window.print()}>
          <Download className="w-4 h-4 mr-2" />
          Export
        </Button>
      </div>

      <Card>
        <Input
          type="date"
          label="As On Date"
          value={asOnDate}
          onChange={(e) => setAsOnDate(e.target.value)}
          className="max-w-xs"
        />
      </Card>

      <Card>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        ) : error ? (
          <div className="py-12">
            <AccessDenied module="reports" action="read" details={error.message} code={error.code || 'ACCESS_DENIED'} />
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center py-12">
            <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
            <p className="text-text-secondary">No {isAr ? 'receivables' : 'payables'} outstanding on this date</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-testid={`aging-${kind}-table`}>
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-3 px-4 font-semibold text-text-primary">{partyLabel}</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="text-right py-3 px-4 font-semibold text-text-primary whitespace-nowrap">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const key = row.party_id ?? '__unallocated__';
                  const open = expanded.has(key);
                  return (
                    <React.Fragment key={key}>
                      <tr
                        className="border-b border-border hover:bg-gray-50 cursor-pointer"
                        onClick={() => toggle(key)}
                        data-testid="aging-party-row"
                      >
                        <td className="py-3 px-4 font-medium">
                          <span className="inline-flex items-center gap-1">
                            {open ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                            {row.party_name}
                          </span>
                        </td>
                        {COLUMNS.map((c) => (
                          <td key={c.key} className={`py-3 px-4 text-right whitespace-nowrap ${cellClass(c, row[c.key] as number)}`}>
                            {money(row[c.key] as number)}
                          </td>
                        ))}
                      </tr>
                      {open && (
                        <tr className="bg-gray-50 border-b border-border">
                          <td colSpan={COLUMNS.length + 1} className="px-8 py-3">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="text-text-secondary">
                                  <th className="text-left py-1 pr-4">{docLabel} / Reference</th>
                                  <th className="text-left py-1 pr-4">Date</th>
                                  <th className="text-left py-1 pr-4">Due date</th>
                                  <th className="text-left py-1 pr-4">Status</th>
                                  <th className="text-right py-1 pr-4">Amount</th>
                                  <th className="text-right py-1">Balance</th>
                                </tr>
                              </thead>
                              <tbody>
                                {row.transactions.map((t, i) => (
                                  <tr key={`${t.transaction_id}-${i}`}>
                                    <td className="py-1 pr-4">{t.reference_number}</td>
                                    <td className="py-1 pr-4">{fmtDate(t.invoice_date)}</td>
                                    <td className="py-1 pr-4">{fmtDate(t.due_date || t.invoice_date)}</td>
                                    <td className={`py-1 pr-4 ${t.days_overdue > 0 && t.outstanding > 0 ? 'text-red-600' : ''}`}>
                                      {dueLabel(t)}
                                    </td>
                                    <td className="py-1 pr-4 text-right">{money(t.original_amount)}</td>
                                    <td className="py-1 text-right">{money(t.outstanding)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
                {totals && (
                  <tr className="border-t-2 border-border font-bold bg-gray-50" data-testid="aging-total-row">
                    <td className="py-3 px-4">Total</td>
                    {COLUMNS.map((c) => (
                      <td key={c.key} className={`py-3 px-4 text-right whitespace-nowrap ${cellClass(c, totals[c.key] as number)}`}>
                        {money(totals[c.key] as number)}
                      </td>
                    ))}
                  </tr>
                )}
              </tbody>
            </table>
            {glBalance !== null && (
              <p className="text-xs text-text-secondary mt-3 px-4">
                {isAr ? 'Accounts Receivable' : 'Accounts Payable'} ledger balance on {fmtDate(asOnDate)}: {money(glBalance)}
              </p>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
