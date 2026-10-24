'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, RotateCcw } from 'lucide-react';

type Info = {
  can_return: boolean;
  reason: string | null;
  window_days?: number;
  reasons?: Array<{ value: string; label: string }>;
  lines: Array<{ invoice_item_id: string; item_name: string; unit: string | null; returnable_qty: number }>;
  returns: Array<{
    return_number: string;
    status: string;
    credit_amount: number;
    refunded_amount: number;
    refund_method: string | null;
    rejected_reason: string | null;
  }>;
};

const BUYER_STATUS: Record<string, string> = {
  requested: 'Waiting for the shop',
  approved: 'Approved – hand the items back',
  received: 'Items received – refund on the way',
  closed: 'Completed',
  rejected: 'Not accepted',
  cancelled: 'Cancelled',
};

/** Buyer's own return request for a delivered order, and the status of earlier ones. */
export function StoreOrderReturn({ subdomain, orderId, accent }: { subdomain: string; orderId: string; accent: string }) {
  const [info, setInfo] = useState<Info | null>(null);
  const [openForm, setOpenForm] = useState(false);
  const [qty, setQty] = useState<Record<string, number>>({});
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const base = `/api/public/store/${encodeURIComponent(subdomain)}/orders/${orderId}/return`;
  const load = useCallback(async () => {
    const res = await fetch(base, { credentials: 'include' }).catch(() => null);
    if (!res?.ok) return;
    setInfo(await res.json());
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!info) return null;
  if (!info.can_return && info.returns.length === 0) return null;

  const chosen = info.lines.filter((l) => (qty[l.invoice_item_id] ?? 0) > 0);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(base, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reason,
          note: note || undefined,
          lines: chosen.map((l) => ({ invoice_item_id: l.invoice_item_id, quantity: qty[l.invoice_item_id] })),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'Could not send the request');
      setDone(`Return ${json.return_number ?? ''} requested. The shop will get back to you.`.replace('  ', ' '));
      setOpenForm(false);
      setQty({});
      void load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send the request');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {info.returns.map((r) => (
        <p key={r.return_number} className="text-sm text-gray-600">
          <RotateCcw className="mr-1 inline h-3.5 w-3.5" />
          Return {r.return_number}: {BUYER_STATUS[r.status] ?? r.status}
          {r.status === 'closed' && r.refunded_amount > 0 ? ` · ₹${r.refunded_amount.toLocaleString('en-IN')} refunded` : ''}
          {r.status === 'closed' && r.refund_method === 'store_credit' ? ' · kept as credit for your next order' : ''}
          {r.status === 'rejected' && r.rejected_reason ? ` · ${r.rejected_reason}` : ''}
        </p>
      ))}
      {done ? <p className="mt-1 text-sm text-emerald-700">{done}</p> : null}

      {info.can_return && !openForm ? (
        <button type="button" className="mt-1 text-sm font-medium" style={{ color: accent }} onClick={() => setOpenForm(true)}>
          Return items
          {info.window_days ? <span className="ml-1 font-normal text-gray-400">(within {info.window_days} days of delivery)</span> : null}
        </button>
      ) : null}

      {openForm ? (
        <div className="mt-2 space-y-3 rounded-lg bg-gray-50 p-3">
          <p className="text-sm font-medium text-gray-900">What would you like to return?</p>
          <ul className="space-y-2">
            {info.lines.map((l) => (
              <li key={l.invoice_item_id} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">{l.item_name}</span>
                <select
                  className="rounded-md border border-gray-300 bg-white px-2 py-1 text-sm"
                  value={qty[l.invoice_item_id] ?? 0}
                  aria-label={`Quantity of ${l.item_name} to return`}
                  onChange={(e) => setQty((q) => ({ ...q, [l.invoice_item_id]: Number(e.target.value) }))}
                >
                  {Array.from({ length: Math.floor(l.returnable_qty) + 1 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
          <select
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            aria-label="Reason for return"
          >
            <option value="">Reason for return</option>
            {(info.reasons ?? []).map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <textarea
            className="w-full rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
            rows={2}
            placeholder="Anything the shop should know (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex gap-3">
            <button
              type="button"
              disabled={busy || chosen.length === 0 || !reason}
              onClick={() => void submit()}
              className="inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              style={{ backgroundColor: accent }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Request return
            </button>
            <button type="button" className="text-sm text-gray-500" onClick={() => setOpenForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
