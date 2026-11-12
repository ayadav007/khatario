'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CreditCard, FileText, Loader2 } from 'lucide-react';
import type { PublicBusinessSurface } from '@/lib/customer-surface/types';
import { CustomerSurfaceShell } from './CustomerSurfaceShell';

interface Bill {
  id: string;
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  grand_total: number;
  balance: number;
  days_overdue: number;
  link: string | null;
}

interface BillsPayload {
  business: PublicBusinessSurface;
  customer_name: string;
  bills: Bill[];
  bills_due: number;
  advance: number;
  to_pay: number;
  overdue: number;
  pay: { online: boolean };
}

function inr(n: number) {
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function day(ymd: string | null) {
  return ymd ? new Date(`${ymd}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '–';
}

/** A customer's unpaid bills with one shop: pay all (less advance) or tick some bills. */
export function PublicBillsView({ token }: { token: string }) {
  const [data, setData] = useState<BillsPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState<string | null>(null);
  const [returned, setReturned] = useState<'done' | 'failed' | null>(null);
  const startDue = useRef<number | null>(null);
  const tries = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      try {
        const res = await fetch(`/api/public/b/${encodeURIComponent(token)}`);
        if (!res.ok) {
          setError(res.status === 404 ? 'This page is not available.' : 'Could not load your bills.');
          return;
        }
        const json = (await res.json()) as BillsPayload;
        setData(json);
        setError(null);
        if (startDue.current === null) startDue.current = json.bills_due;
        setPicked((prev) => new Set([...prev].filter((id) => json.bills.some((b) => b.id === id))));
      } catch {
        setError('Could not load your bills.');
      } finally {
        setLoading(false);
      }
    },
    [token],
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    try {
      const p = new URLSearchParams(window.location.search).get('payment');
      if (p === 'failed') setReturned('failed');
      else if (p) setReturned('done');
    } catch {
      /* no search params */
    }
  }, []);

  // The gateway's notice can land a few seconds after the customer comes back: re-check quietly.
  const confirmed = returned === 'done' && data !== null && startDue.current !== null && data.bills_due < startDue.current - 0.005;
  useEffect(() => {
    if (returned !== 'done' || !data || confirmed || data.bills.length === 0 || tries.current >= 6) return;
    const t = setTimeout(() => {
      tries.current += 1;
      void load(true);
    }, 3000);
    return () => clearTimeout(t);
  }, [returned, data, confirmed, load]);

  const pickedTotal = useMemo(
    () => (data ? data.bills.filter((b) => picked.has(b.id)).reduce((s, b) => s + b.balance, 0) : 0),
    [data, picked],
  );

  const pay = async (ids: string[] | null) => {
    setPaying(true);
    setPayError(null);
    try {
      const res = await fetch(`/api/public/b/${encodeURIComponent(token)}/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(ids ? { invoice_ids: ids } : {}),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && typeof json.payment_url === 'string') {
        window.location.href = json.payment_url;
        return;
      }
      setPayError(typeof json.error === 'string' ? json.error : 'Could not start the payment. Please try again.');
      if (res.status === 409) void load(true);
    } catch {
      setPayError('Could not start the payment. Please try again.');
    }
    setPaying(false);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 text-center">
        <p className="text-lg font-medium text-text-primary">{error || 'Not found'}</p>
      </div>
    );
  }

  const nothingDue = data.bills.length === 0;
  const canPay = data.pay.online && !nothingDue;

  return (
    <CustomerSurfaceShell business={data.business}>
      <section className="rounded-lg border border-border bg-white p-4 shadow-sm">
        <p className="text-sm text-text-secondary">Bills for {data.customer_name}</p>
        {nothingDue ? (
          <p className="mt-2 flex items-center gap-2 text-lg font-semibold text-green-700">
            <CheckCircle2 className="h-5 w-5" aria-hidden /> All your bills are paid. Thank you!
          </p>
        ) : (
          <>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
              <div>
                <p className="text-sm text-text-secondary">To pay</p>
                <p className="text-3xl font-bold text-gray-900">{inr(data.to_pay)}</p>
                <p className="text-xs text-text-muted">
                  {data.bills.length} unpaid bill{data.bills.length === 1 ? '' : 's'}
                  {data.overdue > 0.005 ? `, ${inr(data.overdue)} overdue` : ''}
                </p>
              </div>
              <a
                href={`/api/public/b/${encodeURIComponent(token)}/statement`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-md border border-border bg-gray-50 px-3 py-2 text-sm font-medium text-text-primary hover:bg-gray-100"
              >
                <FileText className="h-4 w-4" aria-hidden /> Statement PDF
              </a>
            </div>
            {data.advance > 0.005 ? (
              <p className="mt-2 text-sm text-text-secondary">
                Bills due {inr(data.bills_due)}, less your advance of {inr(data.advance)} with {data.business.name}.
              </p>
            ) : null}
          </>
        )}

        {returned === 'done' && !nothingDue ? (
          <p
            className={`mt-3 rounded-md px-3 py-2 text-sm ${confirmed ? 'bg-green-50 text-green-800' : 'bg-amber-50 text-amber-800'}`}
          >
            {confirmed
              ? 'Payment received. Thank you!'
              : tries.current >= 6
                ? 'We are still confirming your payment with the bank. This page will show it once it is confirmed.'
                : 'Confirming your payment…'}
          </p>
        ) : null}
        {returned === 'failed' ? (
          <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
            The payment did not go through. No money was taken; you can try again.
          </p>
        ) : null}
        {payError ? <p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{payError}</p> : null}

        {canPay && data.to_pay >= 1 ? (
          <button
            type="button"
            onClick={() => void pay(null)}
            disabled={paying}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-md bg-primary-600 px-4 py-3 text-base font-semibold text-white hover:bg-primary-700 disabled:opacity-60 sm:w-auto"
          >
            {paying ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CreditCard className="h-4 w-4" aria-hidden />}
            Pay {inr(data.to_pay)} now
          </button>
        ) : null}
      </section>

      {!nothingDue ? (
        <section className="rounded-lg border border-border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-base font-semibold text-gray-900">Unpaid bills</h2>
            {canPay ? <span className="text-xs text-text-muted">Tick bills to pay only those</span> : null}
          </div>
          <ul>
            {data.bills.map((b) => (
              <li key={b.id} className="flex items-start gap-3 border-b border-border px-4 py-3 last:border-b-0">
                {canPay ? (
                  <input
                    type="checkbox"
                    className="mt-1 h-4 w-4"
                    aria-label={`Pay ${b.invoice_number}`}
                    checked={picked.has(b.id)}
                    onChange={(e) =>
                      setPicked((prev) => {
                        const next = new Set(prev);
                        if (e.target.checked) next.add(b.id);
                        else next.delete(b.id);
                        return next;
                      })
                    }
                  />
                ) : null}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    {b.link ? (
                      <a href={b.link} className="link-primary font-medium">
                        {b.invoice_number}
                      </a>
                    ) : (
                      <span className="font-medium text-gray-900">{b.invoice_number}</span>
                    )}
                    <span className="font-semibold tabular-nums text-gray-900">{inr(b.balance)}</span>
                  </div>
                  <p className="text-xs text-text-secondary">
                    Billed {day(b.invoice_date)} · {b.balance < b.grand_total ? `of ${inr(b.grand_total)} · ` : ''}
                    {b.days_overdue > 0 ? (
                      <span className="text-red-600">overdue {b.days_overdue} days</span>
                    ) : (
                      <span>due {day(b.due_date || b.invoice_date)}</span>
                    )}
                  </p>
                </div>
              </li>
            ))}
          </ul>
          {canPay && picked.size > 0 ? (
            <div className="border-t border-border px-4 py-3">
              <button
                type="button"
                onClick={() => void pay([...picked])}
                disabled={paying || pickedTotal < 1}
                className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-primary-600 px-4 py-2.5 text-sm font-semibold text-primary-700 hover:bg-primary-50 disabled:opacity-60 sm:w-auto"
              >
                Pay {inr(pickedTotal)} for {picked.size} bill{picked.size === 1 ? '' : 's'}
              </button>
            </div>
          ) : null}
        </section>
      ) : null}
    </CustomerSurfaceShell>
  );
}
