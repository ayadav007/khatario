'use client';

import { useEffect, useState } from 'react';
import { Check, Loader2, Phone } from 'lucide-react';

type Line = { id: string; item_name: string; unit: string | null; qty: number; confirmed_qty: number | null };
type Order = {
  status: string;
  notes: string | null;
  need_by: string | null;
  created_at: string;
  response_note: string | null;
  buyer: { name: string; city: string | null; phone: string | null };
  supplier_name: string;
  joined: boolean;
  lines: Line[];
};

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });
const ANSWERED: Record<string, string> = {
  confirmed: 'You confirmed this order.',
  partial: 'You confirmed part of this order.',
  declined: 'You said you cannot supply this order.',
  cancelled: 'The buyer withdrew this order.',
};

/** The supplier confirms what they can send (or declines), then is invited to join Khatario. */
export function SupplierOrderView({ token }: { token: string }) {
  const [order, setOrder] = useState<Order | null>(null);
  const [missing, setMissing] = useState(false);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/public/supplier-order/${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => setOrder(d.order))
      .catch(() => setMissing(true));
  }, [token]);

  const answer = async (decline: boolean) => {
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/supplier-order/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decline,
          note: note.trim() || undefined,
          lines: order.lines.map((l) => ({ id: l.id, confirmed_qty: qty[l.id] ?? String(l.qty) })),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Could not send your answer');
      const fresh = await fetch(`/api/public/supplier-order/${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (fresh.ok) setOrder((await fresh.json()).order);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send your answer');
    } finally {
      setBusy(false);
    }
  };

  if (missing) {
    return (
      <main className="mx-auto max-w-md px-4 py-16 text-center text-sm text-slate-600">
        This order link is not valid. Ask the shop to send it again.
      </main>
    );
  }
  if (!order) {
    return (
      <main className="flex justify-center py-20">
        <Loader2 className="h-7 w-7 animate-spin text-[#032B23]" aria-label="Loading" />
      </main>
    );
  }

  const open = order.status === 'sent' || order.status === 'viewed';
  const tel = order.buyer.phone?.replace(/[^\d+]/g, '');

  return (
    <main className="min-h-screen bg-[#F4F7F6] px-4 py-8">
      <div className="mx-auto flex max-w-xl flex-col gap-5">
        <header className="flex flex-col gap-1">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#45625c]">Order for {order.supplier_name}</span>
          <h1 className="text-2xl font-bold text-[#032B23]">From {order.buyer.name}</h1>
          <p className="text-sm text-slate-600">
            {[order.buyer.city, `Sent ${new Date(order.created_at).toLocaleDateString('en-IN', { dateStyle: 'medium' })}`]
              .filter(Boolean)
              .join(' · ')}
            {order.need_by ? ` · Needed by ${new Date(order.need_by).toLocaleDateString('en-IN', { dateStyle: 'medium' })}` : ''}
          </p>
        </header>

        {order.notes && <p className="rounded-xl bg-white px-4 py-3 text-sm text-slate-700">“{order.notes}”</p>}

        <section className="rounded-2xl bg-white p-4 shadow-sm">
          <ul className="divide-y divide-slate-100">
            {order.lines.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="font-medium text-slate-900">{l.item_name}</p>
                  <p className="text-xs text-slate-500">
                    Asked {fmt(l.qty)} {l.unit || ''}
                  </p>
                </div>
                {open ? (
                  <label className="flex items-center gap-2 text-sm text-slate-600">
                    You can send
                    <input
                      id={`qty-${l.id}`}
                      type="number"
                      min={0}
                      max={l.qty}
                      step="any"
                      inputMode="decimal"
                      value={qty[l.id] ?? String(l.qty)}
                      onChange={(e) => setQty((p) => ({ ...p, [l.id]: e.target.value }))}
                      className="w-20 rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </label>
                ) : (
                  <span className="text-sm font-semibold text-slate-900">
                    {l.confirmed_qty == null ? '-' : `${fmt(l.confirmed_qty)} ${l.unit || ''}`}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>

        {open ? (
          <section className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm font-medium text-slate-700">
              Note for {order.buyer.name} (optional)
              <textarea
                id="supplier-note"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Delivery on Thursday, rate ₹240 a box"
                className="rounded-xl border border-slate-300 px-3 py-2 text-sm font-normal"
              />
            </label>
            {error && <p className="text-sm text-red-700">{error}</p>}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => answer(false)}
                className="inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-xl bg-[#032B23] px-5 font-semibold text-white disabled:opacity-60"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Confirm these quantities
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => answer(true)}
                className="min-h-12 rounded-xl border border-slate-300 bg-white px-5 font-semibold text-slate-700 disabled:opacity-60"
              >
                Cannot supply
              </button>
            </div>
          </section>
        ) : (
          <p className="rounded-xl bg-[#E3F2EB] px-4 py-3 text-sm font-medium text-[#0B5E45]">
            {ANSWERED[order.status] ?? 'This order has been answered.'}
            {order.response_note ? ` Your note: “${order.response_note}”` : ''}
          </p>
        )}

        {tel && (
          <p className="flex items-center gap-2 text-sm text-slate-600">
            <Phone className="h-4 w-4" aria-hidden="true" />
            Questions? Call {order.buyer.name}: <span className="select-all font-medium text-slate-900">{order.buyer.phone}</span>
          </p>
        )}

        {!order.joined && (
          <section className="flex flex-col gap-2 rounded-2xl bg-[#032B23] p-5 text-white">
            <h2 className="text-lg font-bold">Get orders as orders, not calls</h2>
            <p className="text-sm text-[#CFDDD8]">
              Join Khatario free. {order.buyer.name}&apos;s orders reach you in one list, your bills go straight into their
              purchases, and you see when they run low on your items.
            </p>
            <div className="mt-1 flex flex-wrap gap-2">
              <a
                href={`/signup?next=${encodeURIComponent(`/suppliers/hub/join/${token}`)}`}
                className="inline-flex min-h-11 items-center rounded-xl bg-[#F58220] px-5 text-sm font-bold text-[#011310]"
              >
                Join Khatario
              </a>
              <a
                href={`/suppliers/hub/join/${token}`}
                className="inline-flex min-h-11 items-center rounded-xl border border-white/40 px-5 text-sm font-semibold text-white"
              >
                I already use Khatario
              </a>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}
