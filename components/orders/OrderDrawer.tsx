'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Copy, ExternalLink, Loader2, MapPin, MessageCircle, Package, Pencil, Printer, Tag, Truck, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ChannelBadge } from './ChannelBadge';
import { DeliveryStatusBadge } from './DeliveryStatusBadge';
import { OrderTimeline, type TimelineEvent } from './OrderTimeline';
import { COURIERS } from '@/lib/fulfilment/couriers';
import type { LabelSize } from '@/lib/fulfilment/shipping-label';
import {
  FULFILMENT_METHOD_LABEL,
  FULFILMENT_METHODS,
  FULFILMENT_TRANSITIONS,
  isFulfilmentStatus,
  type FulfilmentMethod,
  type FulfilmentStatus,
} from '@/lib/fulfilment/rules';

interface Fulfilment {
  id: string;
  seq: number;
  status: FulfilmentStatus;
  method: FulfilmentMethod | null;
  partner_name: string | null;
  awb: string | null;
  tracking_url: string | null;
  rider_name: string | null;
  rider_phone: string | null;
  pickup_code: string | null;
  proof_photo_url: string | null;
  cod_amount: number;
  cod_collected_at: string | null;
  failure_reason: string | null;
  public_url: string | null;
  ship_address: string | null;
  ship_pincode: string | null;
  packages: number;
  weight_kg: number | null;
  carrier_shipment_id: string | null;
  label_url: string | null;
  manifest_url: string | null;
  pickup_scheduled_at: string | null;
  booking_error: string | null;
  events: TimelineEvent[];
}

const NOT_YET_OUT: FulfilmentStatus[] = ['new', 'confirmed', 'packed'];

interface ShipFrom {
  name: string;
  address: string | null;
  pincode: string | null;
  phone: string | null;
  gstin: string | null;
}

interface OrderDetail {
  order: {
    source_type: 'store_order' | 'sales_order' | 'invoice';
    source_id: string;
    channel: string;
    order_number: string;
    invoice_id: string | null;
    invoice_number: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    amount: number;
    payment_status: string | null;
    order_status: string;
    whatsapp_conversation_id: string | null;
    delivery_status: string | null;
    created_at: string;
  };
  lines: Array<{ name: string; quantity: number; amount: number }>;
  fulfilments: Fulfilment[];
  ship_to: { address: string | null; pincode: string | null };
  ship_from: ShipFrom | null;
}

type Panel = null | 'dispatch' | 'deliver' | 'failed' | 'cancel' | 'out' | 'address';

const LABEL_SIZE_KEY = 'kh.orders.labelSize';

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const input =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';

export function OrderDrawer({
  source,
  id,
  onClose,
  onChanged,
}: {
  source: string;
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [data, setData] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [copied, setCopied] = useState(false);
  const [form, setForm] = useState({
    method: 'courier' as FulfilmentMethod,
    partner: '',
    awb: '',
    tracking: '',
    rider: '',
    riderPhone: '',
    cod: '',
    code: '',
    photo: '',
    reason: '',
    address: '',
    pincode: '',
    boxes: '1',
    weight: '',
  });
  const [labelSize, setLabelSize] = useState<LabelSize>('4x6');

  useEffect(() => {
    if (typeof window !== 'undefined' && window.localStorage.getItem(LABEL_SIZE_KEY) === 'a4') setLabelSize('a4');
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/orders/${source}/${id}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || 'Could not load the order');
      return;
    }
    setData(json);
    setActive((prev) => prev ?? json.fulfilments?.[0]?.id ?? null);
  }, [source, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const f = data?.fulfilments.find((x) => x.id === active) ?? data?.fulfilments[0] ?? null;
  const status: FulfilmentStatus | null = f?.status ?? (isFulfilmentStatus(data?.order.delivery_status) ? data!.order.delivery_status as FulfilmentStatus : null);
  const next = status ? FULFILMENT_TRANSITIONS[status] : [];
  const paid = data?.order.payment_status === 'paid';
  const shipAddress = f?.ship_address || data?.ship_to.address || null;
  const shipPincode = f?.ship_pincode || data?.ship_to.pincode || null;
  const boxes = f?.packages ?? 1;

  function openPanel(p: Panel) {
    if (panel === p) {
      setPanel(null);
      return;
    }
    if (p === 'dispatch' || p === 'address') {
      setForm((s) => ({
        ...s,
        address: shipAddress ?? '',
        pincode: shipPincode ?? '',
        boxes: String(boxes),
        weight: f?.weight_kg ? String(f.weight_kg) : '',
      }));
    }
    setPanel(p);
  }

  function shippingFromForm() {
    return {
      address: form.address,
      pincode: form.pincode,
      packages: Number(form.boxes) || 1,
      ...(form.weight ? { weight_kg: Number(form.weight) } : {}),
    };
  }

  async function act(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/orders/${source}/${id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fulfilment_id: f?.id, ...body }),
      });
      const json = await res.json().catch(() => ({}));
      if (json.order) setData(json);
      if (!res.ok) {
        setError(json.error || 'That did not work');
        if (json.order) onChanged();
        return null;
      }
      if (json.active_fulfilment_id) setActive(json.active_fulfilment_id);
      if (json.warning) setNotice(json.warning);
      setPanel(null);
      onChanged();
      return json;
    } finally {
      setBusy(false);
    }
  }

  function splitParcel() {
    const ok = window.confirm(
      'Send part of this order as a separate parcel?\n\n' +
        'Use this only when some items go out later or with a different courier. ' +
        'For several boxes going out together, set "Boxes" on the same parcel instead.',
    );
    if (ok) void act({ action: 'add_shipment' });
  }

  async function removeParcel() {
    if (!f || !window.confirm(`Remove parcel ${f.seq}? It has not been dispatched.`)) return;
    const json = await act({ action: 'remove_shipment' });
    if (json) setActive(null);
  }

  async function printShiprocketLabel() {
    if (!f) return;
    // Opened before the request so the browser does not block it as a pop-up.
    const win = f.label_url ? null : window.open('', '_blank');
    if (f.label_url) {
      window.open(f.label_url, '_blank', 'noopener');
      return;
    }
    const json = await act({ action: 'shiprocket_label' });
    const url = typeof json?.label_url === 'string' ? json.label_url : null;
    if (url && win) win.location.href = url;
    else win?.close();
  }

  function move(to: FulfilmentStatus, extra: Record<string, unknown> = {}) {
    return act({ action: 'transition', to, ...extra });
  }

  function dispatch() {
    const pickup = form.method === 'pickup';
    const details: Record<string, unknown> = { method: form.method };
    if (form.method === 'courier' || form.method === 'shiprocket') {
      details.partner_name = form.method === 'shiprocket' ? 'Shiprocket' : form.partner;
      details.awb = form.awb;
    }
    if (form.method === 'local_app') {
      details.partner_name = form.partner;
      details.tracking_url = form.tracking;
    }
    if (form.method === 'own_rider' || form.method === 'local_app') {
      details.rider_name = form.rider;
      details.rider_phone = form.riderPhone;
    }
    if (!paid && form.cod) details.cod_amount = Number(form.cod);
    return move(pickup ? 'ready_for_pickup' : 'shipped', { details, ...(pickup ? {} : { shipping: shippingFromForm() }) });
  }

  async function printLabel() {
    if (!data || !f) return;
    const { printShippingLabel } = await import('@/lib/fulfilment/shipping-label');
    await printShippingLabel(
      {
        orderNumber: data.order.order_number,
        invoiceNumber: data.order.invoice_number,
        orderDate: new Date(data.order.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }),
        to: { name: data.order.customer_name ?? '', phone: data.order.customer_phone, address: shipAddress, pincode: shipPincode },
        from: data.ship_from,
        carrier: f.partner_name || (f.method ? FULFILMENT_METHOD_LABEL[f.method] : null),
        awb: f.awb,
        paid,
        codAmount: f.cod_collected_at ? 0 : Number(f.cod_amount) || 0,
        itemCount: data.lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0),
        boxes,
      },
      labelSize,
    );
  }

  function changeLabelSize(size: LabelSize) {
    setLabelSize(size);
    window.localStorage.setItem(LABEL_SIZE_KEY, size);
  }

  async function copyLink() {
    if (!f?.public_url) return;
    await navigator.clipboard.writeText(f.public_url).catch(() => undefined);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function printSlip() {
    if (!data) return;
    const { printStorePackingSlip } = await import('@/lib/store/print-packing-slip');
    await printStorePackingSlip(
      {
        order_number: data.order.order_number,
        customer_name: data.order.customer_name ?? '',
        customer_phone: data.order.customer_phone ?? '',
        customer_address: shipAddress,
        customer_pincode: shipPincode,
        delivery_mode: f?.method === 'pickup' ? 'pickup' : 'delivery',
        grand_total: data.order.amount,
        payment_status: data.order.payment_status ?? undefined,
        awb: f?.awb,
      },
      data.lines.map((l) => ({ item_name: l.name, quantity: l.quantity, packed_qty: 0, unit: '' })),
    );
  }

  const o = data?.order;
  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
        aria-label="Order details"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold">{o?.order_number ?? 'Order'}</h2>
              {o ? <ChannelBadge channel={o.channel} /> : null}
              {o ? <DeliveryStatusBadge status={status} /> : null}
            </div>
            {o ? (
              <p className="mt-1 text-sm text-slate-500">
                {o.customer_name || 'Customer'} {o.customer_phone ? `· ${o.customer_phone}` : ''} · {inr(o.amount)} ·{' '}
                <span className={paid ? 'text-emerald-600' : 'text-amber-600'}>{(o.payment_status ?? 'unpaid').replace(/_/g, ' ')}</span>
              </p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </header>

        {!data && !error ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : null}

        {error ? <div className="mx-5 mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/30 dark:text-red-300">{error}</div> : null}
        {notice ? <div className="mx-5 mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/30 dark:text-amber-200">{notice}</div> : null}

        {data && o ? (
          <div className="space-y-5 px-5 py-4">
            <div className="flex flex-wrap gap-2 text-sm">
              {o.invoice_id ? (
                <Link href={`/invoices/${o.invoice_id}`} className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Bill {o.invoice_number}
                </Link>
              ) : null}
              {o.whatsapp_conversation_id && o.customer_phone ? (
                <Link
                  href={`/whatsapp/conversations?phone=${encodeURIComponent(o.customer_phone)}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <MessageCircle className="h-3.5 w-3.5" /> WhatsApp chat
                </Link>
              ) : null}
              {o.source_type === 'store_order' ? (
                <Link href="/settings/online-store/orders" className="inline-flex items-center gap-1 text-primary hover:underline">
                  <ExternalLink className="h-3.5 w-3.5" /> Store orders
                </Link>
              ) : null}
              <button type="button" onClick={() => void printSlip()} className="inline-flex items-center gap-1 text-primary hover:underline">
                <Printer className="h-3.5 w-3.5" /> Packing slip
              </button>
            </div>

            {data.lines.length > 0 ? (
              <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm dark:divide-slate-800 dark:border-slate-700">
                {data.lines.map((l, i) => (
                  <li key={i} className="flex justify-between gap-3 px-3 py-2">
                    <span>
                      {l.name} <span className="text-slate-500">× {l.quantity}</span>
                    </span>
                    <span>{inr(l.amount)}</span>
                  </li>
                ))}
              </ul>
            ) : null}

            {data.fulfilments.length > 1 ? (
              <div>
                <p className="mb-1.5 text-xs text-slate-500">This order goes out in {data.fulfilments.length} parcels. Pick one to manage it.</p>
                <div className="flex flex-wrap gap-2">
                  {data.fulfilments.map((x) => (
                    <button
                      key={x.id}
                      type="button"
                      onClick={() => setActive(x.id)}
                      className={`rounded-full px-3 py-1 text-xs ${
                        x.id === f?.id
                          ? 'bg-primary-600 text-white'
                          : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
                      }`}
                    >
                      Parcel {x.seq} · {x.status.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            {!f ? (
              <div className="rounded-lg border border-dashed border-slate-300 p-4 text-sm dark:border-slate-600">
                <p className="text-slate-600 dark:text-slate-300">
                  {status === 'delivered' ? 'Handed over at the counter.' : 'Delivery is not tracked for this sale yet.'}
                </p>
                {status !== 'delivered' && status !== 'cancelled' ? (
                  <Button size="sm" className="mt-3" isLoading={busy} onClick={() => void act({ action: 'start' })}>
                    <Truck className="mr-1 h-4 w-4" /> Start delivery tracking
                  </Button>
                ) : null}
              </div>
            ) : (
              <>
                {f.method !== 'pickup' ? (
                  <div className="rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        <div>
                          <div className="text-xs font-medium uppercase text-slate-500">Deliver to</div>
                          {shipAddress ? (
                            <div className="whitespace-pre-line">
                              {shipAddress}
                              {shipPincode ? <span className="font-semibold"> · PIN {shipPincode}</span> : null}
                            </div>
                          ) : (
                            <div className="text-amber-600">No address yet. Add one before dispatch.</div>
                          )}
                          {boxes > 1 ? <div className="text-xs text-slate-500">{boxes} boxes</div> : null}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => openPanel('address')}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <Pencil className="h-3 w-3" /> {shipAddress ? 'Edit' : 'Add'}
                      </button>
                    </div>
                    {f.method === 'shiprocket' && f.carrier_shipment_id && f.awb ? (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" isLoading={busy} onClick={() => void printShiprocketLabel()}>
                          <Tag className="mr-1 h-4 w-4" /> Print Shiprocket label
                        </Button>
                        <span className="text-xs text-slate-500">Stick this on the parcel; the courier scans its barcode.</span>
                      </div>
                    ) : (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Button size="sm" variant="secondary" disabled={!shipAddress} onClick={() => void printLabel()}>
                          <Tag className="mr-1 h-4 w-4" /> Print shipping label
                        </Button>
                        <select
                          aria-label="Label size"
                          className="rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-xs dark:border-slate-600 dark:bg-slate-800"
                          value={labelSize}
                          onChange={(e) => changeLabelSize(e.target.value as LabelSize)}
                        >
                          <option value="4x6">4×6 in thermal</option>
                          <option value="a4">A4 (2 per page)</option>
                        </select>
                      </div>
                    )}
                  </div>
                ) : null}

                {f.booking_error && !f.awb ? (
                  <div className="space-y-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-900/20 dark:text-red-200">
                    <div>
                      <span className="font-medium">Shiprocket could not book this parcel:</span> {f.booking_error}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {f.status === 'shipped' ? (
                        <Button size="sm" variant="secondary" isLoading={busy} onClick={() => void act({ action: 'book_courier' })}>
                          Try booking again
                        </Button>
                      ) : (
                        <span className="text-xs">Fix the problem, then use Dispatch → Shiprocket again.</span>
                      )}
                      {f.carrier_shipment_id && o.source_type !== 'store_order' ? (
                        <Button size="sm" variant="ghost" isLoading={busy} onClick={() => void act({ action: 'cancel_booking' })}>
                          Start over
                        </Button>
                      ) : null}
                    </div>
                  </div>
                ) : null}

                {panel === 'address' ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <textarea className={input} rows={3} placeholder="House / shop, street, area, city, state" value={form.address} onChange={set('address')} />
                    <div className="grid grid-cols-3 gap-2">
                      <input className={input} placeholder="PIN code" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set('pincode')} />
                      <input className={input} placeholder="Boxes" type="number" min={1} max={50} value={form.boxes} onChange={set('boxes')} />
                      <input className={input} placeholder="Weight kg" inputMode="decimal" value={form.weight} onChange={set('weight')} />
                    </div>
                    <p className="text-xs text-slate-500">Saved on this parcel only; the customer record is not changed.</p>
                    <Button size="sm" isLoading={busy} onClick={() => void act({ action: 'set_shipping', shipping: shippingFromForm() })}>
                      Save address
                    </Button>
                  </div>
                ) : null}

                <div className="space-y-1 rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                  {f.method ? <div>Method: {FULFILMENT_METHOD_LABEL[f.method]}{f.partner_name ? ` · ${f.partner_name}` : ''}</div> : null}
                  {f.awb ? <div>Tracking no: <span className="font-mono">{f.awb}</span></div> : null}
                  {f.method === 'shiprocket' && f.pickup_scheduled_at && f.status === 'shipped' ? (
                    <div>
                      Pickup booked for{' '}
                      {new Date(f.pickup_scheduled_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
                    </div>
                  ) : null}
                  {f.weight_kg ? <div>Weight: {f.weight_kg} kg</div> : null}
                  {f.tracking_url ? (
                    <a href={f.tracking_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                      Courier tracking <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : null}
                  {f.rider_name || f.rider_phone ? <div>Rider: {[f.rider_name, f.rider_phone].filter(Boolean).join(' · ')}</div> : null}
                  {f.pickup_code ? <div>Pickup code: <span className="font-mono font-semibold">{f.pickup_code}</span></div> : null}
                  {f.cod_amount > 0 ? (
                    <div>
                      Cash on delivery {inr(f.cod_amount)} —{' '}
                      {f.cod_collected_at ? <span className="text-emerald-600">collected</span> : <span className="text-amber-600">to collect</span>}
                    </div>
                  ) : null}
                  {f.failure_reason && f.status === 'delivery_failed' ? <div className="text-red-600">Failed: {f.failure_reason}</div> : null}
                  {f.public_url ? (
                    <button type="button" onClick={() => void copyLink()} className="inline-flex items-center gap-1 text-primary hover:underline">
                      <Copy className="h-3.5 w-3.5" /> {copied ? 'Copied' : 'Copy buyer tracking link'}
                    </button>
                  ) : null}
                </div>

                <div className="flex flex-wrap gap-2">
                  {next.includes('confirmed') ? (
                    <Button size="sm" isLoading={busy} onClick={() => void move('confirmed')}>Confirm</Button>
                  ) : null}
                  {next.includes('packed') ? (
                    <Button size="sm" variant="secondary" isLoading={busy} onClick={() => void move('packed')}>
                      <Package className="mr-1 h-4 w-4" /> Mark packed
                    </Button>
                  ) : null}
                  {next.includes('shipped') || next.includes('ready_for_pickup') ? (
                    <Button size="sm" variant="secondary" onClick={() => openPanel('dispatch')}>
                      <Truck className="mr-1 h-4 w-4" /> Dispatch
                    </Button>
                  ) : null}
                  {next.includes('out_for_delivery') && status !== 'new' && status !== 'confirmed' && status !== 'packed' ? (
                    <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'out' ? null : 'out')}>Out for delivery</Button>
                  ) : null}
                  {next.includes('delivered') && status !== 'new' && status !== 'confirmed' && status !== 'packed' ? (
                    <Button size="sm" variant="secondary" onClick={() => setPanel(panel === 'deliver' ? null : 'deliver')}>Mark delivered</Button>
                  ) : null}
                  {next.includes('delivery_failed') ? (
                    <Button size="sm" variant="ghost" onClick={() => setPanel(panel === 'failed' ? null : 'failed')}>Delivery failed</Button>
                  ) : null}
                  {next.includes('returned') ? (
                    <Button size="sm" variant="ghost" isLoading={busy} onClick={() => void move('returned')}>Returned</Button>
                  ) : null}
                  {f.cod_amount > 0 && !f.cod_collected_at ? (
                    <Button size="sm" variant="secondary" isLoading={busy} onClick={() => void act({ action: 'cod_collected' })}>Cash collected</Button>
                  ) : null}
                  {next.includes('cancelled') ? (
                    <Button size="sm" variant="ghost" onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}>Cancel</Button>
                  ) : null}
                  {f.method === 'shiprocket' && f.carrier_shipment_id && f.status === 'shipped' && o.source_type !== 'store_order' ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      isLoading={busy}
                      onClick={() => {
                        if (window.confirm('Cancel the Shiprocket booking? The parcel goes back to packed so you can book it again.')) {
                          void act({ action: 'cancel_booking' });
                        }
                      }}
                    >
                      Cancel booking
                    </Button>
                  ) : null}
                  {f.seq > 1 && NOT_YET_OUT.includes(f.status) && !f.awb && !f.carrier_shipment_id ? (
                    <Button size="sm" variant="ghost" isLoading={busy} onClick={() => void removeParcel()}>Remove parcel</Button>
                  ) : null}
                  {status !== 'cancelled' && status !== 'returned' && !data.fulfilments.some((x) => NOT_YET_OUT.includes(x.status)) ? (
                    <Button size="sm" variant="ghost" isLoading={busy} onClick={splitParcel}>Send rest as another parcel</Button>
                  ) : null}
                </div>

                {panel === 'dispatch' ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <label className="block text-xs font-medium text-slate-600">How is it going out?</label>
                    <select className={input} value={form.method} onChange={set('method')}>
                      {FULFILMENT_METHODS.map((m) => (
                        <option key={m} value={m}>{FULFILMENT_METHOD_LABEL[m]}</option>
                      ))}
                    </select>
                    {form.method === 'courier' ? (
                      <>
                        <input className={input} list="courier-list" placeholder="Courier (Delhivery, DTDC…)" value={form.partner} onChange={set('partner')} />
                        <datalist id="courier-list">
                          {COURIERS.filter((c) => c.key !== 'shiprocket').map((c) => <option key={c.key} value={c.name} />)}
                        </datalist>
                        <input className={input} placeholder="Tracking number (AWB)" value={form.awb} onChange={set('awb')} />
                      </>
                    ) : null}
                    {form.method === 'shiprocket' ? (
                      <>
                        <p className="text-xs text-slate-500">
                          Khatario books the courier, gets the AWB and asks for pickup. Then print the Shiprocket label.
                        </p>
                        <input className={input} placeholder="Weight in kg (e.g. 0.5)" inputMode="decimal" value={form.weight} onChange={set('weight')} />
                        <input className={input} placeholder="Already booked on Shiprocket? Paste the AWB" value={form.awb} onChange={set('awb')} />
                      </>
                    ) : null}
                    {form.method === 'local_app' ? (
                      <>
                        <input className={input} placeholder="Porter, Rapido, Dunzo…" value={form.partner} onChange={set('partner')} />
                        <input className={input} placeholder="Live tracking link (paste)" value={form.tracking} onChange={set('tracking')} />
                      </>
                    ) : null}
                    {form.method === 'own_rider' || form.method === 'local_app' ? (
                      <div className="grid grid-cols-2 gap-2">
                        <input className={input} placeholder="Rider name" value={form.rider} onChange={set('rider')} />
                        <input className={input} placeholder="Rider phone" inputMode="tel" value={form.riderPhone} onChange={set('riderPhone')} />
                      </div>
                    ) : null}
                    {form.method === 'pickup' ? (
                      <p className="text-xs text-slate-500">The buyer gets a 4-digit pickup code. Ask for it at the counter.</p>
                    ) : null}
                    {!paid && form.method !== 'pickup' ? (
                      <input className={input} placeholder={`Cash to collect on delivery (e.g. ${o.amount})`} inputMode="decimal" value={form.cod} onChange={set('cod')} />
                    ) : null}
                    {form.method !== 'pickup' ? (
                      <>
                        <label className="block text-xs font-medium text-slate-600">Deliver to</label>
                        <textarea className={input} rows={2} placeholder="Delivery address" value={form.address} onChange={set('address')} />
                        <div className="grid grid-cols-2 gap-2">
                          <input className={input} placeholder="PIN code" inputMode="numeric" maxLength={6} value={form.pincode} onChange={set('pincode')} />
                          <input className={input} placeholder="Boxes" type="number" min={1} max={50} value={form.boxes} onChange={set('boxes')} />
                        </div>
                      </>
                    ) : null}
                    <Button size="sm" isLoading={busy} onClick={() => void dispatch()}>
                      {form.method === 'pickup'
                        ? 'Ready for pickup'
                        : form.method === 'shiprocket' && !form.awb.trim()
                          ? 'Book courier & mark shipped'
                          : 'Mark shipped'}
                    </Button>
                  </div>
                ) : null}

                {panel === 'out' ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <div className="grid grid-cols-2 gap-2">
                      <input className={input} placeholder="Rider name" value={form.rider} onChange={set('rider')} />
                      <input className={input} placeholder="Rider phone" inputMode="tel" value={form.riderPhone} onChange={set('riderPhone')} />
                    </div>
                    <Button
                      size="sm"
                      isLoading={busy}
                      onClick={() =>
                        void move('out_for_delivery', {
                          details: form.rider || form.riderPhone ? { rider_name: form.rider, rider_phone: form.riderPhone } : {},
                        })
                      }
                    >
                      Out for delivery
                    </Button>
                  </div>
                ) : null}

                {panel === 'deliver' ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    {f.method === 'pickup' && f.pickup_code ? (
                      <input className={input} placeholder="Pickup code from the buyer" inputMode="numeric" value={form.code} onChange={set('code')} />
                    ) : null}
                    <input className={input} placeholder="Proof photo link (optional)" value={form.photo} onChange={set('photo')} />
                    <Button
                      size="sm"
                      isLoading={busy}
                      onClick={() =>
                        void move('delivered', { pickup_code: form.code, details: form.photo ? { proof_photo_url: form.photo } : {} })
                      }
                    >
                      Confirm delivered
                    </Button>
                  </div>
                ) : null}

                {panel === 'failed' ? (
                  <div className="space-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    <input className={input} placeholder="Reason and next attempt (e.g. door locked, retry tomorrow)" value={form.reason} onChange={set('reason')} />
                    <Button size="sm" isLoading={busy} onClick={() => void move('delivery_failed', { details: { failure_reason: form.reason } })}>
                      Record failed delivery
                    </Button>
                  </div>
                ) : null}

                {panel === 'cancel' ? (
                  <div className="space-y-2 rounded-lg border border-red-200 p-3 dark:border-red-900">
                    <input className={input} placeholder="Reason" value={form.reason} onChange={set('reason')} />
                    {paid && o.invoice_id ? (
                      <p className="text-xs text-slate-500">
                        Paid order: refund the buyer and issue a credit note from the{' '}
                        <Link href={`/invoices/${o.invoice_id}`} className="text-primary hover:underline">bill</Link>.
                      </p>
                    ) : null}
                    <Button size="sm" variant="destructive" isLoading={busy} onClick={() => void move('cancelled', { note: form.reason })}>
                      Cancel order
                    </Button>
                  </div>
                ) : null}

                <section>
                  <h3 className="mb-2 text-sm font-semibold">Timeline</h3>
                  <OrderTimeline events={f.events} current={f.status} pickup={f.method === 'pickup'} />
                </section>
              </>
            )}
          </div>
        ) : null}
      </aside>
    </div>
  );
}
