'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { StoreShell } from '@/components/store/StoreShell';
import { StorePhoneAuth } from '@/components/store/StorePhoneAuth';
import { StoreKhataCard } from '@/components/store/StoreKhataCard';
import UpiPayActions from '@/components/payments/UpiPayActions';
import { useStore } from '@/lib/store/store-context';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import type { StoreKhataStatus } from '@/lib/khata/store-view';
import type { upiAppLinks } from '@/lib/payments/upi-pay-link';

type Bill = {
  invoice_number: string;
  invoice_date: string;
  due_date: string | null;
  pay_by: string | null;
  amount: number;
  balance: number;
  overdue: boolean;
  link: string | null;
};
type PayOptions = {
  online: boolean;
  allow_part_payment: boolean;
  upi: { vpa: string; amount: number; links: ReturnType<typeof upiAppLinks> } | null;
};
type KhataData =
  | {
      kind: 'khata';
      name: string;
      khata: Extract<StoreKhataStatus, { status: 'open' }>;
      bills: Bill[];
      payments: { payment_date: string; amount: number; payment_mode: string | null }[];
      statements: { statement_date: string; due_date: string; closing_due: number; token: string }[];
      owed: number;
      pay: PayOptions;
    }
  | { kind: 'status'; khata: StoreKhataStatus }
  | {
      kind: 'statement';
      name: string;
      statement: {
        period_start: string;
        period_end: string;
        statement_date: string;
        due_date: string;
        due_label: string;
        opening_due: number;
        charges: number;
        payments: number;
        closing_due: number;
      };
      owed_now: number;
      bills: Bill[];
      pay: PayOptions;
    };

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (d: string) =>
  new Date(`${d.slice(0, 10)}T12:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

/** "My khata": balance, bills and payments; pay online when the shop has a gateway. */
export default function StoreKhataPage() {
  const { store, customer, refreshCustomer } = useStore();
  const accent = sanitizeStoreTheme(store?.store_theme).accent;
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<KhataData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('s'));
  }, []);

  const load = useCallback(async () => {
    if (!store) return;
    if (!token && !customer) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const q = token ? `?s=${encodeURIComponent(token)}` : '';
      const res = await fetch(`/api/public/store/${encodeURIComponent(store.store_subdomain)}/khata${q}`, {
        credentials: 'include',
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.error || 'Could not load your khata');
        setData(null);
        return;
      }
      setData(body as KhataData);
    } finally {
      setLoading(false);
    }
  }, [store, customer, token]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">My khata</h1>
      {!store ? null : !token && !customer ? (
        <StorePhoneAuth store={store} mode="page" onVerified={async () => void (await refreshCustomer())} />
      ) : loading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
        </div>
      ) : error ? (
        <p className="rounded-xl border bg-white p-4 text-sm text-red-600">{error}</p>
      ) : data?.kind === 'status' ? (
        <StoreKhataCard
          subdomain={store.store_subdomain}
          storeName={store.name}
          khata={data.khata}
          accent={accent}
          onChanged={async () => {
            await refreshCustomer();
            await load();
          }}
        />
      ) : data?.kind === 'khata' ? (
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4">
            <p className="text-sm text-gray-500">You owe {store.name}</p>
            <p className="text-3xl font-semibold text-gray-900">{inr(Math.max(0, data.khata.balance))}</p>
            <p className="mt-1 text-sm text-gray-600">
              {data.khata.balance > 0.005 && data.khata.pay_by_label ? `Pay by ${data.khata.pay_by_label}` : 'Nothing due right now'}
              {data.khata.overdue_amount > 0.005 ? (
                <span className="font-medium text-red-600"> · {inr(data.khata.overdue_amount)} overdue</span>
              ) : null}
            </p>
            <p className="mt-1 text-xs text-gray-400">
              Settles on the {data.khata.settlement_day_label.toLowerCase()}
              {data.khata.available != null ? ` · ${inr(data.khata.available)} left on your limit` : ''}
              {data.khata.pending_orders > 0.005 ? ` · ${inr(data.khata.pending_orders)} waiting for the shop to confirm` : ''}
            </p>
            <PayBox subdomain={store.store_subdomain} owed={data.owed} pay={data.pay} accent={accent} />
          </div>
          <BillList bills={data.bills} />
          {data.payments.length > 0 ? (
            <section className="rounded-xl border bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-900">Payments</h2>
              <ul className="divide-y text-sm">
                {data.payments.map((p, i) => (
                  <li key={`${p.payment_date}-${i}`} className="flex justify-between py-2">
                    <span className="text-gray-600">
                      {day(p.payment_date)} · {(p.payment_mode || 'payment').replace(/_/g, ' ')}
                    </span>
                    <span className="font-medium text-green-700">{inr(p.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {data.statements.length > 0 ? (
            <section className="rounded-xl border bg-white p-4">
              <h2 className="mb-2 text-sm font-semibold text-gray-900">Statements</h2>
              <ul className="divide-y text-sm">
                {data.statements.map((s) => (
                  <li key={s.token} className="flex justify-between py-2">
                    <a className="underline" style={{ color: accent }} href={`/khata?s=${encodeURIComponent(s.token)}`}>
                      {day(s.statement_date)}
                    </a>
                    <span className="text-gray-700">
                      {inr(s.closing_due)} · pay by {day(s.due_date)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      ) : data?.kind === 'statement' ? (
        <div className="space-y-4">
          <div className="rounded-xl border bg-white p-4">
            <p className="text-sm text-gray-500">
              Hi {data.name}, your statement from {store.name} for {day(data.statement.period_start)} to{' '}
              {day(data.statement.period_end)}
            </p>
            <dl className="mt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-gray-500">Earlier due</dt>
                <dd>{inr(data.statement.opening_due)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Bought</dt>
                <dd>{inr(data.statement.charges)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-gray-500">Paid</dt>
                <dd className="text-green-700">−{inr(data.statement.payments)}</dd>
              </div>
              <div className="flex justify-between border-t pt-2 text-base font-semibold">
                <dt>Due by {data.statement.due_label}</dt>
                <dd>{inr(data.statement.closing_due)}</dd>
              </div>
            </dl>
            <p className="mt-2 text-xs text-gray-400">
              Still open today: {inr(data.owed_now)}
            </p>
            <PayBox subdomain={store.store_subdomain} owed={data.owed_now} pay={data.pay} accent={accent} token={token} />
          </div>
          <BillList bills={data.bills} />
        </div>
      ) : null}
    </StoreShell>
  );
}

function BillList({ bills }: { bills: Bill[] }) {
  if (bills.length === 0) return null;
  return (
    <section className="rounded-xl border bg-white p-4">
      <h2 className="mb-2 text-sm font-semibold text-gray-900">Bills</h2>
      <ul className="divide-y text-sm">
        {bills.map((b) => (
          <li key={b.invoice_number} className="flex items-start justify-between gap-3 py-2">
            <div>
              {b.link ? (
                <a className="font-medium underline" href={b.link} target="_blank" rel="noopener noreferrer">
                  {b.invoice_number}
                </a>
              ) : (
                <span className="font-medium">{b.invoice_number}</span>
              )}
              <p className="text-xs text-gray-500">
                {day(b.invoice_date)}
                {b.pay_by ? ` · pay by ${day(b.pay_by)}` : ''}
                {b.overdue && b.balance > 0.005 ? <span className="text-red-600"> · overdue</span> : null}
              </p>
            </div>
            <div className="text-right">
              <p>{inr(b.amount)}</p>
              {b.balance > 0.005 && Math.abs(b.balance - b.amount) > 0.005 ? (
                <p className="text-xs text-gray-500">{inr(b.balance)} left</p>
              ) : b.balance <= 0.005 ? (
                <p className="text-xs text-green-700">Paid</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function PayBox({
  subdomain,
  owed,
  pay,
  accent,
  token,
}: {
  subdomain: string;
  owed: number;
  pay: PayOptions;
  accent: string;
  token?: string | null;
}) {
  const [amount, setAmount] = useState(String(owed));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (owed <= 0.005) return null;

  async function payOnline() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/store/${encodeURIComponent(subdomain)}/khata`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'pay', amount: pay.allow_part_payment ? Number(amount) : null, s: token || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.payment_url) {
        setError(data.error || 'Could not start the payment. Please try again.');
        return;
      }
      window.location.href = data.payment_url as string;
    } finally {
      setBusy(false);
    }
  }

  if (pay.online) {
    return (
      <div className="mt-4 space-y-2">
        {pay.allow_part_payment ? (
          <label className="block text-xs text-gray-500">
            Amount to pay
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
              className="mt-1 w-full rounded-lg border border-gray-200 px-3 py-2 text-base text-gray-900"
            />
          </label>
        ) : null}
        <button
          type="button"
          disabled={busy}
          onClick={() => void payOnline()}
          className="flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white"
          style={{ backgroundColor: accent }}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Pay {inr(pay.allow_part_payment ? Number(amount) || 0 : owed)}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    );
  }
  if (pay.upi) {
    return (
      <div className="mt-4">
        <UpiPayActions links={pay.upi.links} vpa={pay.upi.vpa} />
        <p className="mt-2 text-xs text-gray-500">The shop will confirm your payment and update your khata.</p>
      </div>
    );
  }
  return <p className="mt-4 rounded-lg bg-gray-50 px-3 py-2 text-sm text-gray-600">Please pay at the shop.</p>;
}
