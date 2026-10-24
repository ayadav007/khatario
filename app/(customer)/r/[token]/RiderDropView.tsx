'use client';

import { useCallback, useEffect, useState } from 'react';
import { Banknote, CheckCircle2, Loader2, MapPin, Navigation, Package, Phone, Truck, XCircle } from 'lucide-react';

type Drop = {
  shop: { name: string; phone: string | null };
  orderNumber: string;
  seq: number;
  status: string;
  buyerName: string | null;
  buyerPhone: string | null;
  address: string | null;
  pincode: string | null;
  packages: number;
  codDue: number;
  codCollected: boolean;
  items: Array<{ line_id: string; name: string; quantity: number }>;
  canUpdate: boolean;
};

const STATUS: Record<string, string> = {
  shipped: 'Picked up from the shop',
  out_for_delivery: 'Out for delivery',
  delivery_failed: 'Could not deliver',
  delivered: 'Delivered',
  returned: 'Returned to the shop',
  cancelled: 'Cancelled',
};

const REASONS = ['Customer not reachable', 'Customer not at home', 'Wrong address', 'Customer refused', 'Asked to come later'];

/** The rider's one page: where to go, what to collect, and big buttons to update the shop. */
export function RiderDropView({ token }: { token: string }) {
  const [drop, setDrop] = useState<Drop | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failing, setFailing] = useState(false);
  const [reason, setReason] = useState('');
  const [cash, setCash] = useState(false);

  const load = useCallback(async () => {
    const res = await fetch(`/api/public/rider/${encodeURIComponent(token)}`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(res.status === 404 ? 'This delivery link is not valid.' : json.error || 'Could not load the delivery');
      return;
    }
    setDrop(json);
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(action);
    setError(null);
    try {
      const res = await fetch(`/api/public/rider/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'That did not work');
      setDrop(json);
      setFailing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(null);
    }
  }

  if (!drop) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-center text-sm text-slate-600">
        {error ?? <Loader2 className="h-6 w-6 animate-spin text-slate-400" />}
      </main>
    );
  }

  const tel = drop.buyerPhone?.replace(/[^\d+]/g, '');
  const mapQuery = encodeURIComponent([drop.address, drop.pincode].filter(Boolean).join(', '));
  const done = !drop.canUpdate;
  const needCash = drop.codDue > 0;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900">
      <div className="mx-auto max-w-md space-y-4">
        <header>
          <p className="text-xs text-slate-500">{drop.shop.name}</p>
          <h1 className="text-xl font-bold">
            Order {drop.orderNumber}
            {drop.seq > 1 ? ` · parcel ${drop.seq}` : ''}
          </h1>
          <p className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium">
            <Truck className="h-3.5 w-3.5" /> {STATUS[drop.status] ?? drop.status}
          </p>
        </header>

        <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm">
          <div className="text-lg font-semibold">{drop.buyerName || 'Customer'}</div>
          {drop.address ? (
            <div className="flex gap-2 text-sm text-slate-700">
              <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              <span>
                {drop.address}
                {drop.pincode ? <strong> · PIN {drop.pincode}</strong> : null}
              </span>
            </div>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {tel ? (
              <a href={`tel:${tel}`} className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-2.5 text-sm font-medium">
                <Phone className="h-4 w-4" /> Call
              </a>
            ) : null}
            {drop.address ? (
              <a
                href={`https://www.google.com/maps/search/?api=1&query=${mapQuery}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 py-2.5 text-sm font-medium"
              >
                <Navigation className="h-4 w-4" /> Directions
              </a>
            ) : null}
          </div>
        </section>

        <section className={`rounded-2xl p-4 shadow-sm ${needCash ? 'bg-amber-50' : 'bg-emerald-50'}`}>
          <div className="flex items-center gap-2">
            <Banknote className={`h-5 w-5 ${needCash ? 'text-amber-700' : 'text-emerald-700'}`} />
            {needCash ? (
              <span className="text-lg font-bold text-amber-900">Collect ₹{drop.codDue.toLocaleString('en-IN')} cash</span>
            ) : (
              <span className="font-semibold text-emerald-900">{drop.codCollected ? 'Cash collected' : 'Prepaid · no cash to collect'}</span>
            )}
          </div>
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase text-slate-500">
            <Package className="h-3.5 w-3.5" /> {drop.packages > 1 ? `${drop.packages} boxes` : 'In the parcel'}
          </div>
          <ul className="space-y-1 text-sm">
            {drop.items.map((i) => (
              <li key={i.line_id} className="flex justify-between gap-2">
                <span>{i.name}</span>
                <span className="font-semibold">× {i.quantity}</span>
              </li>
            ))}
          </ul>
        </section>

        {error ? <div className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        {done ? (
          <div className="flex items-center gap-2 rounded-2xl bg-white p-4 text-sm text-slate-600 shadow-sm">
            <CheckCircle2 className="h-5 w-5 text-emerald-600" /> Nothing more to do on this delivery. Thank you!
          </div>
        ) : failing ? (
          <section className="space-y-2 rounded-2xl bg-white p-4 shadow-sm">
            <div className="text-sm font-semibold">Why could you not deliver?</div>
            <div className="flex flex-wrap gap-1.5">
              {REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium ${reason === r ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-700'}`}
                >
                  {r}
                </button>
              ))}
            </div>
            <button
              type="button"
              disabled={!reason || busy !== null}
              onClick={() => void act('delivery_failed', { reason })}
              className="w-full rounded-xl bg-red-600 py-3 text-base font-semibold text-white disabled:opacity-50"
            >
              {busy === 'delivery_failed' ? 'Saving…' : 'Mark not delivered'}
            </button>
            <button type="button" className="w-full py-2 text-sm text-slate-500" onClick={() => setFailing(false)}>
              Back
            </button>
          </section>
        ) : (
          <section className="space-y-2">
            {drop.status !== 'out_for_delivery' ? (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void act('out_for_delivery')}
                className="w-full rounded-xl bg-slate-900 py-3.5 text-base font-semibold text-white disabled:opacity-50"
              >
                {busy === 'out_for_delivery' ? 'Saving…' : 'Start delivery'}
              </button>
            ) : null}
            {needCash ? (
              <label className="flex items-center gap-2 rounded-xl bg-white px-4 py-3 text-sm shadow-sm">
                <input type="checkbox" className="h-5 w-5" checked={cash} onChange={(e) => setCash(e.target.checked)} />I collected ₹
                {drop.codDue.toLocaleString('en-IN')} cash
              </label>
            ) : null}
            <button
              type="button"
              disabled={busy !== null || (needCash && !cash)}
              onClick={() => void act('delivered', { cash_collected: cash })}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 py-3.5 text-base font-semibold text-white disabled:opacity-50"
            >
              <CheckCircle2 className="h-5 w-5" /> {busy === 'delivered' ? 'Saving…' : 'Delivered'}
            </button>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => setFailing(true)}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-red-300 bg-white py-3 text-sm font-semibold text-red-700"
            >
              <XCircle className="h-4 w-4" /> Could not deliver
            </button>
          </section>
        )}

        {drop.shop.phone ? (
          <p className="text-center text-xs text-slate-500">
            Problem? Call the shop: <a className="underline" href={`tel:${drop.shop.phone.replace(/[^\d+]/g, '')}`}>{drop.shop.phone}</a>
          </p>
        ) : null}
      </div>
    </main>
  );
}
