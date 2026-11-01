'use client';

import { useEffect, useState } from 'react';
import { useStore, withStoreDraft } from '@/lib/store/store-context';
import { studioProductParams } from '@/lib/store/studio-layout';
import type { StudioSettings } from '@/lib/store/studio-sections';
import { StoreProductCard, type StoreProduct } from '../StoreProductCard';
import { StudioProductsSection, type StudioLink } from './StudioSections';

/** How many top sellers get the "Bestseller" badge in a best-sellers section. */
const BESTSELLER_BADGES = 3;

/** A Studio product section filled from its source (featured, new, best sellers, a category…). */
export function StudioSourcedProducts({
  s,
  mobileColumns,
  action,
  onViewDetail,
}: {
  s: StudioSettings;
  mobileColumns: 2 | 3;
  action: StudioLink | null;
  onViewDetail?: (item: StoreProduct) => void;
}) {
  const { store, selectedBranchId } = useStore();
  const [items, setItems] = useState<StoreProduct[] | null>(null);
  const query = studioProductParams(s).toString();

  useEffect(() => {
    if (!store) return;
    const params = new URLSearchParams(query);
    if (selectedBranchId) params.set('branch_id', selectedBranchId);
    let cancelled = false;
    void fetch(`/api/public/store/${encodeURIComponent(store.store_subdomain)}/items?${withStoreDraft(params)}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!cancelled) setItems((data?.items as StoreProduct[] | undefined) ?? []);
      })
      .catch(() => {
        if (!cancelled) setItems([]);
      });
    return () => {
      cancelled = true;
    };
  }, [store, selectedBranchId, query]);

  if (items && items.length === 0) return null;
  const limit = s.limit ?? 8;

  return (
    <StudioProductsSection s={s} action={action} mobileColumns={mobileColumns} gridClassName="isRow">
      {items === null
        ? Array.from({ length: Math.min(limit, s.columns ?? 5) }).map((_, i) => <div key={i} className="skeleton" />)
        : items.map((item, i) => (
            <StoreProductCard
              key={item.id}
              product={item}
              onViewDetail={onViewDetail}
              highlight={
                s.source === 'bestsellers' && i < BESTSELLER_BADGES && (item.sold_count ?? 0) > 0 ? 'Bestseller' : undefined
              }
            />
          ))}
    </StudioProductsSection>
  );
}
