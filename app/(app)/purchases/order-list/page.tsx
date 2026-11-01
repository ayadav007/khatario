'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Loader2, MessageCircle, Minus, Plus, Trash2, X } from 'lucide-react';
import { ItemAutocomplete } from '@/components/ui/ItemAutocomplete';
import { Button } from '@/components/ui/Button';
import { useToastContext } from '@/contexts/ToastContext';

type Line = {
  id: string;
  item_id: string;
  name: string;
  unit: string | null;
  rack: string | null;
  qty: number;
  stock: number;
  supplier_id: string | null;
  supplier_name: string | null;
  way: 'hub' | 'whatsapp' | null;
};
type Low = { item_id: string; name: string; unit: string | null; rack: string | null; stock: number; suggested_qty: number; supplier_name: string | null };
type Data = { lines: Line[]; running_low: Low[] };
type Result = { supplier_id: string; supplier_name: string; way: 'hub' | 'whatsapp'; items: number; link?: string; message?: string; phone?: string | null };
type Supplier = { id: string; name: string; city?: string | null; phone?: string | null };

const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 3 });

function waLink(phone: string | null | undefined, message: string) {
  const d = String(phone || '').replace(/\D/g, '');
  const to = d.length === 10 ? `91${d}` : d;
  return `https://wa.me/${to}?text=${encodeURIComponent(message)}`;
}

/**
 * Order list: walk the shop, pick what is running out, send each supplier their part. Only items
 * are picked; suppliers fill in by themselves, and items without one get it in one pick on Send.
 */
export default function OrderListPage() {
  const toast = useToastContext();
  const [data, setData] = useState<Data | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<'list' | 'send' | 'done'>('list');
  const [results, setResults] = useState<Result[]>([]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [remember, setRemember] = useState(true);
  const [picker, setPicker] = useState<null | { lineIds: string[] }>(null);
  const [showLow, setShowLow] = useState(true);

  const call = useCallback(
    async (url: string, init?: RequestInit) => {
      const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json' } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.error(body.error || 'That did not go through');
        return null;
      }
      return body;
    },
    [toast]
  );

  const load = useCallback(async () => {
    const body = await call('/api/purchases/order-list');
    if (body) setData(body);
  }, [call]);

  useEffect(() => {
    load();
  }, [load]);

  const lines = data?.lines ?? [];
  const add = async (itemId: string, qty: number) => {
    const body = await call('/api/purchases/order-list', { method: 'POST', body: JSON.stringify({ item_id: itemId, qty }) });
    if (body) setData(body);
  };
  const setQty = async (l: Line, qty: number) => {
    const body =
      qty <= 0
        ? await call(`/api/purchases/order-list/lines/${l.id}`, { method: 'DELETE' })
        : await call(`/api/purchases/order-list/lines/${l.id}`, { method: 'PATCH', body: JSON.stringify({ qty }) });
    if (body) setData(body);
  };
  const choose = async (supplier: Supplier) => {
    if (!picker) return;
    const ids = picker.lineIds;
    setPicker(null);
    const body =
      ids.length === 1 && step === 'list'
        ? await call(`/api/purchases/order-list/lines/${ids[0]}`, { method: 'PATCH', body: JSON.stringify({ supplier_id: supplier.id }) })
        : await call('/api/purchases/order-list/assign', {
            method: 'POST',
            body: JSON.stringify({ line_ids: ids, supplier_id: supplier.id, remember }),
          });
    if (body) {
      setData(body);
      setUnticked(new Set());
    }
  };
  const sendAll = async () => {
    setBusy(true);
    const body = await call('/api/purchases/order-list/send', { method: 'POST', body: '{}' });
    setBusy(false);
    if (body) {
      setResults(body.results || []);
      setStep('done');
    }
  };

  const missing = useMemo(() => lines.filter((l) => !l.supplier_id), [lines]);
  const groups = useMemo(() => {
    const m = new Map<string, Line[]>();
    for (const l of lines.filter((x) => x.supplier_id)) {
      if (!m.has(l.supplier_id!)) m.set(l.supplier_id!, []);
      m.get(l.supplier_id!)!.push(l);
    }
    return Array.from(m.values());
  }, [lines]);

  if (!data) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-primary-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 pb-28">
      <h1 className="text-xl font-semibold text-text-primary">
        {step === 'list' ? 'Order list' : step === 'send' ? 'Send orders' : 'Orders sent'}
      </h1>

      {step === 'list' && (
        <>
          <ItemAutocomplete
            value={query}
            onChange={setQuery}
            placeholder="Search or scan an item"
            onSelect={(item) => {
              const existing = lines.find((l) => l.item_id === item.id);
              add(item.id, existing ? existing.qty + 1 : 1);
              setQuery('');
            }}
          />

          {data.running_low.length > 0 && (
            <section className="rounded-xl bg-white p-3 shadow-sm">
              <button type="button" className="flex w-full justify-between text-sm font-semibold text-text-primary" onClick={() => setShowLow(!showLow)}>
                Running low ({data.running_low.length})<span className="font-normal text-primary-600">{showLow ? 'Hide' : 'Show'}</span>
              </button>
              {showLow && (
                <ul className="mt-2 divide-y divide-gray-100">
                  {data.running_low.map((l) => (
                    <li key={l.item_id} className="flex items-center justify-between gap-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-text-primary">{l.name}</p>
                        <p className="text-xs text-text-secondary">
                          {[l.rack && `Rack ${l.rack}`, `Left ${fmt(l.stock)}`, l.supplier_name || 'No supplier yet'].filter(Boolean).join(' · ')}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => add(l.item_id, l.suggested_qty)}
                        className="shrink-0 rounded-full bg-primary-50 px-3 py-1.5 text-sm font-semibold text-primary-700"
                      >
                        + {fmt(l.suggested_qty)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-xl bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-text-primary">Your list ({lines.length})</p>
            {lines.length === 0 ? (
              <p className="mt-2 text-sm text-text-secondary">Walk the racks and add what is running out. Suppliers fill in by themselves.</p>
            ) : (
              <ul className="mt-2 divide-y divide-gray-100">
                {lines.map((l) => (
                  <li key={l.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-text-primary">{l.name}</p>
                      <button
                        type="button"
                        onClick={() => setPicker({ lineIds: [l.id] })}
                        className={`text-left text-xs ${l.supplier_id ? 'text-text-secondary' : 'text-amber-700'}`}
                      >
                        {[l.rack && `Rack ${l.rack}`, l.supplier_name || 'No supplier yet · tap to choose'].filter(Boolean).join(' · ')}
                      </button>
                    </div>
                    <button type="button" aria-label={`Less ${l.name}`} onClick={() => setQty(l, l.qty - 1)} className="rounded-full p-2 hover:bg-gray-100">
                      {l.qty <= 1 ? <Trash2 className="h-4 w-4" /> : <Minus className="h-4 w-4" />}
                    </button>
                    <span className="w-10 text-center text-sm font-semibold tabular-nums">{fmt(l.qty)}</span>
                    <button type="button" aria-label={`More ${l.name}`} onClick={() => setQty(l, l.qty + 1)} className="rounded-full p-2 hover:bg-gray-100">
                      <Plus className="h-4 w-4" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {step === 'send' && (
        <>
          {missing.length > 0 && (
            <section className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
              <p className="text-sm font-semibold text-text-primary">Needs a supplier ({missing.length})</p>
              <p className="text-xs text-text-secondary">Tick the items that come from the same supplier, then choose it once.</p>
              {missing.map((l) => (
                <label key={l.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!unticked.has(l.id)}
                    onChange={(e) =>
                      setUnticked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.delete(l.id);
                        else next.add(l.id);
                        return next;
                      })
                    }
                    className="h-4 w-4"
                  />
                  {l.name} · {fmt(l.qty)}
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-text-secondary">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
                Remember for next time
              </label>
              <Button
                className="w-full"
                onClick={() => setPicker({ lineIds: missing.filter((l) => !unticked.has(l.id)).map((l) => l.id) })}
                disabled={missing.every((l) => unticked.has(l.id))}
              >
                Choose supplier
              </Button>
            </section>
          )}
          {groups.map((g) => (
            <section key={g[0].supplier_id} className="rounded-xl bg-white p-3 shadow-sm">
              <p className="text-sm font-semibold text-text-primary">{g[0].supplier_name}</p>
              <p className="text-xs text-text-secondary">
                {g.length} item{g.length === 1 ? '' : 's'} · {g[0].way === 'hub' ? 'Supplier Hub order' : 'On WhatsApp'}
              </p>
            </section>
          ))}
        </>
      )}

      {step === 'done' &&
        results.map((r) => (
          <section key={r.supplier_id} className="space-y-2 rounded-xl bg-white p-3 shadow-sm">
            <p className="text-sm font-semibold text-text-primary">{r.supplier_name}</p>
            <p className="text-xs text-text-secondary">
              {r.items} item{r.items === 1 ? '' : 's'}
            </p>
            {r.way === 'hub' ? (
              <p className="flex items-center gap-1.5 text-sm text-emerald-700">
                <Check className="h-4 w-4" /> Sent through Supplier Hub. They confirm it there.
              </p>
            ) : (
              <a
                href={waLink(r.phone, r.message || '')}
                target="_blank"
                rel="noopener noreferrer"
                className="flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary-600 text-sm font-semibold text-white"
              >
                <MessageCircle className="h-4 w-4" /> Send on WhatsApp
              </a>
            )}
          </section>
        ))}

      {lines.length > 0 || step === 'done' ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:left-64">
          <div className="mx-auto flex max-w-xl gap-2">
            {step === 'list' && (
              <Button className="flex-1" onClick={() => setStep('send')}>
                Send orders · {lines.length} item{lines.length === 1 ? '' : 's'}
              </Button>
            )}
            {step === 'send' && (
              <>
                <Button variant="secondary" onClick={() => setStep('list')}>
                  Back
                </Button>
                <Button className="flex-1" onClick={sendAll} disabled={busy || missing.length > 0}>
                  {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Send all
                </Button>
              </>
            )}
            {step === 'done' && (
              <Button
                className="flex-1"
                onClick={() => {
                  setStep('list');
                  setResults([]);
                  load();
                }}
              >
                Done
              </Button>
            )}
          </div>
        </div>
      ) : null}

      {picker && <SupplierPicker onPick={choose} onClose={() => setPicker(null)} />}
    </div>
  );
}

/** Bottom sheet: search and pick one of your suppliers. */
function SupplierPicker({ onPick, onClose }: { onPick: (s: Supplier) => void; onClose: () => void }) {
  const [all, setAll] = useState<Supplier[]>([]);
  const [q, setQ] = useState('');
  useEffect(() => {
    fetch('/api/suppliers?limit=500')
      .then((r) => (r.ok ? r.json() : { suppliers: [] }))
      .then((d) => setAll(d.suppliers || []))
      .catch(() => setAll([]));
  }, []);
  const shown = all.filter((s) => !q || s.name.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        role="dialog"
        aria-label="Choose supplier"
        className="max-h-[75vh] w-full max-w-md overflow-hidden rounded-t-2xl bg-white sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-100 p-3">
          <p className="font-semibold text-text-primary">Choose supplier</p>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-full p-1.5 hover:bg-gray-100">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-3">
          <input
            id="supplier-search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Supplier name"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <ul className="max-h-[50vh] overflow-y-auto">
          {shown.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onPick(s)} className="w-full px-4 py-3 text-left hover:bg-gray-50">
                <span className="block text-sm font-medium text-text-primary">{s.name}</span>
                {(s.city || s.phone) && <span className="block text-xs text-text-secondary">{[s.city, s.phone].filter(Boolean).join(' · ')}</span>}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
