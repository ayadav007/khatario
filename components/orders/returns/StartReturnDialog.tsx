'use client';

import { useEffect, useState } from 'react';
import { Loader2, Minus, Plus, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { RETURN_REASON_LABELS, RETURN_REASONS, type ReturnReason } from '@/lib/returns/labels';

interface Line {
  invoice_item_id: string;
  item_name: string;
  unit: string | null;
  sold_qty: number;
  returnable_qty: number;
  unit_price: number;
  tax_rate: number;
}

const inr = (n: number) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/** Merchant starts a return on a bill: pick lines and quantities, and say why. */
export function StartReturnDialog({
  invoiceId,
  invoiceNumber,
  onClose,
  onCreated,
}: {
  invoiceId: string;
  invoiceNumber?: string | null;
  onClose: () => void;
  onCreated: (returnId: string) => void;
}) {
  const [lines, setLines] = useState<Line[] | null>(null);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState<ReturnReason>('damaged');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const res = await fetch(`/api/returns?returnable_for=${invoiceId}`);
      const json = await res.json().catch(() => ({}));
      if (!live) return;
      if (!res.ok) {
        setError(json.error || 'Could not load the bill');
        setLines([]);
        return;
      }
      const ls = (json.lines ?? []) as Line[];
      setLines(ls);
      setQty(Object.fromEntries(ls.map((l) => [l.invoice_item_id, 0])));
    })();
    return () => {
      live = false;
    };
  }, [invoiceId]);

  const chosen = (lines ?? []).filter((l) => (qty[l.invoice_item_id] ?? 0) > 0);
  const estimate = chosen.reduce((s, l) => s + l.unit_price * (qty[l.invoice_item_id] ?? 0) * (1 + l.tax_rate / 100), 0);

  function bump(l: Line, d: number) {
    setQty((q) => ({ ...q, [l.invoice_item_id]: Math.min(l.returnable_qty, Math.max(0, (q[l.invoice_item_id] ?? 0) + d)) }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/returns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          invoice_id: invoiceId,
          reason,
          reason_note: note || undefined,
          lines: chosen.map((l) => ({ invoice_item_id: l.invoice_item_id, quantity: qty[l.invoice_item_id] })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not start the return');
      onCreated(json.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not start the return');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Start a return"
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <RotateCcw className="h-5 w-5 text-orange-600" /> Start a return
            </h2>
            <p className="text-sm text-slate-500">
              {invoiceNumber ? `Bill ${invoiceNumber}. ` : ''}Pick what is coming back. Stock and money are settled when you receive it.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>

        {lines === null ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
            {lines.map((l) => {
              const q = qty[l.invoice_item_id] ?? 0;
              const none = l.returnable_qty <= 0;
              return (
                <li key={l.invoice_item_id} className="flex items-center gap-3 px-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{l.item_name}</div>
                    <div className="text-xs text-slate-500">
                      {none ? 'Already returned' : `Sold ${l.sold_qty} · can return ${l.returnable_qty}`} · {inr(l.unit_price)} + {l.tax_rate}% GST
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      disabled={none || q <= 0}
                      onClick={() => bump(l, -1)}
                      className="rounded-lg border border-slate-300 p-1.5 disabled:opacity-40 dark:border-slate-600"
                      aria-label={`Fewer ${l.item_name}`}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums">{q}</span>
                    <button
                      type="button"
                      disabled={none || q >= l.returnable_qty}
                      onClick={() => bump(l, 1)}
                      className="rounded-lg border border-slate-300 p-1.5 disabled:opacity-40 dark:border-slate-600"
                      aria-label={`More ${l.item_name}`}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <label className="mt-4 block text-xs font-medium text-slate-500">Reason</label>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {RETURN_REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                reason === r ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
              }`}
            >
              {RETURN_REASON_LABELS[r]}
            </button>
          ))}
        </div>
        <textarea
          className="mt-3 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800"
          rows={2}
          placeholder="Note (optional)"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />

        {error ? <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}

        <div className="mt-4 flex items-center justify-between gap-3">
          <div className="text-sm text-slate-500">
            {chosen.length > 0 ? (
              <>
                About <span className="font-semibold text-slate-900 dark:text-slate-100">{inr(estimate)}</span> back
              </>
            ) : (
              'Nothing picked yet'
            )}
          </div>
          <Button onClick={() => void submit()} isLoading={busy} disabled={chosen.length === 0}>
            Start return
          </Button>
        </div>
      </div>
    </div>
  );
}
