'use client';

import { StoreShell } from '@/components/store/StoreShell';
import { StoreProductCard } from '@/components/store/StoreProductCard';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import type { StoreProduct } from '@/components/store/StoreProductCard';
import { useEffect, useState } from 'react';
import Link from 'next/link';

export default function StoreWishlistPage() {
  const { store, favoriteIds } = useStore();
  const [items, setItems] = useState<StoreProduct[]>([]);

  useEffect(() => {
    if (!store || favoriteIds.length === 0) {
      setItems([]);
      return;
    }
    void fetch(`/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${withStoreDraft(new URLSearchParams({ limit: '100' }))}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        const all = (data?.items as StoreProduct[]) ?? [];
        setItems(all.filter((i) => favoriteIds.includes(i.id)));
      });
  }, [store, favoriteIds]);

  return (
    <StoreShell>
      <h1 className="mb-4 text-xl font-semibold">Wishlist</h1>
      {favoriteIds.length === 0 ? (
        <p className="text-sm text-gray-500">
          No saved items yet. Tap the heart on a product.{' '}
          <Link href="/" className="underline">
            Continue shopping
          </Link>
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <StoreProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </StoreShell>
  );
}
