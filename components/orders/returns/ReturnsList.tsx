'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { ReturnStatusBadge } from './ReturnStatusBadge';
import { ReturnDrawer } from './ReturnDrawer';
import { RETURN_REASON_LABELS, type ReturnReason, type ReturnStatus } from '@/lib/returns/labels';

interface Row {
  id: string;
  return_number: string;
  status: ReturnStatus;
  initiated_by: string;
  reason: ReturnReason;
  invoice_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  total_qty: string;
  credit_amount: string;
  refunded_amount: string;
  requested_at: string;
}

const FILTERS: Array<{ key: string; label: string }> = [
  { key: 'open', label: 'Open' },
  { key: 'requested', label: 'Requested' },
  { key: 'approved', label: 'Awaiting goods' },
  { key: 'received', label: 'Refund due' },
  { key: 'closed', label: 'Closed' },
  { key: 'rejected', label: 'Rejected' },
  { key: '', label: 'All' },
];

const inr = (n: number | string) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const day = (iso: string) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** The "Returns" view of the orders hub. */
export function ReturnsList({ onCounts }: { onCounts?: (c: Record<string, number>) => void }) {
  const [filter, setFilter] = useState('open');
  const [rows, setRows] = useState<Row[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/returns${filter ? `?status=${filter}` : ''}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || 'Could not load returns');
      setRows([]);
      return;
    }
    setRows(json.returns ?? []);
    setCounts(json.counts ?? {});
    onCounts?.(json.counts ?? {});
  }, [filter, onCounts]);

  useEffect(() => {
    void load();
  }, [load]);

  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
      active ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
    }`;

  return (
    <div className="space-y-3">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const n = f.key === 'open' ? (counts.requested ?? 0) + (counts.approved ?? 0) + (counts.received ?? 0) : counts[f.key];
          return (
            <button key={f.key || 'all'} type="button" className={chip(filter === f.key)} onClick={() => setFilter(f.key)}>
              {f.label}
              {n ? ` · ${n}` : ''}
            </button>
          );
        })}
      </div>

      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {rows === null ? (
          <div className="flex justify-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">
            No returns here. Start one from an order&apos;s details, or buyers can ask from their store account.
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r.id)} className="grid w-full grid-cols-[1fr_auto] gap-x-3 gap-y-1 px-4 py-3 text-left hover:bg-slate-50 md:grid-cols-[10rem_1fr_10rem_7rem_8rem] md:items-center dark:hover:bg-slate-800/50">
                  <div>
                    <div className="font-medium">{r.return_number}</div>
                    <div className="text-xs text-slate-500">
                      {r.invoice_number} · {day(r.requested_at)}
                    </div>
                  </div>
                  <div className="text-right md:order-last md:text-left">
                    <ReturnStatusBadge status={r.status} />
                  </div>
                  <div className="min-w-0">
                    <div className="truncate text-sm">{r.customer_name || r.customer_phone || '—'}</div>
                    <div className="text-xs text-slate-500">
                      {r.initiated_by === 'customer' ? 'Customer asked' : r.initiated_by === 'courier' ? 'Courier return' : 'Shop'}
                    </div>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">{RETURN_REASON_LABELS[r.reason] ?? r.reason}</div>
                  <div className="text-right text-sm md:text-left">
                    {Number(r.total_qty)} item(s)
                    {Number(r.credit_amount) > 0 ? <div className="text-xs text-slate-500">{inr(r.credit_amount)}</div> : null}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {open ? <ReturnDrawer id={open} onClose={() => setOpen(null)} onChanged={() => void load()} /> : null}
    </div>
  );
}
