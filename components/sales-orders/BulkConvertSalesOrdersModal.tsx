'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { getApiErrorMessage } from '@/lib/api-utils';

type CustomerOpt = { id: string; name: string };
type OpenOrder = {
  id: string;
  order_number: string;
  order_date: string;
  grand_total: number | string;
  status: string;
};

type Props = {
  open: boolean;
  businessId: string;
  onClose: () => void;
  onDone: () => void;
};

/**
 * Vyapar-style bulk convert: pick one customer, select their fully open SOs, convert each.
 * Partial-open orders are excluded (same rule as Vyapar bulk).
 */
export function BulkConvertSalesOrdersModal({ open, businessId, onClose, onDone }: Props) {
  const [customers, setCustomers] = useState<CustomerOpt[]>([]);
  const [customerId, setCustomerId] = useState('');
  const [orders, setOrders] = useState<OpenOrder[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [converting, setConverting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !businessId) return;
    let cancelled = false;
    setLoadingCustomers(true);
    setError(null);
    fetch(`/api/customers?business_id=${businessId}&limit=200`, { credentials: 'include' })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data.error || 'Failed to load customers');
        const list = (data.customers || data || []) as Array<{ id: string; name: string }>;
        if (!cancelled) {
          setCustomers(list.map((c) => ({ id: c.id, name: c.name })).filter((c) => c.id && c.name));
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load customers');
      })
      .finally(() => {
        if (!cancelled) setLoadingCustomers(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, businessId]);

  const loadOrders = useCallback(async (cid: string) => {
    if (!cid || !businessId) return;
    setLoadingOrders(true);
    setError(null);
    setSelected(new Set());
    try {
      const res = await fetch(
        `/api/sales-orders?business_id=${businessId}&status=confirmed&customer_id=${encodeURIComponent(cid)}`,
        { credentials: 'include' },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to load sales orders');
      const all = (data.salesOrders || []) as Array<OpenOrder & { linked_invoice_count?: number }>;
      // Vyapar bulk: fully open only (no linked invoices / partial billing).
      setOrders(all.filter((o) => !(Number(o.linked_invoice_count) > 0)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load orders');
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  }, [businessId]);

  useEffect(() => {
    if (customerId) void loadOrders(customerId);
    else setOrders([]);
  }, [customerId, loadOrders]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => setSelected(new Set(orders.map((o) => o.id)));
  const clearAll = () => setSelected(new Set());

  const convert = async () => {
    if (selected.size === 0) {
      setError('Select at least one open sales order');
      return;
    }
    setConverting(true);
    setError(null);
    const ids = Array.from(selected);
    let ok = 0;
    const failures: string[] = [];
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const order = orders.find((o) => o.id === id);
      setProgress(`Converting ${i + 1} of ${ids.length}${order ? ` (${order.order_number})` : ''}…`);
      try {
        const res = await fetch(`/api/sales-orders/${id}/convert`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({}),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          failures.push(`${order?.order_number || id}: ${getApiErrorMessage(data, 'failed')}`);
        } else {
          ok += 1;
        }
      } catch {
        failures.push(`${order?.order_number || id}: network error`);
      }
    }
    setConverting(false);
    setProgress(null);
    if (failures.length) {
      setError(`${ok} converted. ${failures.length} failed: ${failures.slice(0, 3).join('; ')}`);
      void loadOrders(customerId);
      return;
    }
    onDone();
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="bulk-convert-title"
        className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl bg-white shadow-xl dark:bg-slate-900"
      >
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 id="bulk-convert-title" className="text-lg font-bold text-text-primary">
              Select orders to convert
            </h2>
            <p className="text-sm text-text-secondary">
              Same customer · fully open orders only (partial open excluded)
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={converting}
            className="rounded-lg p-2 text-text-muted hover:bg-slate-100 dark:hover:bg-slate-800"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">Customer *</label>
            {loadingCustomers ? (
              <Loader2 className="h-5 w-5 animate-spin text-primary-600" />
            ) : (
              <select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <option value="">Select customer</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {customerId ? (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-medium text-text-primary">Open sales orders</p>
                <div className="flex gap-2 text-sm">
                  <button type="button" className="text-primary-600 hover:underline" onClick={selectAll}>
                    Select all
                  </button>
                  <button type="button" className="text-primary-600 hover:underline" onClick={clearAll}>
                    Clear
                  </button>
                </div>
              </div>
              {loadingOrders ? (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-primary-600" />
                </div>
              ) : orders.length === 0 ? (
                <p className="py-6 text-sm text-text-secondary">No fully open sales orders for this customer.</p>
              ) : (
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {orders.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                        className="h-4 w-4 accent-primary-600"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-text-primary">{o.order_number}</p>
                        <p className="text-xs text-text-secondary">
                          {o.order_date ? new Date(o.order_date).toLocaleDateString() : '—'}
                        </p>
                      </div>
                      <p className="text-sm font-semibold tabular-nums text-text-primary">
                        ₹{Number(o.grand_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}

          {progress ? <p className="text-sm text-text-secondary">{progress}</p> : null}
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" onClick={onClose} disabled={converting}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void convert()}
            disabled={converting || selected.size === 0}
          >
            {converting ? 'Converting…' : `Convert ${selected.size || ''}`.trim()}
          </Button>
        </div>
      </div>
    </div>
  );
}
