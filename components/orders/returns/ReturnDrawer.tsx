'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ExternalLink, Loader2, PackageCheck, PackageX, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ReturnStatusBadge } from './ReturnStatusBadge';
import {
  REFUND_METHOD_LABELS,
  RETURN_REASON_LABELS,
  type ReturnCondition,
  type ReturnReason,
  type ReturnRefundMethod,
  type ReturnStatus,
} from '@/lib/returns/labels';

interface ReturnLine {
  id: string;
  item_name: string;
  unit: string | null;
  quantity: number;
  received_qty: number | null;
  condition: ReturnCondition | null;
  unit_price: number;
  tax_rate: number;
}

interface ReturnDetail {
  id: string;
  return_number: string;
  status: ReturnStatus;
  initiated_by: 'merchant' | 'customer' | 'courier';
  reason: ReturnReason;
  reason_note: string | null;
  invoice_id: string;
  invoice_number: string;
  customer_name: string | null;
  customer_phone: string | null;
  credit_note_id: string | null;
  credit_note_number: string | null;
  credit_amount: string;
  refunded_amount: string;
  refund_method: ReturnRefundMethod | null;
  requested_at: string;
  lines: ReturnLine[];
  refunds: Array<{ id: string; amount: number; refund_date: string; mode: string; reference: string | null; voucher_number: string }>;
}

interface Payload {
  return: ReturnDetail;
  refundable: number;
  payment_accounts: Array<{ id: string; name: string; kind: 'cash' | 'bank' }>;
}

const inr = (n: number | string) => `₹${(Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const input = 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800';
const WHO: Record<ReturnDetail['initiated_by'], string> = {
  merchant: 'Started by the shop',
  customer: 'Asked by the customer',
  courier: 'Came back with the courier',
};

/** One return: approve or reject a request, receive the goods (restock or damaged), and pay back. */
export function ReturnDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [got, setGot] = useState<Record<string, { qty: number; condition: ReturnCondition }>>({});
  const [method, setMethod] = useState<ReturnRefundMethod | 'later'>('cash');
  const [amount, setAmount] = useState('');
  const [account, setAccount] = useState('');
  const [reference, setReference] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  const apply = useCallback((json: Payload) => {
    setData(json);
    setGot(
      Object.fromEntries(
        json.return.lines.map((l) => [l.id, { qty: l.received_qty ?? l.quantity, condition: l.condition ?? 'restock' }]),
      ),
    );
    setAmount(json.refundable > 0 ? String(json.refundable) : '');
  }, []);

  const load = useCallback(async () => {
    setError(null);
    const res = await fetch(`/api/returns/${id}`);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      setError(json.error || 'Could not load the return');
      return;
    }
    apply(json);
  }, [id, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`/api/returns/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || 'That did not work');
      apply(json);
      if (json.credit_note_number) setNotice(`Credit note ${json.credit_note_number} posted for ${inr(json.credit_amount)}.`);
      setRejecting(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work');
    } finally {
      setBusy(false);
    }
  }

  function refundBody() {
    if (method === 'later') return undefined;
    return {
      method,
      amount: method === 'store_credit' ? undefined : amount || undefined,
      payment_account_id: account || undefined,
      reference: reference || undefined,
    };
  }

  const r = data?.return;
  const estimate = r
    ? r.lines.reduce((s, l) => s + l.unit_price * (got[l.id]?.qty ?? 0) * (1 + l.tax_rate / 100), 0)
    : 0;
  const accounts = (data?.payment_accounts ?? []).filter((a) => (method === 'cash' ? a.kind === 'cash' : a.kind === 'bank'));

  const refundPicker = (
    <div className="space-y-2">
      <div className="text-xs font-medium text-slate-500">Pay back as</div>
      <div className="flex flex-wrap gap-1.5">
        {(['cash', 'upi', 'bank', 'store_credit'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMethod(m)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              method === m ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            {REFUND_METHOD_LABELS[m]}
          </button>
        ))}
        {r?.status === 'approved' ? (
          <button
            type="button"
            onClick={() => setMethod('later')}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              method === 'later' ? 'bg-primary-600 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            Decide later
          </button>
        ) : null}
      </div>
      {method === 'store_credit' ? (
        <p className="text-xs text-slate-500">The credit stays on the customer&apos;s account and is used on their next bill (exchanges too).</p>
      ) : method === 'later' ? null : (
        <div className="grid grid-cols-2 gap-2">
          {r?.status === 'received' ? (
            <input className={input} inputMode="decimal" placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          ) : null}
          <select className={input} value={account} onChange={(e) => setAccount(e.target.value)} aria-label="Paid from">
            <option value="">{method === 'cash' ? 'Cash in hand' : 'Default bank'}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          {method !== 'cash' ? (
            <input className={input} placeholder="UTR / reference" value={reference} onChange={(e) => setReference(e.target.value)} />
          ) : null}
        </div>
      )}
    </div>
  );

  return (
    <div className="fixed inset-0 z-[60] flex justify-end bg-black/30" onClick={onClose}>
      <aside
        className="flex h-full w-full max-w-lg flex-col overflow-y-auto bg-white shadow-xl dark:bg-slate-900"
        onClick={(e) => e.stopPropagation()}
        aria-label="Return details"
      >
        <header className="sticky top-0 z-10 flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-5 py-4 dark:border-slate-700 dark:bg-slate-900">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <RotateCcw className="h-5 w-5 text-orange-600" />
              <h2 className="text-lg font-semibold">{r?.return_number ?? 'Return'}</h2>
              {r ? <ReturnStatusBadge status={r.status} /> : null}
            </div>
            {r ? (
              <p className="mt-1 text-sm text-slate-500">
                {r.customer_name || 'Customer'}
                {r.customer_phone ? ` · ${r.customer_phone}` : ''} · {WHO[r.initiated_by]}
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

        <div className="space-y-5 px-5 py-4">
          {error ? <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div> : null}
          {notice ? <div className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{notice}</div> : null}

          {r ? (
            <>
              <section className="grid grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <div className="text-xs text-slate-500">Reason</div>
                  <div className="font-medium">{RETURN_REASON_LABELS[r.reason] ?? r.reason}</div>
                  {r.reason_note ? <div className="mt-1 text-xs text-slate-500">{r.reason_note}</div> : null}
                </div>
                <div className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                  <div className="text-xs text-slate-500">Bill</div>
                  <Link href={`/invoices/${r.invoice_id}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                    {r.invoice_number} <ExternalLink className="h-3 w-3" />
                  </Link>
                  {r.credit_note_number ? (
                    <div className="mt-1 text-xs text-slate-500">
                      Credit note {r.credit_note_number} · {inr(r.credit_amount)}
                    </div>
                  ) : null}
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-semibold">{r.status === 'approved' ? 'What came back?' : 'Items'}</h3>
                <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200 dark:divide-slate-800 dark:border-slate-700">
                  {r.lines.map((l) => {
                    const g = got[l.id] ?? { qty: l.quantity, condition: 'restock' as ReturnCondition };
                    const editable = r.status === 'approved';
                    return (
                      <li key={l.id} className="px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">{l.item_name}</div>
                            <div className="text-xs text-slate-500">
                              Asked {l.quantity}
                              {l.received_qty != null ? ` · received ${l.received_qty}` : ''} · {inr(l.unit_price)} + {l.tax_rate}%
                            </div>
                          </div>
                          {editable ? (
                            <input
                              className="w-16 rounded-lg border border-slate-300 bg-white px-2 py-1 text-right text-sm dark:border-slate-600 dark:bg-slate-800"
                              inputMode="decimal"
                              aria-label={`Received ${l.item_name}`}
                              value={g.qty}
                              onChange={(e) =>
                                setGot((s) => ({ ...s, [l.id]: { ...g, qty: Math.min(l.quantity, Math.max(0, Number(e.target.value) || 0)) } }))
                              }
                            />
                          ) : l.condition ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${
                                l.condition === 'damaged' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'
                              }`}
                            >
                              {l.condition === 'damaged' ? <PackageX className="h-3 w-3" /> : <PackageCheck className="h-3 w-3" />}
                              {l.condition === 'damaged' ? 'Written off' : 'Back in stock'}
                            </span>
                          ) : null}
                        </div>
                        {editable ? (
                          <div className="mt-2 flex gap-1.5">
                            {(['restock', 'damaged'] as const).map((c) => (
                              <button
                                key={c}
                                type="button"
                                onClick={() => setGot((s) => ({ ...s, [l.id]: { ...g, condition: c } }))}
                                className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                                  g.condition === c
                                    ? c === 'damaged'
                                      ? 'bg-red-600 text-white'
                                      : 'bg-emerald-600 text-white'
                                    : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200'
                                }`}
                              >
                                {c === 'damaged' ? <PackageX className="h-3 w-3" /> : <PackageCheck className="h-3 w-3" />}
                                {c === 'damaged' ? 'Damaged, write off' : 'Good, back to stock'}
                              </button>
                            ))}
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>

              {r.refunds.length > 0 ? (
                <section>
                  <h3 className="mb-2 text-sm font-semibold">Refunds paid</h3>
                  <ul className="space-y-1 text-sm">
                    {r.refunds.map((f) => (
                      <li key={f.id} className="flex justify-between">
                        <span>
                          {f.refund_date} · {f.mode.toUpperCase()} {f.reference ? `· ${f.reference}` : ''}
                        </span>
                        <span className="font-medium">{inr(f.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              ) : null}

              {r.status === 'closed' ? (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-200">
                  <CheckCircle2 className="h-4 w-4" />
                  {r.refund_method === 'store_credit'
                    ? `Kept as credit (${inr(r.credit_amount)}) for the next bill.`
                    : Number(r.refunded_amount) > 0
                      ? `Paid back ${inr(r.refunded_amount)}.`
                      : 'Settled against the unpaid bill.'}
                </div>
              ) : null}

              {r.status === 'requested' ? (
                <section className="space-y-2">
                  {rejecting ? (
                    <>
                      <textarea
                        className={input}
                        rows={2}
                        placeholder="Why? The customer sees this."
                        value={rejectReason}
                        onChange={(e) => setRejectReason(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button variant="destructive" isLoading={busy} onClick={() => void act({ action: 'reject', reason: rejectReason })}>
                          Reject request
                        </Button>
                        <Button variant="ghost" onClick={() => setRejecting(false)}>
                          Back
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="flex gap-2">
                      <Button isLoading={busy} onClick={() => void act({ action: 'approve' })}>
                        Approve return
                      </Button>
                      <Button variant="outline" onClick={() => setRejecting(true)}>
                        Reject
                      </Button>
                    </div>
                  )}
                </section>
              ) : null}

              {r.status === 'approved' ? (
                <section className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold">Receive goods</span>
                    <span className="text-sm text-slate-500">
                      Credit about <span className="font-semibold text-slate-900 dark:text-slate-100">{inr(estimate)}</span>
                    </span>
                  </div>
                  {refundPicker}
                  <p className="text-xs text-slate-500">
                    If the bill is not fully paid yet, the credit first reduces what is due; only the rest is paid back.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      isLoading={busy}
                      onClick={() =>
                        void act({
                          action: 'receive',
                          lines: r.lines.map((l) => ({ id: l.id, received_qty: got[l.id]?.qty, condition: got[l.id]?.condition })),
                          refund: refundBody(),
                        })
                      }
                    >
                      Receive &amp; post credit note
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => void act({ action: 'cancel' })}>
                      Cancel return
                    </Button>
                  </div>
                </section>
              ) : null}

              {r.status === 'received' && data ? (
                <section className="space-y-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                  <div className="flex items-baseline justify-between">
                    <span className="text-sm font-semibold">Refund due</span>
                    <span className="text-lg font-semibold">{inr(data.refundable)}</span>
                  </div>
                  {refundPicker}
                  <Button isLoading={busy} disabled={method === 'later'} onClick={() => void act({ action: 'settle', refund: refundBody() })}>
                    {method === 'store_credit' ? 'Keep as credit' : 'Record refund'}
                  </Button>
                </section>
              ) : null}
            </>
          ) : null}
        </div>
      </aside>
    </div>
  );
}
