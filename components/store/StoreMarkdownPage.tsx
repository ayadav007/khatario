'use client';

import { StoreShell } from '@/components/store/StoreShell';
import { useStore } from '@/lib/store/store-context';

export function StoreMarkdownPage({ title, body }: { title: string; body: string }) {
  const { store } = useStore();
  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">{title}</h1>
      <div className="whitespace-pre-wrap text-sm text-gray-700">{body || `${store?.name ?? 'This store'} has not published this page yet.`}</div>
    </StoreShell>
  );
}
