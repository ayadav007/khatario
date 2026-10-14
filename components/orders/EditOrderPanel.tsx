'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2, Plus } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type Line = { invoice_item_id: string; item_name: string; returnable_qty: number; unit_price: number; tax_rate: number };

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Edit a billed order before it is packed: take items off (credit note, stock back) or add items
 * as a new bill for the same customer.
 */
export function EditOrderPanel({
  invoiceId,
  customerId,
  paid,
  busy,
  onRemove,
}: {
  invoiceId: string;
  customerId: string | null;
  paid: boolean;
  busy: boolean;
  onRemove: (body: Record<string, unknown>) => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [method, setMethod] = useState<'store_credit' | 'cash' | 'upi' | 'bank'>('store_credit');

  useEffect(() => {
    let live = true;
    void fetch(`/api/returns?returnable_for=${invoiceId}`)
      .then((r) => (r.ok ? r.json() : { lines: [] }))
      .then((j) => {
        if (live) setLines((j.lines ?? []).filter((l: Line) => l.returnable_qty > 0));
      });
    return () => {
      live = false;
    };
  }, [invoiceId]);

  const chosen = (lines ?? []).map((l) => ({ l, q: Math.min(l.returnable_qty, Math.max(0, Number(qty[l.invoice_item_id]) || 0)) })).filter((x) => x.q > 0);
  const value = chosen.reduce((s, x) => s + x.l.unit_price * x.q * (1 + x.l.tax_rate / 100), 0);

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
      <p className="text-xs text-slate-500">
        The bill is final, so items taken off get a credit note and go back into stock. The parcel stops carrying them.
      </p>
      {lines === null ? (
        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
      ) : lines.length === 0 ? (
        <p className="text-xs text-slate-500">Nothing left on this bill to take off.</p>
      ) : (
        <ul className="space-y-1.5">
          {lines.map((l) => (
            <li key={l.invoice_item_id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {l.item_name} <span className="text-slate-500">of {l.returnable_qty}</span>
              </span>
              <input
                className="w-20 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right dark:border-slate-600 dark:bg-slate-800"
                inputMode="decimal"
                placeholder="0"
                aria-label={`Remove how many ${l.item_name}`}
                value={qty[l.invoice_item_id] ?? ''}
                onChange={(e) => setQty((s) => ({ ...s, [l.invoice_item_id]: e.target.value }))}
              />
            </li>
          ))}
        </ul>
      )}
      {paid && chosen.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {(
            [
              ['store_credit', 'Keep as credit'],
              ['cash', 'Refund cash'],
              ['upi', 'Refund UPI'],
              ['bank', 'Bank transfer'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              type="button"
              onClick={() => setMethod(k)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                method === k ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="destructive"
          isLoading={busy}
          disabled={chosen.length === 0}
          onClick={() =>
            onRemove({
              action: 'remove_items',
              lines: chosen.map((x) => ({ invoice_item_id: x.l.invoice_item_id, quantity: x.q })),
              refund: paid ? { method } : undefined,
            })
          }
        >
          Remove {chosen.length > 0 ? `(${inr(value)})` : 'items'}
        </Button>
        <Link
          href={`/invoices/new${customerId ? `?customer_id=${customerId}` : ''}`}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
        >
          <Plus className="h-3 w-3" /> Add items as a new bill
        </Link>
      </div>
    </div>
  );
}
