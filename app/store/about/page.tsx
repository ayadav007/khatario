'use client';

import { StoreShell } from '@/components/store/StoreShell';
import { useStore } from '@/lib/store/store-context';

export default function StoreAboutPage() {
  const { store } = useStore();
  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">About</h1>
      <div className="whitespace-pre-wrap text-sm text-gray-700">
        {store?.store_about_md || store?.store_tagline || `${store?.name ?? 'This store'} is powered by Khatario.`}
      </div>
    </StoreShell>
  );
}
