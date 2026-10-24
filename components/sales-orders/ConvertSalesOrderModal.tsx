'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getApiErrorMessage } from '@/lib/api-utils';
import { lineRemainingQty } from '@/lib/sales-orders/billing-status';

export type ConvertableLine = {
  id: string;
  item_name: string;
  qty: number | string;
  fulfilled_qty?: number | string | null;
  unit?: string | null;
};

type Props = {
  open: boolean;
  orderId: string;
  orderNumber?: string | null;
  onClose: () => void;
  onSuccess: (result: {
    invoiceId: string;
    invoiceNumber?: string;
    partial: boolean;
    salesOrderStatus?: string;
  }) => void;
};

type DraftQty = Record<string, string>;

export function ConvertSalesOrderModal({ open, orderId, orderNumber, onClose, onSuccess }: Props) {
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<ConvertableLine[]>([]);
  const [qtyById, setQtyById] = useState<DraftQty>({});

  useEffect(() => {
    if (!open || !orderId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/sales-orders/${orderId}`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load sales order');
        const so = data.salesOrder || data;
        const items: ConvertableLine[] = (so.items || []).map((r: any) => ({
          id: String(r.id),
          item_name: String(r.item_name || 'Item'),
          qty: r.qty,
          fulfilled_qty: r.fulfilled_qty,
          unit: r.unit,
        }));
        const remaining = items.filter((l) => lineRemainingQty(l) > 0.0001);
        if (cancelled) return;
        setLines(remaining);
        const draft: DraftQty = {};
        for (const l of remaining) draft[l.id] = String(lineRemainingQty(l));
        setQtyById(draft);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orderId]);

  const selected = useMemo(() => {
    return lines
      .map((l) => {
        const remaining = lineRemainingQty(l);
        const qty = Number(qtyById[l.id]);
        return { line: l, remaining, qty: Number.isFinite(qty) ? qty : 0 };
      })
      .filter((x) => x.qty > 0);
  }, [lines, qtyById]);

  const invoiceAllRemaining = () => {
    const draft: DraftQty = {};
    for (const l of lines) draft[l.id] = String(lineRemainingQty(l));
    setQtyById(draft);
  };

  const clearAll = () => {
    const draft: DraftQty = {};
    for (const l of lines) draft[l.id] = '0';
    setQtyById(draft);
  };

  const submit = async (mode: 'selected' | 'all') => {
    setSubmitting(true);
    setError(null);
    try {
      const body =
        mode === 'all'
          ? {}
          : {
              lines: selected.map((s) => ({
                sales_order_item_id: s.line.id,
                quantity: s.qty,
              })),
            };
      if (mode === 'selected') {
        for (const s of selected) {
          if (s.qty > s.remaining + 0.0001) {
            setError(`Cannot invoice more than ${s.remaining} of "${s.line.item_name}"`);
            setSubmitting(false);
            return;
          }
        }
        if (selected.length === 0) {
          setError('Enter a quantity for at least one line');
          setSubmitting(false);
          return;
        }
      }

      const res = await fetch(`/api/sales-orders/${orderId}/convert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(getApiErrorMessage(data, 'Failed to convert to invoice'));
        return;
      }
      onSuccess({
        invoiceId: data.invoice?.id || data.invoice_id,
        invoiceNumber: data.invoice?.invoice_number,
        partial: !!data.partial,
        salesOrderStatus: data.sales_order_status,
      });
    } catch {
      setError('Failed to convert to invoice');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="convert-so-title"
        className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="convert-so-title" className="text-lg font-bold text-text-primary">
              Convert to invoice
            </h2>
            <p className="text-sm text-text-secondary">
              {orderNumber ? `#${orderNumber} · ` : ''}
              Choose quantities to invoice (leave full for complete convert)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-lg p-2 text-text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
            </div>
          ) : lines.length === 0 ? (
            <p className="py-6 text-sm text-text-secondary">Nothing left to invoice on this order.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2 text-sm">
                <button type="button" className="text-primary-600 hover:underline" onClick={invoiceAllRemaining}>
                  Fill all remaining
                </button>
                <span className="text-text-muted">·</span>
                <button type="button" className="text-primary-600 hover:underline" onClick={clearAll}>
                  Clear
                </button>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-text-secondary">
                    <th className="py-2 pr-2 font-medium">Item</th>
                    <th className="py-2 px-2 font-medium text-right">Remaining</th>
                    <th className="py-2 pl-2 font-medium text-right">Invoice qty</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l) => {
                    const remaining = lineRemainingQty(l);
                    return (
                      <tr key={l.id} className="border-b border-border/60">
                        <td className="py-2.5 pr-2 text-text-primary">{l.item_name}</td>
                        <td className="py-2.5 px-2 text-right tabular-nums text-text-secondary">
                          {remaining}
                          {l.unit ? ` ${l.unit}` : ''}
                        </td>
                        <td className="py-2.5 pl-2 text-right">
                          <input
                            type="number"
                            min={0}
                            max={remaining}
                            step="any"
                            value={qtyById[l.id] ?? '0'}
                            onChange={(e) => setQtyById((prev) => ({ ...prev, [l.id]: e.target.value }))}
                            className="w-24 rounded-lg border border-border bg-surface px-2 py-1.5 text-right tabular-nums"
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={() => void submit('all')} disabled={submitting || loading || lines.length === 0}>
            {submitting ? 'Converting…' : 'Invoice all remaining'}
          </Button>
          <Button variant="primary" onClick={() => void submit('selected')} disabled={submitting || loading || selected.length === 0}>
            {submitting ? 'Converting…' : 'Invoice selected'}
          </Button>
        </div>
      </div>
    </div>
  );
}
