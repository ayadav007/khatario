'use client';

import { useState } from 'react';
import { BookOpen, Loader2 } from 'lucide-react';
import type { StoreKhataStatus } from '@/lib/khata/store-view';

const inr = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;

/**
 * Khata on the store account page: the balance and pay-by date when it is open, a note while the
 * request waits, or a "Request khata" button for a shopper without one.
 */
export function StoreKhataCard({
  subdomain,
  storeName,
  khata,
  accent,
  onChanged,
}: {
  subdomain: string;
  storeName: string;
  khata: StoreKhataStatus | undefined;
  accent: string;
  onChanged: () => Promise<unknown> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = khata?.status ?? 'none';

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/public/store/${encodeURIComponent(subdomain)}/khata`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'request' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || 'Could not send the request. Please try again.');
        return;
      }
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border bg-white p-4">
      <div className="flex items-start gap-3">
        <BookOpen className="mt-0.5 h-5 w-5 flex-shrink-0" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          {khata?.status === 'open' ? (
            <>
              <p className="font-medium text-gray-900">Your khata with {storeName}</p>
              <p className="mt-1 text-2xl font-semibold text-gray-900">{inr(Math.max(0, khata.balance))}</p>
              <p className="text-sm text-gray-500">
                {khata.balance > 0.005 && khata.pay_by_label ? `Pay by ${khata.pay_by_label}` : 'Nothing due right now'}
                {khata.overdue_amount > 0.005 ? ` · ${inr(khata.overdue_amount)} overdue` : ''}
              </p>
              <p className="mt-1 text-xs text-gray-400">
                Settles on the {khata.settlement_day_label.toLowerCase()}
                {khata.available != null ? ` · ${inr(khata.available)} left on your limit` : ''}
              </p>
              <a
                href="/khata"
                className="mt-3 inline-block rounded-lg px-4 py-2 text-sm font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                Open my khata
              </a>
            </>
          ) : status === 'requested' ? (
            <>
              <p className="font-medium text-gray-900">Khata requested</p>
              <p className="mt-1 text-sm text-gray-500">
                {storeName} will set up your khata and message you on WhatsApp. Until then, choose another way to pay.
              </p>
            </>
          ) : (
            <>
              <p className="font-medium text-gray-900">Order now, pay monthly</p>
              <p className="mt-1 text-sm text-gray-500">
                Ask {storeName} to open a khata for you. You order from here and pay on a day of the month you agree with
                the shop.
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => void request()}
                className="mt-3 inline-flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium"
                style={{ borderColor: accent, color: accent }}
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Request khata
              </button>
              {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
