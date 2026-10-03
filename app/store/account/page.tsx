'use client';

import { useEffect, useState } from 'react';
import { StoreShell } from '@/components/store/StoreShell';
import { StorePhoneAuth } from '@/components/store/StorePhoneAuth';
import { useStore } from '@/lib/store/store-context';
import { storePhoneDigits } from '@/lib/store/store-phone';
import { sanitizeStoreTheme } from '@/lib/store/store-theme';
import { OrderTimeline, type TimelineEvent } from '@/components/orders/OrderTimeline';
import { FULFILMENT_STATUS_LABEL, isFulfilmentStatus } from '@/lib/fulfilment/rules';

type AccountOrder = {
  id: string;
  order_number: string;
  status: string;
  payment_status: string;
  grand_total: number;
  delivery_mode?: string | null;
  tracking_url?: string | null;
  awb?: string | null;
  partner_name?: string | null;
  delivery_status?: string | null;
  pickup_code?: string | null;
  track_url?: string | null;
  timeline?: TimelineEvent[];
};

export default function StoreAccountPage() {
  const { store, customer, refreshCustomer, signOutCustomer } = useStore();
  const [orders, setOrders] = useState<AccountOrder[]>([]);
  const accent = sanitizeStoreTheme(store?.store_theme).accent;

  useEffect(() => {
    if (!store || !customer) {
      setOrders([]);
      return;
    }
    void (async () => {
      const res = await fetch(`/api/public/store/${store.store_subdomain}/account`, {
        credentials: 'include',
      });
      if (!res.ok) return;
      const data = await res.json();
      setOrders(data.orders ?? []);
    })();
  }, [store, customer]);

  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">Your orders</h1>
      {!store ? null : !customer ? (
        <StorePhoneAuth
          store={store}
          mode="page"
          onVerified={async () => {
            await refreshCustomer();
          }}
        />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-gray-100 bg-white px-4 py-3">
            <div>
              <p className="text-sm font-medium text-gray-900">
                +91 {storePhoneDigits(customer.phone)}
              </p>
              {customer.name ? (
                <p className="text-xs text-gray-500">{customer.name}</p>
              ) : null}
            </div>
            <button
              type="button"
              onClick={() => void signOutCustomer()}
              className="text-sm text-gray-500 underline"
            >
              Sign out
            </button>
          </div>
          {orders.length === 0 ? (
            <p className="text-sm text-gray-500">No orders yet.</p>
          ) : (
            <ul className="space-y-3">
              {orders.map((o) => (
                <li key={o.id} className="rounded-xl border bg-white p-4">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className="font-medium">{o.order_number}</p>
                    <p className="text-sm text-gray-700">₹{Number(o.grand_total).toLocaleString('en-IN')}</p>
                  </div>
                  <p className="text-sm text-gray-500">
                    {isFulfilmentStatus(o.delivery_status) ? FULFILMENT_STATUS_LABEL[o.delivery_status] : o.status} ·{' '}
                    {o.payment_status.replace(/_/g, ' ')}
                  </p>
                  {o.pickup_code ? (
                    <p className="mt-2 text-sm">
                      Pickup code: <span className="font-mono font-bold tracking-widest">{o.pickup_code}</span>
                    </p>
                  ) : null}
                  {o.timeline && o.timeline.length > 0 ? (
                    <div className="mt-3">
                      <OrderTimeline
                        events={o.timeline}
                        current={o.delivery_status ?? null}
                        pickup={o.delivery_mode === 'pickup'}
                      />
                    </div>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-4 text-sm">
                    {o.track_url ? (
                      <a style={{ color: accent }} href={o.track_url}>
                        Order status
                      </a>
                    ) : null}
                    {o.tracking_url ? (
                      <a style={{ color: accent }} href={o.tracking_url} target="_blank" rel="noopener noreferrer">
                        Courier tracking{o.awb ? ` (${o.awb})` : ''}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </StoreShell>
  );
}
