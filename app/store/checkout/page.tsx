'use client';

import { useState } from 'react';
import { StoreShell } from '@/components/store/StoreShell';
import { StoreCheckout, OrderConfirmation } from '@/components/store/StoreCheckout';
import { useStore } from '@/lib/store/store-context';

export default function StoreCheckoutPage() {
  const { store } = useStore();
  const [confirm, setConfirm] = useState<{ orderNumber: string; grandTotal: number; note?: string } | null>(null);

  return (
    <StoreShell>
      <StoreCheckout
        open
        embedded
        onClose={() => {
          window.location.href = '/cart';
        }}
        onOrderPlaced={(orderNumber, grandTotal, note) => setConfirm({ orderNumber, grandTotal, note })}
      />
      {confirm && store ? (
        <OrderConfirmation
          orderNumber={confirm.orderNumber}
          grandTotal={confirm.grandTotal}
          note={confirm.note}
          storeName={store.name}
          storePhone={store.phone}
          onClose={() => {
            window.location.href = '/';
          }}
        />
      ) : null}
    </StoreShell>
  );
}
