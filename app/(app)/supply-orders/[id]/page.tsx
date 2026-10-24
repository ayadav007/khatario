'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { useToastContext } from '@/contexts/ToastContext';
import { SUPPLY_ORDER_STATUS_LABEL, supplyOrderChipVariant } from '@/components/suppliers/supplyOrderStatus';

type Line = {
  id: string;
  item_name: string;
  qty: number;
  confirmed_qty: number | null;
  factor: number;
  buyer_qty: number;
  buyer_item_name: string | null;
  buyer_unit: string | null;
  buyer_current_stock?: string | null;
  buyer_min_stock?: string | null;
  buyer_stock_at_suggestion?: string | null;
  vendor_item_id: string | null;
  vendor_item_name: string | null;
  vendor_unit: string | null;
  vendor_current_stock?: string | null;
  /** Per supplier unit: the supplier's price, or for the buyer the catalog / list price (null if hidden). */
  unit_price?: number | null;
};

type Detail = {
  role: 'buyer' | 'vendor';
  order: {
    id: string;
    status: string;
    origin: string;
    need_by: string | null;
    notes: string | null;
    buyer_name: string;
    supplier_name: string;
    invoice: { id: string; invoice_number: string } | null;
    purchase_id: string | null;
  };
  lines: Line[];
};

type Edit = { qty?: string; confirmed_qty?: string; vendor_item_id?: string; vendor_item_name?: string; remove?: boolean };

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** One Supplier Hub order, with the actions open to this side at its current step. */
export default function SupplyOrderPage({ params }: { params: { id: string } }) {
  const toast = useToastContext();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [pickQuery, setPickQuery] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/supply-orders/${params.id}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load the order');
      setDetail(data);
      setEdits({});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the order');
    } finally {
      setLoading(false);
    }
  }, [params.id, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (action: string, confirmText?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      const lines = Object.entries(edits).map(([id, e]) => ({
        id,
        qty: e.qty,
        confirmed_qty: e.confirmed_qty,
        vendor_item_id: e.vendor_item_id,
        remove: e.remove,
      }));
      const res = await fetch(`/api/supply-orders/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, lines }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed');
      toast.success(SUPPLY_ORDER_STATUS_LABEL[data.status] ?? 'Saved');
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!detail) return <div className="p-6 text-center">Order not found</div>;

  const { role, order, lines } = detail;
  const s = order.status;
  const vendorEditsDraft = role === 'vendor' && s === 'draft';
  const buyerConfirms = role === 'buyer' && s === 'proposed';
  const vendorResponds = role === 'vendor' && s === 'pending';
  const qtyEditable = vendorEditsDraft || buyerConfirms;
  const canPickVendorItem = vendorEditsDraft || vendorResponds;
  // Where the other side is waiting on an answer, Decline is the way out; Cancel covers the rest.
  const canCancel = ['draft', 'proposed', 'pending', 'confirmed', 'partial'].includes(s) && !buyerConfirms && !vendorResponds;
  const setEdit = (id: string, patch: Edit) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  const lineQty = (l: Line) => {
    const e = edits[l.id] || {};
    if (e.remove) return 0;
    if (qtyEditable && e.qty != null && e.qty !== '') return Number(e.qty) || 0;
    if (vendorResponds && e.confirmed_qty != null && e.confirmed_qty !== '') return Number(e.confirmed_qty) || 0;
    return l.confirmed_qty ?? l.qty;
  };
  const priced = lines.filter((l) => l.unit_price != null && !edits[l.id]?.remove);
  const total = priced.reduce((sum, l) => sum + lineQty(l) * Number(l.unit_price), 0);
  const allPriced = priced.length === lines.filter((l) => !edits[l.id]?.remove).length;

  return (
    <div className="space-y-4">
      <PageHeader
        title={role === 'buyer' ? `Order from ${order.supplier_name}` : `Order for ${order.buyer_name}`}
        subtitle={[
          order.origin === 'suggested' ? 'Suggested from low stock' : null,
          order.need_by ? `Needed by ${new Date(order.need_by).toLocaleDateString('en-IN')}` : null,
          order.notes,
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <Link href="/supply-orders">
            <Button variant="secondary">All orders</Button>
          </Link>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Chip variant={supplyOrderChipVariant(s)}>{SUPPLY_ORDER_STATUS_LABEL[s] ?? s}</Chip>
        {order.invoice && <span className="text-sm text-text-secondary">Bill {order.invoice.invoice_number}</span>}
      </div>

      <Card padding="md">
        <ul className="divide-y divide-gray-100">
          {lines.map((l) => {
            const e = edits[l.id] || {};
            if (e.remove) return null;
            const qty = e.qty != null && e.qty !== '' ? Number(e.qty) : l.qty;
            const unit = role === 'vendor' ? l.vendor_unit : l.buyer_unit;
            return (
              <li key={l.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">
                      {role === 'buyer' ? l.buyer_item_name || l.item_name : l.vendor_item_name || l.item_name}
                    </p>
                    <p className="text-xs text-text-secondary">
                      {role === 'vendor' && l.vendor_item_name && l.vendor_item_name !== l.item_name ? `Buyer calls it ${l.item_name} · ` : ''}
                      {role === 'vendor' && l.buyer_stock_at_suggestion != null ? `Buyer had ${fmt(Number(l.buyer_stock_at_suggestion))} left · ` : ''}
                      {role === 'vendor' && l.vendor_current_stock != null ? `You have ${fmt(Number(l.vendor_current_stock))}` : ''}
                      {role === 'buyer' && l.buyer_current_stock != null ? `In stock ${fmt(Number(l.buyer_current_stock))}` : ''}
                      {l.factor !== 1 ? ` · 1 ${l.vendor_unit || 'pack'} = ${fmt(l.factor)} ${l.buyer_unit || 'units'}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-sm">
                    {qtyEditable ? (
                      <input
                        type="number"
                        min={0}
                        step="any"
                        className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                        value={e.qty ?? String(l.qty)}
                        onChange={(ev) => setEdit(l.id, { qty: ev.target.value })}
                      />
                    ) : (
                      <span className="font-semibold">{fmt(l.confirmed_qty ?? l.qty)}</span>
                    )}
                    <span className="text-text-secondary">
                      {role === 'vendor' || l.factor !== 1 ? l.vendor_unit || 'packs' : l.buyer_unit || 'units'}
                    </span>
                    {role === 'buyer' && l.factor !== 1 && (
                      <span className="text-xs text-text-secondary">= {fmt(qty * l.factor)} {unit || 'units'}</span>
                    )}
                    {qtyEditable && (
                      <Button size="sm" variant="ghost" onClick={() => setEdit(l.id, { remove: true })}>
                        Remove
                      </Button>
                    )}
                  </div>
                </div>

                {l.unit_price != null && (
                  <p className="text-right text-xs text-text-secondary">
                    {inr(Number(l.unit_price))} / {(role === 'vendor' || l.factor !== 1 ? l.vendor_unit : l.buyer_unit) || 'unit'}
                    {' · '}
                    <span className="font-medium text-text-primary">{inr(lineQty(l) * Number(l.unit_price))}</span>
                  </p>
                )}

                {l.confirmed_qty != null && l.confirmed_qty !== l.qty && !qtyEditable && (
                  <p className="text-xs text-amber-700">Asked for {fmt(l.qty)}; supplier confirmed {fmt(l.confirmed_qty)}.</p>
                )}

                {vendorResponds && (
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    You can supply
                    <input
                      type="number"
                      min={0}
                      max={l.qty}
                      step="any"
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={e.confirmed_qty ?? String(l.qty)}
                      onChange={(ev) => setEdit(l.id, { confirmed_qty: ev.target.value })}
                    />
                    of {fmt(l.qty)}
                  </label>
                )}

                {canPickVendorItem && (!l.vendor_item_id || e.vendor_item_id) && (
                  <div className="space-y-1">
                    <p className="text-xs text-amber-700">
                      {e.vendor_item_name ? `Your item: ${e.vendor_item_name}` : 'Pick your item for this line'}
                    </p>
                    <ItemAutocomplete
                      value={pickQuery[l.id] || ''}
                      onChange={(v) => setPickQuery((prev) => ({ ...prev, [l.id]: v }))}
                      placeholder="Search your items"
                      onSelect={(item) => {
                        setEdit(l.id, { vendor_item_id: item.id, vendor_item_name: item.name });
                        setPickQuery((prev) => ({ ...prev, [l.id]: '' }));
                      }}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {priced.length > 0 && (
          <div className="mt-2 flex items-baseline justify-between border-t border-gray-100 pt-3">
            <span className="text-sm text-text-secondary">
              {role === 'buyer' ? 'Estimated total' : 'Total'}
              {!allPriced ? ' (priced lines)' : ''}
            </span>
            <span className="text-lg font-semibold text-text-primary">{inr(total)}</span>
          </div>
        )}
        {role === 'buyer' && priced.length > 0 && (
          <p className="mt-1 text-xs text-text-secondary">From the supplier&apos;s prices, before tax. Their bill is final.</p>
        )}
      </Card>

      <Card padding="md" className="flex flex-wrap gap-2">
        {vendorEditsDraft && (
          <>
            <Button onClick={() => act('send')} disabled={busy}>
              Send to buyer for confirmation
            </Button>
            <Button variant="secondary" onClick={() => act('update')} disabled={busy || Object.keys(edits).length === 0}>
              Save changes
            </Button>
          </>
        )}
        {buyerConfirms && (
          <>
            <Button onClick={() => act('confirm')} disabled={busy}>
              Confirm order
            </Button>
            <Button variant="ghost" onClick={() => act('decline', 'Decline this order?')} disabled={busy}>
              Decline
            </Button>
          </>
        )}
        {vendorResponds && (
          <>
            <Button onClick={() => act('respond')} disabled={busy}>
              Confirm quantities
            </Button>
            <Button variant="ghost" onClick={() => act('decline', 'Decline this order?')} disabled={busy}>
              Decline
            </Button>
          </>
        )}
        {role === 'vendor' && (s === 'confirmed' || s === 'partial') && (
          <Link href={`/invoices/new?supply_order_id=${order.id}`}>
            <Button>Create bill</Button>
          </Link>
        )}
        {role === 'buyer' && s === 'invoiced' && order.invoice && (
          <Link href={`/purchases/incoming/${order.invoice.id}`}>
            <Button>Receive bill</Button>
          </Link>
        )}
        {role === 'buyer' && s === 'received' && order.purchase_id && (
          <Link href={`/purchases/${order.purchase_id}`}>
            <Button variant="secondary">Open purchase</Button>
          </Link>
        )}
        {canCancel && (
          <Button variant="ghost" onClick={() => act('cancel', 'Cancel this order?')} disabled={busy}>
            Cancel order
          </Button>
        )}
        {role === 'buyer' && s === 'pending' && (
          <p className="w-full text-sm text-text-secondary">Waiting for {order.supplier_name} to confirm quantities.</p>
        )}
        {role === 'vendor' && s === 'proposed' && (
          <p className="w-full text-sm text-text-secondary">Waiting for {order.buyer_name} to confirm.</p>
        )}
      </Card>
    </div>
  );
}
