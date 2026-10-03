'use client';

export const dynamic = 'force-dynamic';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, Bell, Clock, CreditCard, Loader2, Package, Search, Send, ThumbsUp, Truck } from 'lucide-react';
import { ChannelBadge } from '@/components/orders/ChannelBadge';
import { DeliveryStatusBadge } from '@/components/orders/DeliveryStatusBadge';
import { OrderDrawer } from '@/components/orders/OrderDrawer';
import { OrderUpdateSettingsDialog } from '@/components/orders/OrderUpdateSettingsDialog';
import { FULFILMENT_STATUS_LABEL, FULFILMENT_STATUSES } from '@/lib/fulfilment/rules';

type NeedsKey = 'to_confirm' | 'payment_pending' | 'to_pack' | 'to_dispatch' | 'delivery_failed' | 'stale';

interface HubRow {
  source_type: string;
  source_id: string;
  channel: string;
  order_number: string;
  invoice_number: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  amount: number;
  payment_status: string | null;
  delivery_status: string | null;
  method: string | null;
  partner_name: string | null;
  awb: string | null;
  created_at: string;
}

const SOURCES: Array<{ key: string; label: string }> = [
  { key: '', label: 'All' },
  { key: 'online_store', label: 'Online store' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'counter', label: 'Counter' },
  { key: 'manual', label: 'Manual' },
  { key: 'sales_order', label: 'Sales orders' },
];

const NEEDS: Array<{ key: NeedsKey; label: string; icon: typeof Clock; tone: string }> = [
  { key: 'to_confirm', label: 'To confirm', icon: ThumbsUp, tone: 'text-blue-600' },
  { key: 'payment_pending', label: 'Payment pending', icon: CreditCard, tone: 'text-amber-600' },
  { key: 'to_pack', label: 'To pack', icon: Package, tone: 'text-indigo-600' },
  { key: 'to_dispatch', label: 'To dispatch', icon: Send, tone: 'text-violet-600' },
  { key: 'delivery_failed', label: 'Delivery failed', icon: AlertTriangle, tone: 'text-red-600' },
  { key: 'stale', label: 'Paid, not dispatched', icon: Clock, tone: 'text-orange-600' },
];

const PAGE_SIZE = 25;

function age(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.max(1, Math.floor(ms / 60000))}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

function OrdersHub() {
  const router = useRouter();
  const sp = useSearchParams();
  const [channel, setChannel] = useState(sp.get('channel') ?? '');
  const [deliveryStatus, setDeliveryStatus] = useState(sp.get('delivery_status') ?? '');
  const [needs, setNeeds] = useState<NeedsKey | ''>((sp.get('needs') as NeedsKey) ?? '');
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HubRow[]>([]);
  const [total, setTotal] = useState(0);
  const [counts, setCounts] = useState<Record<NeedsKey, number> | null>(null);
  const [sla, setSla] = useState(24);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ source: string; id: string } | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    if (channel) params.set('channel', channel);
    if (deliveryStatus) params.set('delivery_status', deliveryStatus);
    if (needs) params.set('needs', needs);
    if (query) params.set('q', query);
    try {
      const res = await fetch(`/api/orders?${params}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not load orders');
      setRows(json.orders ?? []);
      setTotal(json.total ?? 0);
      if (json.needs) setCounts(json.needs);
      if (json.sla_hours) setSla(json.sla_hours);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load orders');
    } finally {
      setLoading(false);
    }
  }, [channel, deliveryStatus, needs, query, page]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (channel) params.set('channel', channel);
    if (deliveryStatus) params.set('delivery_status', deliveryStatus);
    if (needs) params.set('needs', needs);
    router.replace(`/orders${params.toString() ? `?${params}` : ''}`, { scroll: false });
  }, [channel, deliveryStatus, needs, router]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const chip = (active: boolean) =>
    `whitespace-nowrap rounded-full px-3 py-1 text-xs font-medium transition ${
      active ? 'bg-primary text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
    }`;

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 md:p-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Orders &amp; delivery</h1>
          <p className="text-sm text-slate-500">Every sale from the store, WhatsApp, the counter and manual bills, with its payment and delivery status.</p>
        </div>
        <div className="flex w-full gap-2 md:w-auto">
          <form
            className="relative flex-1 md:w-80"
            onSubmit={(e) => {
              e.preventDefault();
              setPage(1);
              setQuery(q.trim());
            }}
          >
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              className="w-full rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-sm dark:border-slate-600 dark:bg-slate-800"
              placeholder="Order, bill, customer, phone, AWB"
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </form>
          <button
            type="button"
            onClick={() => setShowSettings(true)}
            className="flex items-center gap-1.5 whitespace-nowrap rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
          >
            <Bell className="h-4 w-4" /> Buyer updates
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {NEEDS.map(({ key, label, icon: Icon, tone }) => (
          <button
            key={key}
            type="button"
            onClick={() => {
              setPage(1);
              setNeeds(needs === key ? '' : key);
            }}
            className={`rounded-xl border p-3 text-left transition ${
              needs === key ? 'border-primary ring-1 ring-primary' : 'border-slate-200 hover:border-slate-300 dark:border-slate-700'
            } bg-white dark:bg-slate-900`}
            title={key === 'stale' ? `Paid more than ${sla} hours ago and not dispatched` : undefined}
          >
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Icon className={`h-4 w-4 ${tone}`} /> {label}
            </div>
            <div className="mt-1 text-2xl font-semibold">{counts ? counts[key] : '–'}</div>
          </button>
        ))}
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {SOURCES.map((s) => (
          <button key={s.key || 'all'} type="button" className={chip(channel === s.key)} onClick={() => { setPage(1); setChannel(s.key); }}>
            {s.label}
          </button>
        ))}
      </div>
      <div className="flex gap-2 overflow-x-auto pb-1">
        <button type="button" className={chip(deliveryStatus === '')} onClick={() => { setPage(1); setDeliveryStatus(''); }}>
          Any status
        </button>
        {FULFILMENT_STATUSES.map((s) => (
          <button key={s} type="button" className={chip(deliveryStatus === s)} onClick={() => { setPage(1); setDeliveryStatus(s); }}>
            {FULFILMENT_STATUS_LABEL[s]}
          </button>
        ))}
        <button type="button" className={chip(deliveryStatus === 'untracked')} onClick={() => { setPage(1); setDeliveryStatus('untracked'); }}>
          Not tracked
        </button>
      </div>

      {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900">
        {loading && rows.length === 0 ? (
          <div className="flex justify-center p-10">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-slate-500">No orders match these filters.</div>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="bg-slate-50 text-left text-xs uppercase text-slate-500 dark:bg-slate-800/60">
                <tr>
                  <th className="px-4 py-2">Order</th>
                  <th className="px-4 py-2">Customer</th>
                  <th className="px-4 py-2 text-right">Amount</th>
                  <th className="px-4 py-2">Payment</th>
                  <th className="px-4 py-2">Delivery</th>
                  <th className="px-4 py-2 text-right">Age</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => (
                  <tr
                    key={`${r.source_type}-${r.source_id}`}
                    className="cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50"
                    onClick={() => setOpen({ source: r.source_type, id: r.source_id })}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.order_number}</div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <ChannelBadge channel={r.channel} />
                        {r.invoice_number && r.invoice_number !== r.order_number ? (
                          <span className="text-xs text-slate-500">{r.invoice_number}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <div>{r.customer_name || '—'}</div>
                      <div className="text-xs text-slate-500">{r.customer_phone}</div>
                    </td>
                    <td className="px-4 py-2.5 text-right">{inr(r.amount)}</td>
                    <td className="px-4 py-2.5 capitalize">
                      <span className={r.payment_status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}>
                        {(r.payment_status ?? 'unpaid').replace(/_/g, ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      <DeliveryStatusBadge status={r.delivery_status} />
                      {r.partner_name || r.awb ? (
                        <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-500">
                          <Truck className="h-3 w-3" /> {[r.partner_name, r.awb].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-500">{age(r.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <ul className="divide-y divide-slate-100 md:hidden dark:divide-slate-800">
              {rows.map((r) => (
                <li key={`${r.source_type}-${r.source_id}`}>
                  <button type="button" className="w-full px-4 py-3 text-left" onClick={() => setOpen({ source: r.source_type, id: r.source_id })}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.order_number}</span>
                      <span className="font-medium">{inr(r.amount)}</span>
                    </div>
                    <div className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{r.customer_name || r.customer_phone || '—'}</div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <ChannelBadge channel={r.channel} />
                      <DeliveryStatusBadge status={r.delivery_status} />
                      <span className={`text-xs capitalize ${r.payment_status === 'paid' ? 'text-emerald-600' : 'text-amber-600'}`}>
                        {(r.payment_status ?? 'unpaid').replace(/_/g, ' ')}
                      </span>
                      <span className="ml-auto text-xs text-slate-500">{age(r.created_at)}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {pages > 1 ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-500">
            {total} orders · page {page} of {pages}
          </span>
          <div className="flex gap-2">
            <button type="button" className={chip(false)} disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
              Previous
            </button>
            <button type="button" className={chip(false)} disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
              Next
            </button>
          </div>
        </div>
      ) : null}

      {open ? (
        <OrderDrawer source={open.source} id={open.id} onClose={() => setOpen(null)} onChanged={() => void load()} />
      ) : null}
      {showSettings ? <OrderUpdateSettingsDialog onClose={() => setShowSettings(false)} onSaved={() => void load()} /> : null}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="flex justify-center p-10"><Loader2 className="h-6 w-6 animate-spin text-slate-400" /></div>}>
      <OrdersHub />
    </Suspense>
  );
}
