'use client';

import { useEffect, useState } from 'react';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import type { StoreProductShelf } from '@/lib/store/store-theme';
import { StoreProductCard, type StoreProduct } from './StoreProductCard';

function shelfParams(shelf: StoreProductShelf): URLSearchParams {
  const params = new URLSearchParams();
  params.set('limit', '12');
  if (shelf.kind === 'discounted') params.set('discounted', '1');
  if (shelf.kind === 'price_max') params.set('max_price', String(shelf.price_max));
  return params;
}

function ShelfRow({
  shelf,
  onViewDetail,
}: {
  shelf: StoreProductShelf;
  onViewDetail?: (item: StoreProduct) => void;
}) {
  const { store, selectedBranchId } = useStore();
  const [items, setItems] = useState<StoreProduct[]>([]);

  useEffect(() => {
    if (!store) return;
    const params = shelfParams(shelf);
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    let cancelled = false;
    void fetch(
      `/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${withStoreDraft(params)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (cancelled) return;
        setItems((data?.items as StoreProduct[] | undefined) ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [store, selectedBranchId, shelf.kind, shelf.price_max, shelf.id]);

  if (items.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-3 text-sm font-semibold text-gray-900">{shelf.title}</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {items.map((item) => (
          <StoreProductCard key={`${shelf.id}-${item.id}`} product={item} onViewDetail={onViewDetail} />
        ))}
      </div>
    </section>
  );
}

export function StoreProductShelves({
  shelves,
  onViewDetail,
}: {
  shelves: StoreProductShelf[];
  onViewDetail?: (item: StoreProduct) => void;
}) {
  const enabled = shelves.filter((s) => s.enabled);
  if (enabled.length === 0) return null;
  return (
    <>
      {enabled.map((shelf) => (
        <ShelfRow key={shelf.id} shelf={shelf} onViewDetail={onViewDetail} />
      ))}
    </>
  );
}
