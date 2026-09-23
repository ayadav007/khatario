'use client';

import { useEffect, useState } from 'react';
import { StoreShell } from '@/components/store/StoreShell';
import { useStore } from '@/lib/store/store-context';

export default function StoreAccountPage() {
  const { store } = useStore();
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'phone' | 'code' | 'list'>('phone');
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [error, setError] = useState<string | null>(null);

  async function requestOtp() {
    if (!store) return;
    setError(null);
    const res = await fetch(`/api/public/store/${store.store_subdomain}/otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'request', phone }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    setStep('code');
  }

  async function verify() {
    if (!store) return;
    const res = await fetch(`/api/public/store/${store.store_subdomain}/otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ action: 'verify', phone, code }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error);
      return;
    }
    const acc = await fetch(`/api/public/store/${store.store_subdomain}/account`, {
      credentials: 'include',
    });
    if (acc.ok) {
      const list = await acc.json();
      setOrders(list.orders ?? []);
    }
    setStep('list');
  }

  useEffect(() => {
    if (!store) return;
    (async () => {
      const res = await fetch(`/api/public/store/${store.store_subdomain}/account`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setOrders(data.orders ?? []);
        setStep('list');
      }
    })();
  }, [store]);

  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">Your orders</h1>
      {error ? <p className="mb-3 text-sm text-red-600">{error}</p> : null}
      {step === 'phone' ? (
        <div className="max-w-sm space-y-3">
          <input
            className="w-full rounded-lg border px-3 py-2"
            placeholder="10-digit mobile"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <button className="rounded-lg bg-gray-900 px-4 py-2 text-white" onClick={() => void requestOtp()}>
            Send OTP
          </button>
        </div>
      ) : null}
      {step === 'code' ? (
        <div className="max-w-sm space-y-3">
          <input
            className="w-full rounded-lg border px-3 py-2"
            placeholder="6-digit code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button className="rounded-lg bg-gray-900 px-4 py-2 text-white" onClick={() => void verify()}>
            Verify
          </button>
        </div>
      ) : null}
      {step === 'list' ? (
        <ul className="space-y-3">
          {orders.length === 0 ? (
            <li className="text-sm text-gray-500">No orders yet.</li>
          ) : (
            orders.map((o) => (
              <li key={String(o.id)} className="rounded-xl border bg-white p-4">
                <p className="font-medium">{String(o.order_number)}</p>
                <p className="text-sm text-gray-500">
                  {String(o.status)} · {String(o.payment_status)} · ₹
                  {Number(o.grand_total).toLocaleString('en-IN')}
                </p>
                {o.tracking_url ? (
                  <a className="text-sm text-blue-600" href={String(o.tracking_url)}>
                    Track
                  </a>
                ) : null}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </StoreShell>
  );
}
