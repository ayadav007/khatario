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
import { SupplyOrderComments } from '@/components/suppliers/SupplyOrderComments';

type Line = {
  id: string;
  item_name: string;
  option_label?: string | null;
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
    parent_order_id: string | null;
    dispatched_at: string | null;
    dispatch_note: string | null;
    backorders: { id: string; status: string }[];
  };
  lines: Line[];
};

type Edit = {
  qty?: string;
  confirmed_qty?: string;
  vendor_item_id?: string;
  vendor_item_name?: string;
  vendor_item_unit?: string;
  /** Buyer units in one supplier unit, for a line the supplier is matching for the first time */
  factor?: string;
  /** Keep the unconfirmed rest as a backorder (default yes) */
  backorder?: boolean;
  remove?: boolean;
};

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
  const [dispatchNote, setDispatchNote] = useState('');
  /** What would stop the bill being finalised (supplier, confirmed orders only). */
  const [billWarnings, setBillWarnings] = useState<Array<{ message: string; href: string }>>([]);

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

  const readyToBill = detail?.role === 'vendor' && (detail.order.status === 'confirmed' || detail.order.status === 'partial');
  useEffect(() => {
    if (!readyToBill) return setBillWarnings([]);
    fetch(`/api/supply-orders/${params.id}/invoice-draft`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBillWarnings(d?.warnings || []))
      .catch(() => setBillWarnings([]));
  }, [readyToBill, params.id]);

  const act = async (action: string, confirmText?: string, note?: string) => {
    if (confirmText && !confirm(confirmText)) return;
    setBusy(true);
    try {
      const lines = Object.entries(edits).map(([id, e]) => ({
        id,
        qty: e.qty,
        confirmed_qty: e.confirmed_qty,
        vendor_item_id: e.vendor_item_id,
        factor: e.vendor_item_id ? e.factor : undefined,
        backorder: e.backorder,
        remove: e.remove,
      }));
      const res = await fetch(`/api/supply-orders/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, lines, note }),
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
  const canCancel =
    (['draft', 'proposed', 'pending', 'confirmed', 'partial'].includes(s) || (s === 'awaiting_link' && role === 'buyer')) &&
    !buyerConfirms &&
    !vendorResponds;
  const setEdit = (id: string, patch: Edit) => setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  /** A line asked for in the buyer's units becomes whole supplier units once its pack size is set. */
  const askedQty = (l: Line) => {
    const e = edits[l.id] || {};
    const f = Number(e.factor);
    if (l.vendor_item_id || !e.vendor_item_id || !(f > 0) || f === l.factor) return l.qty;
    const buyerQty = l.qty * l.factor;
    return f > 1 ? Math.max(1, Math.ceil(buyerQty / f - 1e-9)) : buyerQty;
  };
  const lineQty = (l: Line) => {
    const e = edits[l.id] || {};
    if (e.remove) return 0;
    if (qtyEditable && e.qty != null && e.qty !== '') return Number(e.qty) || 0;
    if (vendorResponds && e.confirmed_qty != null && e.confirmed_qty !== '') return Number(e.confirmed_qty) || 0;
    return l.confirmed_qty ?? askedQty(l);
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
        {order.parent_order_id && (
          <Link href={`/supply-orders/${order.parent_order_id}`} className="text-sm text-primary-600 hover:underline">
            Backorder of an earlier order
          </Link>
        )}
        {order.backorders.map((b) => (
          <Link key={b.id} href={`/supply-orders/${b.id}`} className="text-sm text-primary-600 hover:underline">
            Backorder · {SUPPLY_ORDER_STATUS_LABEL[b.status] ?? b.status}
          </Link>
        ))}
      </div>
      {order.dispatched_at && (
        <p className="text-sm text-text-secondary">
          Dispatched {new Date(order.dispatched_at).toLocaleDateString('en-IN')}
          {order.dispatch_note ? ` · ${order.dispatch_note}` : ''}
        </p>
      )}

      <Card padding="md">
        <ul className="divide-y divide-gray-100">
          {lines.map((l) => {
            const e = edits[l.id] || {};
            if (e.remove) return null;
            const qty = e.qty != null && e.qty !== '' ? Number(e.qty) : l.qty;
            const unit = role === 'vendor' ? l.vendor_unit : l.buyer_unit;
            // Until the supplier matches a line, it was asked for in the buyer's unit.
            const matching = role === 'vendor' && !l.vendor_item_id;
            const asked = askedQty(l);
            const supplierUnit = matching ? (e.vendor_item_id ? e.vendor_item_unit : l.buyer_unit) : l.vendor_unit;
            return (
              <li key={l.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-text-primary">
                      {role === 'buyer' ? l.buyer_item_name || l.item_name : l.vendor_item_name || l.item_name}
                      {l.option_label ? <span className="font-normal text-text-secondary"> · {l.option_label}</span> : null}
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
                      <span className="font-semibold">{fmt(l.confirmed_qty ?? asked)}</span>
                    )}
                    <span className="text-text-secondary">
                      {role === 'vendor' ? supplierUnit || 'units' : l.factor !== 1 ? l.vendor_unit || 'packs' : l.buyer_unit || 'units'}
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

                {matching && (
                  <p className="text-xs text-text-secondary">
                    Buyer asked for {fmt(l.buyer_qty)} {l.buyer_unit || 'units'}
                  </p>
                )}

                {matching && e.vendor_item_id && (
                  <label className="flex flex-wrap items-center gap-2 text-sm text-text-secondary">
                    1 {e.vendor_item_unit || 'unit'} of yours holds
                    <input
                      type="number"
                      min={0}
                      step="any"
                      className="w-20 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={e.factor ?? '1'}
                      onChange={(ev) => setEdit(l.id, { factor: ev.target.value, confirmed_qty: undefined })}
                    />
                    {l.buyer_unit || 'units'} of theirs
                    {Number(e.factor) > 1 && (
                      <span className="text-xs">
                        = {fmt(asked)} {e.vendor_item_unit || 'units'}
                      </span>
                    )}
                  </label>
                )}

                {vendorResponds && (
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    You can supply
                    <input
                      type="number"
                      min={0}
                      max={asked}
                      step="any"
                      className="w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                      value={e.confirmed_qty ?? String(asked)}
                      onChange={(ev) => setEdit(l.id, { confirmed_qty: ev.target.value })}
                    />
                    of {fmt(asked)}
                  </label>
                )}

                {vendorResponds && lineQty(l) < asked && (
                  <label className="flex items-center gap-2 text-sm text-text-secondary">
                    <input
                      type="checkbox"
                      checked={e.backorder !== false}
                      onChange={(ev) => setEdit(l.id, { backorder: ev.target.checked })}
                      className="h-4 w-4 rounded border-gray-300 text-primary-600 focus:ring-primary-500"
                    />
                    Send the other {fmt(asked - lineQty(l))} later as a backorder
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
                        setEdit(l.id, { vendor_item_id: item.id, vendor_item_name: item.name, vendor_item_unit: item.unit });
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
        {role === 'vendor' && (s === 'confirmed' || s === 'partial') && billWarnings.length > 0 && (
          <div className="w-full rounded-md bg-amber-50 p-3 text-sm text-amber-800">
            <p className="font-medium">Fix these first, or the bill cannot be finalised:</p>
            <ul className="mt-1 list-disc pl-5">
              {billWarnings.map((w) => (
                <li key={w.message}>
                  <Link href={w.href} className="underline">
                    {w.message}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
        {role === 'vendor' && (s === 'confirmed' || s === 'partial') && (
          <Link href={`/invoices/new?supply_order_id=${order.id}`}>
            <Button>Create bill</Button>
          </Link>
        )}
        {role === 'vendor' && s === 'invoiced' && (
          <div className="flex w-full flex-wrap items-center gap-2">
            <input
              id="dispatch-note"
              type="text"
              value={dispatchNote}
              onChange={(ev) => setDispatchNote(ev.target.value)}
              placeholder="Transporter, LR or vehicle number (optional)"
              className="min-w-0 flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
            />
            <Button onClick={() => act('dispatch', undefined, dispatchNote)} disabled={busy}>
              Mark dispatched
            </Button>
          </div>
        )}
        {role === 'buyer' && (s === 'invoiced' || s === 'dispatched') && order.invoice && (
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
        {s === 'awaiting_link' && (
          <p className="w-full text-sm text-text-secondary">
            {role === 'buyer'
              ? `Sent with your connection request. ${order.supplier_name} gets it as an order once they accept.`
              : `Sent with ${order.buyer_name}'s connection request. Accept the request to answer it.`}
          </p>
        )}
        {role === 'buyer' && s === 'pending' && (
          <p className="w-full text-sm text-text-secondary">Waiting for {order.supplier_name} to confirm quantities.</p>
        )}
        {role === 'vendor' && s === 'proposed' && (
          <p className="w-full text-sm text-text-secondary">Waiting for {order.buyer_name} to confirm.</p>
        )}
      </Card>

      <SupplyOrderComments orderId={order.id} otherName={role === 'buyer' ? order.supplier_name : order.buyer_name} />
    </div>
  );
}
