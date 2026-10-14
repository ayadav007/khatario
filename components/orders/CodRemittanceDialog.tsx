'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banknote, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';

type Parcel = {
  id: string;
  order_number: string;
  seq: number;
  method: 'shiprocket' | 'courier' | 'own_rider' | 'local_app';
  partner_name: string | null;
  rider_name: string | null;
  awb: string | null;
  buyer_name: string | null;
  cod_amount: number;
  delivered_at: string | null;
};
type Remittance = {
  id: string;
  source: string;
  partner_name: string | null;
  reference: string | null;
  remitted_on: string;
  expected_amount: number;
  received_amount: number;
  deductions: number;
  parcels: number;
};

const SOURCE_LABEL: Record<Parcel['method'], string> = {
  shiprocket: 'Shiprocket',
  courier: 'Courier',
  own_rider: 'Own rider',
  local_app: 'Porter / local app',
};
const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';
const today = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Match cash the courier or rider paid over to the COD parcels it covers. */
export function CodRemittanceDialog({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState<Parcel[] | null>(null);
  const [history, setHistory] = useState<Remittance[]>([]);
  const [source, setSource] = useState<Parcel['method']>('shiprocket');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch('/api/orders/cod-remittances');
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || 'Could not load COD parcels');
      setOpen([]);
      return;
    }
    setOpen(json.open ?? []);
    setHistory(json.remittances ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bySource = useMemo(() => {
    const m = new Map<Parcel['method'], Parcel[]>();
    for (const p of open ?? []) m.set(p.method, [...(m.get(p.method) ?? []), p]);
    return m;
  }, [open]);
  const list = bySource.get(source) ?? [];
  const expected = list.filter((p) => picked.has(p.id)).reduce((s, p) => s + p.cod_amount, 0);

  function choose(src: Parcel['method']) {
    setSource(src);
    const all = new Set((bySource.get(src) ?? []).map((p) => p.id));
    setPicked(all);
    setReceived(String((bySource.get(src) ?? []).reduce((s, p) => s + p.cod_amount, 0)));
  }

  useEffect(() => {
    if (open && open.length > 0 && picked.size === 0) choose(open[0].method);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  async function save() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch('/api/orders/cod-remittances', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source,
          partner_name: SOURCE_LABEL[source],
          reference: reference || undefined,
          remitted_on: date,
          received_amount: Number(received),
          fulfilment_ids: [...picked],
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not save');
      setNotice(
        `Matched ${picked.size} parcel(s): ${inr(json.expected)} collected${json.deductions > 0 ? `, ${inr(json.deductions)} kept by the courier as charges` : ''}.`,
      );
      setPicked(new Set());
      setReference('');
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="COD remittance"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Banknote className="h-5 w-5 text-amber-600" /> Cash on delivery to receive
            </h2>
            <p className="text-sm text-slate-500">Delivered COD parcels whose cash the courier or rider still has to pay over.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {open === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : open.length === 0 ? (
          <p className="rounded-xl bg-emerald-50 px-3 py-3 text-sm text-emerald-800">All COD cash is matched. Nothing pending.</p>
        ) : (
          <>
            <div className="mb-3 flex flex-wrap gap-2">
              {[...bySource.entries()].map(([src, ps]) => (
                <button
                  key={src}
                  type="button"
                  onClick={() => choose(src)}
                  className={`rounded-xl border px-3 py-2 text-left text-sm ${
                    source === src ? 'border-primary-500 ring-1 ring-primary-500' : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div className="text-xs text-slate-500">{SOURCE_LABEL[src]}</div>
                  <div className="font-semibold">
                    {inr(ps.reduce((s, p) => s + p.cod_amount, 0))} · {ps.length}
                  </div>
                </button>
              ))}
            </div>

            <ul className="max-h-64 divide-y divide-slate-100 overflow-y-auto rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
              {list.map((p) => (
                <li key={p.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`Include ${p.order_number}`}
                    checked={picked.has(p.id)}
                    onChange={() =>
                      setPicked((s) => {
                        const n = new Set(s);
                        if (n.has(p.id)) n.delete(p.id);
                        else n.add(p.id);
                        return n;
                      })
                    }
                  />
                  <div className="min-w-0 flex-1">
                    <div className="font-medium">
                      {p.order_number}
                      {p.seq > 1 ? ` · parcel ${p.seq}` : ''}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {[p.buyer_name, p.awb, p.rider_name, p.delivered_at ? new Date(p.delivered_at).toLocaleDateString('en-IN') : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <span className="font-medium">{inr(p.cod_amount)}</span>
                </li>
              ))}
            </ul>

            <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
              <label className="text-xs text-slate-500">
                Amount received
                <input className={input} inputMode="decimal" value={received} onChange={(e) => setReceived(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500">
                Received on
                <input className={input} type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </label>
              <label className="text-xs text-slate-500">
                UTR / reference
                <input className={input} value={reference} onChange={(e) => setReference(e.target.value)} />
              </label>
            </div>
            <div className="mt-3 flex items-center justify-between gap-3 text-sm">
              <span className="text-slate-500">
                Selected {inr(expected)}
                {Number(received) < expected - 0.005 ? ` · ${inr(expected - Number(received))} short (courier charges)` : ''}
              </span>
              <Button isLoading={busy} disabled={picked.size === 0 || received === ''} onClick={() => void save()}>
                Match payment
              </Button>
            </div>
          </>
        )}

        {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
        {notice ? <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

        {history.length > 0 ? (
          <section className="mt-5">
            <h3 className="mb-2 text-sm font-semibold">Recent remittances</h3>
            <ul className="space-y-1 text-sm">
              {history.slice(0, 8).map((r) => (
                <li key={r.id} className="flex justify-between gap-2">
                  <span className="text-slate-600 dark:text-slate-300">
                    {r.remitted_on} · {r.partner_name || r.source} · {r.parcels} parcel(s){r.reference ? ` · ${r.reference}` : ''}
                  </span>
                  <span className="font-medium">
                    {inr(r.received_amount)}
                    {r.deductions > 0 ? <span className="text-xs text-slate-500"> (−{inr(r.deductions)})</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </div>
  );
}
