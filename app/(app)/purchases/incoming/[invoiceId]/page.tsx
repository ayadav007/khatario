'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Chip } from '@/components/ui/Chip';
import { useToastContext } from '@/contexts/ToastContext';
import { ItemMatchRow, type ItemMatchSuggestion, type ItemMatchValue } from '@/components/suppliers/ItemMatchRow';

type Line = {
  invoice_item_id: string;
  item_name: string;
  quantity: number;
  unit: string | null;
  unit_price: number;
  tax_rate: number;
  line_total: number;
  is_service: boolean;
  match: { item_id: string; item_name: string | null; unit: string | null; factor: number; quantity: number } | null;
  suggestions: ItemMatchSuggestion[];
};

type Detail = {
  /** The supplier's UPI ID and a upi:// link with amount and bill number filled in */
  pay?: { upi_id: string; link: string } | null;
  bill: {
    invoice_id: string;
    invoice_number: string;
    invoice_date: string;
    supplier_name: string;
    supplier_id: string;
    tax_total: string | number;
    grand_total: string | number;
  };
  lines: Line[];
  purchase: { id: string; bill_number: string; receipt_status: string | null } | null;
  receipt_lines: Array<{ buyer_item_id: string | null; item_name: string; billed_qty: string; short_qty: string; damaged_qty: string; note: string | null }>;
  purchase_returns: Array<{ id: string; return_number: string }>;
  /** Business setting: 'auto_return' raises the debit note for short + damaged on receipt */
  shortfall_mode?: 'keep' | 'auto_return';
};

type Received = { short: string; damaged: string; note: string };

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

/**
 * Receive a connected supplier's bill: match each line to your item (or create the item),
 * record what was short or damaged, and turn the bill into your purchase.
 */
export default function ReceiveBillPage({ params }: { params: { invoiceId: string } }) {
  const toast = useToastContext();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [choices, setChoices] = useState<Record<string, ItemMatchValue | null>>({});
  const [changing, setChanging] = useState<Record<string, boolean>>({});
  const [received, setReceived] = useState<Record<string, Received>>({});
  const [creating, setCreating] = useState<Record<string, { name: string; selling: string; factor: string } | undefined>>({});
  const [notes, setNotes] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/purchases/incoming-bills/${params.invoiceId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load the bill');
      setDetail(data);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to load the bill');
    } finally {
      setLoading(false);
    }
  }, [params.invoiceId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /** The item and factor each line will use: a new choice, else the existing match. */
  const effective = (l: Line) => {
    const c = choices[l.invoice_item_id];
    if (c) return { itemId: c.itemId, name: c.itemName, unit: c.unit, factor: Number(c.factor) || 0 };
    if (l.match) return { itemId: l.match.item_id, name: l.match.item_name, unit: l.match.unit, factor: l.match.factor };
    return null;
  };

  const goodsLines = useMemo(() => (detail?.lines || []).filter((l) => !l.is_service), [detail]);
  const missing = goodsLines.filter((l) => {
    const e = effective(l);
    return !e || !(e.factor > 0);
  });

  const createItem = async (l: Line) => {
    const form = creating[l.invoice_item_id];
    if (!form) return;
    try {
      const res = await fetch(`/api/purchases/incoming-bills/${params.invoiceId}/create-item`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_item_id: l.invoice_item_id,
          name: form.name,
          factor: Number(form.factor) || 1,
          selling_price: form.selling === '' ? null : Number(form.selling),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to create the item');
      setChoices((prev) => ({
        ...prev,
        [l.invoice_item_id]: { itemId: data.item.id, itemName: data.item.name, unit: data.item.unit, factor: String(data.factor) },
      }));
      setCreating((prev) => ({ ...prev, [l.invoice_item_id]: undefined }));
      toast.success(`Created ${data.item.name}`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to create the item');
    }
  };

  const receive = async () => {
    if (!detail) return;
    const itemMap: Record<string, { item_id: string; factor: number }> = {};
    for (const l of detail.lines) {
      const c = choices[l.invoice_item_id];
      if (c) itemMap[l.invoice_item_id] = { item_id: c.itemId, factor: Number(c.factor) };
    }
    const receivedBody: Record<string, { short_qty: number; damaged_qty: number; note: string }> = {};
    for (const [id, r] of Object.entries(received)) {
      const short = Number(r.short) || 0;
      const damaged = Number(r.damaged) || 0;
      if (short > 0 || damaged > 0 || r.note) receivedBody[id] = { short_qty: short, damaged_qty: damaged, note: r.note };
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/invoices/${params.invoiceId}/convert-to-purchase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ item_map: itemMap, received: receivedBody, receipt_notes: notes }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to receive the bill');
      toast.success(
        data.purchase_return
          ? `Purchase ${data.purchase?.bill_number || ''} created, debit note ${data.purchase_return.return_number} raised`
          : `Purchase ${data.purchase?.bill_number || ''} created`
      );
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Failed to receive the bill');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }
  if (!detail) return <div className="p-6 text-center">Bill not found</div>;

  const { bill, purchase } = detail;
  const shortfalls = detail.receipt_lines.filter((r) => Number(r.short_qty) + Number(r.damaged_qty) > 0);
  const debitNoteHref =
    purchase && shortfalls.length
      ? `/purchase-returns/new?${new URLSearchParams({
          purchase_id: purchase.id,
          supplier_id: bill.supplier_id,
          return_qty: shortfalls
            .filter((r) => r.buyer_item_id)
            .map((r) => `${r.buyer_item_id}:${Number(r.short_qty) + Number(r.damaged_qty)}`)
            .join(','),
          reason: `Short/damaged on delivery of bill ${bill.invoice_number}`,
        }).toString()}`
      : null;

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Bill ${bill.invoice_number} from ${bill.supplier_name}`}
        subtitle={`${new Date(bill.invoice_date).toLocaleDateString('en-IN')} · ₹${Number(bill.grand_total).toLocaleString('en-IN')} incl. ₹${Number(bill.tax_total).toLocaleString('en-IN')} tax`}
        actions={
          <Link href="/purchases/incoming">
            <Button variant="secondary">All incoming bills</Button>
          </Link>
        }
      />

      {purchase ? (
        <Card padding="md" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Chip variant={purchase.receipt_status === 'received_with_issues' ? 'warning' : 'success'}>
              {purchase.receipt_status === 'received_with_issues' ? 'Received with issues' : 'Received'}
            </Chip>
            <Link href={`/purchases/${purchase.id}`} className="text-sm font-medium text-primary-600 hover:underline">
              Open purchase {purchase.bill_number}
            </Link>
          </div>
          {detail?.pay && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg bg-slate-50 p-3 text-sm">
              <a href={detail.pay.link} className="inline-flex min-h-10 items-center rounded-md bg-primary-600 px-4 font-semibold text-white">
                Pay ₹{Number(bill.grand_total).toLocaleString('en-IN')} by UPI
              </a>
              <span className="text-text-secondary">
                UPI ID <span className="select-all font-medium text-text-primary">{detail.pay.upi_id}</span>. After paying, record
                it on the purchase; {bill.supplier_name} is told so their books match.
              </span>
            </div>
          )}
          {shortfalls.length > 0 && (
            <div>
              <p className="text-sm font-medium text-text-primary">Short or damaged</p>
              <ul className="mt-1 text-sm text-text-secondary">
                {shortfalls.map((r, i) => (
                  <li key={i}>
                    {r.item_name}: {Number(r.short_qty) ? `${fmt(Number(r.short_qty))} short` : ''}
                    {Number(r.short_qty) && Number(r.damaged_qty) ? ', ' : ''}
                    {Number(r.damaged_qty) ? `${fmt(Number(r.damaged_qty))} damaged` : ''}
                    {r.note ? ` (${r.note})` : ''}
                  </li>
                ))}
              </ul>
              {detail.purchase_returns.length > 0 ? (
                <p className="mt-2 text-sm text-text-secondary">
                  Debit note recorded: {detail.purchase_returns.map((r) => r.return_number).join(', ')}
                </p>
              ) : (
                debitNoteHref && (
                  <Link href={debitNoteHref}>
                    <Button size="sm" className="mt-2">
                      Record debit note for these
                    </Button>
                  </Link>
                )
              )}
            </div>
          )}
        </Card>
      ) : (
        <>
          <Card padding="md">
            <ul className="divide-y divide-gray-100">
              {detail.lines.map((l) => {
                const e = effective(l);
                const ownQty = e && e.factor > 0 ? l.quantity * e.factor : null;
                const r = received[l.invoice_item_id] || { short: '', damaged: '', note: '' };
                const setR = (patch: Partial<Received>) =>
                  setReceived((prev) => ({ ...prev, [l.invoice_item_id]: { ...r, ...patch } }));
                const form = creating[l.invoice_item_id];
                const showPicker = !l.is_service && (!l.match || changing[l.invoice_item_id]);
                return (
                  <li key={l.invoice_item_id} className="space-y-2 py-4">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <div>
                        <p className="font-medium text-text-primary">{l.item_name}</p>
                        <p className="text-xs text-text-secondary">
                          {fmt(l.quantity)} {l.unit || ''} × ₹{l.unit_price.toLocaleString('en-IN')}
                          {l.tax_rate ? ` · GST ${l.tax_rate}%` : ''}
                        </p>
                      </div>
                      <span className="text-sm font-semibold">₹{l.line_total.toLocaleString('en-IN')}</span>
                    </div>

                    {l.is_service ? (
                      <p className="text-xs text-text-secondary">Service, no stock.</p>
                    ) : (
                      <>
                        {e && !showPicker && (
                          <p className="text-sm text-text-primary">
                            Adds {fmt(ownQty || 0)} {e.unit || ''} of <span className="font-medium">{e.name}</span>{' '}
                            <button
                              type="button"
                              className="text-xs text-primary-600 underline"
                              onClick={() => setChanging((prev) => ({ ...prev, [l.invoice_item_id]: true }))}
                            >
                              Change
                            </button>
                          </p>
                        )}
                        {showPicker && (
                          <>
                            <ItemMatchRow
                              vendorName="Your item for this line"
                              vendorUnit={l.unit}
                              suggestions={l.suggestions}
                              value={choices[l.invoice_item_id] ?? null}
                              onChange={(v) => setChoices((prev) => ({ ...prev, [l.invoice_item_id]: v }))}
                            />
                            {!form ? (
                              <button
                                type="button"
                                className="text-sm font-medium text-primary-600 hover:underline"
                                onClick={() =>
                                  setCreating((prev) => ({
                                    ...prev,
                                    [l.invoice_item_id]: { name: l.item_name, selling: '', factor: '1' },
                                  }))
                                }
                              >
                                New to you? Create it as a new item
                              </button>
                            ) : (
                              <div className="space-y-2 rounded-md border border-gray-200 p-3">
                                <p className="text-sm font-medium">New item from this line</p>
                                <label className="block text-xs text-text-secondary">
                                  Name
                                  <input
                                    className="mt-1 w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                                    value={form.name}
                                    onChange={(ev) =>
                                      setCreating((prev) => ({ ...prev, [l.invoice_item_id]: { ...form, name: ev.target.value } }))
                                    }
                                  />
                                </label>
                                <div className="flex flex-wrap gap-3">
                                  <label className="text-xs text-text-secondary">
                                    Your units in 1 {l.unit || 'supplier unit'}
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      className="mt-1 block w-28 rounded-md border border-gray-300 px-2 py-1 text-sm"
                                      value={form.factor}
                                      onChange={(ev) =>
                                        setCreating((prev) => ({ ...prev, [l.invoice_item_id]: { ...form, factor: ev.target.value } }))
                                      }
                                    />
                                  </label>
                                  <label className="text-xs text-text-secondary">
                                    Your selling price (optional)
                                    <input
                                      type="number"
                                      min={0}
                                      step="any"
                                      className="mt-1 block w-32 rounded-md border border-gray-300 px-2 py-1 text-sm"
                                      value={form.selling}
                                      onChange={(ev) =>
                                        setCreating((prev) => ({ ...prev, [l.invoice_item_id]: { ...form, selling: ev.target.value } }))
                                      }
                                    />
                                  </label>
                                </div>
                                <p className="text-xs text-text-secondary">
                                  Cost: ₹{fmt(l.unit_price / (Number(form.factor) || 1))} each. Name, HSN and GST rate come from the bill.
                                </p>
                                <div className="flex gap-2">
                                  <Button size="sm" onClick={() => createItem(l)} disabled={!form.name.trim() || !(Number(form.factor) > 0)}>
                                    Create item
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setCreating((prev) => ({ ...prev, [l.invoice_item_id]: undefined }))}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            )}
                          </>
                        )}

                        {e && e.factor > 0 && (
                          <div className="flex flex-wrap items-end gap-3">
                            <label className="text-xs text-text-secondary">
                              Short ({e.unit || 'units'})
                              <input
                                type="number"
                                min={0}
                                max={ownQty || undefined}
                                step="any"
                                className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                                value={r.short}
                                placeholder="0"
                                onChange={(ev) => setR({ short: ev.target.value })}
                              />
                            </label>
                            <label className="text-xs text-text-secondary">
                              Damaged ({e.unit || 'units'})
                              <input
                                type="number"
                                min={0}
                                max={ownQty || undefined}
                                step="any"
                                className="mt-1 block w-24 rounded-md border border-gray-300 px-2 py-1 text-sm"
                                value={r.damaged}
                                placeholder="0"
                                onChange={(ev) => setR({ damaged: ev.target.value })}
                              />
                            </label>
                            {(Number(r.short) > 0 || Number(r.damaged) > 0) && (
                              <label className="min-w-[12rem] flex-1 text-xs text-text-secondary">
                                Note
                                <input
                                  className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                                  value={r.note}
                                  onChange={(ev) => setR({ note: ev.target.value })}
                                />
                              </label>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card padding="md" className="space-y-3">
            <label className="block text-sm text-text-secondary">
              Note for this delivery (optional)
              <input
                className="mt-1 block w-full rounded-md border border-gray-300 px-2 py-1 text-sm"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <p className="text-xs text-text-secondary">
              The purchase is recorded exactly as billed, so GST and the amount owed match the supplier&apos;s bill.{' '}
              {detail.shortfall_mode === 'auto_return'
                ? 'Short or damaged quantities go back to the supplier at once: a debit note is raised for them, taking them out of stock and off what you owe.'
                : 'Everything billed goes into stock. Short or damaged quantities are sent to the supplier, and you can record a debit note for them next.'}{' '}
              <Link href="/settings/suppliers-directory#receipt-shortfall" className="link-primary">
                Change
              </Link>
            </p>
            {missing.length > 0 && (
              <p className="text-sm text-amber-700">Match or create an item for: {missing.map((l) => l.item_name).join(', ')}</p>
            )}
            <Button onClick={receive} disabled={saving || missing.length > 0}>
              {saving ? 'Receiving…' : 'Receive and create purchase'}
            </Button>
          </Card>
        </>
      )}
    </div>
  );
}
