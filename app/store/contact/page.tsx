'use client';

import { StoreShell } from '@/components/store/StoreShell';
import { useStore } from '@/lib/store/store-context';

export default function StoreContactPage() {
  const { store } = useStore();
  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">Contact</h1>
      <div className="whitespace-pre-wrap text-sm text-gray-700">
        {store?.store_contact_md || (
          <>
            {store?.phone ? <p>Phone: {store.phone}</p> : null}
            {store?.email ? <p>Email: {store.email}</p> : null}
          </>
        )}
      </div>
    </StoreShell>
  );
}
