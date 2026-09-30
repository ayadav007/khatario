'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import { AlertTriangle, ArrowLeft, ChevronRight, ExternalLink, Loader2 } from 'lucide-react';
import { SlideOverPanel } from '@/components/ui/SlideOverPanel';
import { buildApiUrl } from '@/lib/api-helpers';

export type DrillTarget =
  | { kind: 'account'; label: string; accountIds: string[] }
  | { kind: 'purchases'; label: string }
  | { kind: 'opening_stock'; label: string }
  | { kind: 'closing_stock'; label: string }
  | {
      kind: 'breakdown';
      label: string;
      note?: string;
      total: number;
      rows: Array<{ label: string; amount: number; sign: 1 | -1; target?: DrillTarget }>;
    };

interface VoucherRow {
  voucher_id: string | null;
  voucher_type: string;
  entry_date: string;
  document_number: string | null;
  party_name: string | null;
  narration: string | null;
  amount: number;
  source_missing: boolean;
  link: string | null;
}

interface ItemRow {
  item_id: string;
  item_name: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  unit_cost_source: string | null;
  link: string;
}

type DrillResponse =
  | { kind: 'vouchers'; title: string; total: number; count: number; truncated: boolean; rows: VoucherRow[] }
  | {
      kind: 'items';
      title: string;
      total: number;
      count: number;
      as_of_date: string;
      source: string;
      valuation_method: string;
      rows: ItemRow[];
    };

const VOUCHER_LABELS: Record<string, string> = {
  invoice: 'Invoice',
  purchase: 'Purchase',
  purchase_return: 'Purchase Return',
  credit_note: 'Credit Note',
  debit_note: 'Debit Note',
  expense: 'Expense',
  payment: 'Payment',
  journal: 'Journal',
  opening_stock: 'Opening Stock',
  stock_adjustment: 'Stock Adjustment',
  itc_reversal: 'ITC Reversal',
  provision: 'Provision',
  tds: 'TDS',
};

const STOCK_SOURCE_LABELS: Record<string, string> = {
  snapshot: 'Locked closing-stock snapshot',
  movements_derived: 'Derived from stock movements',
  items_opening_fallback: 'Item master opening stock',
  current_stock_fallback: 'Current stock (fallback)',
  empty: 'No stock found',
};

const inr = (n: number) =>
  `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const qty = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

interface Props {
  target: DrillTarget | null;
  onClose: () => void;
  businessId: string;
  userId: string;
  fromDate: string;
  toDate: string;
  financialYear?: string;
}

export function ProfitLossDrilldownPanel({
  target,
  onClose,
  businessId,
  userId,
  fromDate,
  toDate,
  financialYear,
}: Props) {
  const [stack, setStack] = useState<DrillTarget[]>([]);
  const current = stack[stack.length - 1] ?? null;
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setStack(target ? [target] : []);
  }, [target]);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!current || current.kind === 'breakdown') return;

    const params: Record<string, string> = {
      business_id: businessId,
      user_id: userId,
      from_date: fromDate,
      to_date: toDate,
      line: current.kind,
    };
    if (financialYear) params.financial_year = financialYear;
    if (current.kind === 'account') params.account_ids = current.accountIds.join(',');

    let cancelled = false;
    setLoading(true);
    fetch(buildApiUrl('/api/reports/profit-loss/drilldown', params))
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) setError(body.error || 'Failed to load details');
        else setData(body);
      })
      .catch(() => !cancelled && setError('Failed to load details'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [current, businessId, userId, fromDate, toDate, financialYear]);

  const push = (t: DrillTarget) => setStack((s) => [...s, t]);
  const back = () => setStack((s) => s.slice(0, -1));

  return (
    <SlideOverPanel
      open={!!current}
      onClose={onClose}
      title={current?.label ?? ''}
      widthClass="max-w-2xl"
    >
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between gap-2 text-sm text-text-secondary">
          {stack.length > 1 ? (
            <button
              type="button"
              onClick={back}
              className="inline-flex items-center gap-1 text-primary-600 hover:underline"
            >
              <ArrowLeft className="w-4 h-4" />
              {stack[stack.length - 2].label}
            </button>
          ) : (
            <span />
          )}
          <span>
            {format(new Date(fromDate), 'dd MMM yyyy')} – {format(new Date(toDate), 'dd MMM yyyy')}
          </span>
        </div>

        {current?.kind === 'breakdown' && <BreakdownView target={current} onDrill={push} />}

        {loading && (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin text-primary-500" />
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-3 text-sm text-red-900">{error}</div>
        )}

        {data?.kind === 'vouchers' && <VoucherView data={data} />}
        {data?.kind === 'items' && <ItemView data={data} />}
      </div>
    </SlideOverPanel>
  );
}

function BreakdownView({
  target,
  onDrill,
}: {
  target: Extract<DrillTarget, { kind: 'breakdown' }>;
  onDrill: (t: DrillTarget) => void;
}) {
  return (
    <div className="space-y-3">
      {target.note && <p className="text-sm text-text-secondary">{target.note}</p>}
      <div className="divide-y divide-border rounded-lg border border-border">
        {target.rows.map((row, idx) => {
          const content = (
            <>
              <span className="flex items-center gap-2">
                <span className="w-4 text-center font-mono text-text-secondary">{row.sign > 0 ? '+' : '−'}</span>
                {row.label}
              </span>
              <span className="flex items-center gap-1 font-semibold">
                {inr(row.amount)}
                {row.target && <ChevronRight className="w-4 h-4 text-text-secondary" />}
              </span>
            </>
          );
          return row.target ? (
            <button
              key={idx}
              type="button"
              onClick={() => onDrill(row.target!)}
              className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-slate-50"
            >
              {content}
            </button>
          ) : (
            <div key={idx} className="flex items-center justify-between px-3 py-2.5">
              {content}
            </div>
          );
        })}
        <div className="flex items-center justify-between px-3 py-2.5 font-bold bg-slate-50">
          <span>= {target.label}</span>
          <span className={target.total >= 0 ? 'text-green-600' : 'text-red-600'}>{inr(target.total)}</span>
        </div>
      </div>
    </div>
  );
}

function VoucherView({ data }: { data: Extract<DrillResponse, { kind: 'vouchers' }> }) {
  const missing = data.rows.filter((r) => r.source_missing).length;
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between rounded-lg bg-slate-50 px-3 py-2">
        <span className="text-sm text-text-secondary">
          {data.count} {data.count === 1 ? 'entry' : 'entries'}
        </span>
        <span className="font-bold">{inr(data.total)}</span>
      </div>

      {missing > 0 && (
        <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {missing} {missing === 1 ? 'entry has' : 'entries have'} no matching document (the source was deleted
            without reversing its ledger entries).
          </span>
        </div>
      )}

      {data.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-secondary">No entries in this period.</p>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border">
          {data.rows.map((r, idx) => {
            const body = (
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-text-secondary">
                      {VOUCHER_LABELS[r.voucher_type] ?? r.voucher_type}
                    </span>
                    <span className="font-medium">{r.document_number || '—'}</span>
                    {r.source_missing && (
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
                        Document missing
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-xs text-text-secondary">
                    {format(new Date(r.entry_date), 'dd MMM yyyy')}
                    {r.party_name ? ` · ${r.party_name}` : ''}
                  </div>
                  {r.narration && <div className="mt-0.5 truncate text-xs text-text-secondary">{r.narration}</div>}
                </div>
                <span className="flex shrink-0 items-center gap-1 font-semibold">
                  {inr(r.amount)}
                  {r.link && <ExternalLink className="w-3.5 h-3.5 text-text-secondary" />}
                </span>
              </div>
            );
            return r.link ? (
              <Link key={idx} href={r.link} target="_blank" className="block px-3 py-2.5 hover:bg-slate-50">
                {body}
              </Link>
            ) : (
              <div key={idx} className="px-3 py-2.5">
                {body}
              </div>
            );
          })}
        </div>
      )}

      {data.truncated && (
        <p className="text-xs text-text-secondary">
          Showing the first {data.rows.length} of {data.count} entries. The total above includes all of them.
        </p>
      )}
    </div>
  );
}

function ItemView({ data }: { data: Extract<DrillResponse, { kind: 'items' }> }) {
  return (
    <div className="space-y-3">
      <div className="rounded-lg bg-slate-50 px-3 py-2 text-sm">
        <div className="flex items-baseline justify-between">
          <span className="text-text-secondary">
            As of {format(new Date(data.as_of_date), 'dd MMM yyyy')} · {data.count} items
          </span>
          <span className="font-bold">{inr(data.total)}</span>
        </div>
        <div className="mt-1 text-xs text-text-secondary">
          {STOCK_SOURCE_LABELS[data.source] ?? data.source} · valuation {data.valuation_method.replace('_', ' ')}
        </div>
      </div>

      {data.rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-text-secondary">No stock on this date.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-xs text-text-secondary">
              <tr>
                <th className="px-3 py-2 font-medium">Item</th>
                <th className="px-3 py-2 font-medium text-right">Qty</th>
                <th className="px-3 py-2 font-medium text-right">Rate</th>
                <th className="px-3 py-2 font-medium text-right">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {data.rows.map((r) => (
                <tr key={r.item_id} className={r.quantity < 0 ? 'bg-red-50' : undefined}>
                  <td className="px-3 py-2">
                    <Link href={r.link} target="_blank" className="hover:underline">
                      {r.item_name}
                    </Link>
                    {r.quantity < 0 && <div className="text-xs text-red-700">Negative stock</div>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{qty(r.quantity)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{inr(r.unit_cost)}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{inr(r.total_value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
