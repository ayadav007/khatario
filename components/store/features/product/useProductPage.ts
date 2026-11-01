'use client';

import { useEffect, useState } from 'react';
import { withStoreDraft } from '@/lib/store/store-context';
import { pushRecentlyViewed, readRecentlyViewed } from '@/lib/store/recently-viewed';
import type { StoreProduct } from '@/components/store/StoreProductCard';
import type { StoreProductDetail } from './product-view';

const RAIL_LIMIT = 8;

type State = {
  product: StoreProductDetail | null;
  related: StoreProduct[];
  recent: StoreProduct[];
  loading: boolean;
  error: string | null;
};

const EMPTY: State = { product: null, related: [], recent: [], loading: true, error: null };

async function getJson(url: string, signal: AbortSignal): Promise<unknown> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}

const itemsOf = (data: unknown): StoreProduct[] => {
  const items = (data as { items?: unknown } | null)?.items;
  return Array.isArray(items) ? (items as StoreProduct[]) : [];
};

/**
 * Product detail plus the related and recently viewed rails. Related loads alongside the
 * detail; recent is read after the product is recorded as viewed. A new `id` aborts the old requests.
 */
export function useProductPage(
  subdomain: string | null | undefined,
  id: string | null | undefined,
): State {
  const [state, setState] = useState<State>(EMPTY);

  useEffect(() => {
    if (!subdomain || !id) return;
    const ctrl = new AbortController();
    const base = `/api/public/store/${encodeURIComponent(subdomain)}/items`;
    setState(EMPTY);

    const relatedParams = new URLSearchParams({ limit: String(RAIL_LIMIT) });
    const related = getJson(
      `${base}/${encodeURIComponent(id)}/related?${withStoreDraft(relatedParams)}`,
      ctrl.signal,
    )
      .then(itemsOf)
      .catch(() => [] as StoreProduct[]);

    void (async () => {
      let product: StoreProductDetail | null = null;
      try {
        product = (await getJson(
          `${base}/${encodeURIComponent(id)}?${withStoreDraft(new URLSearchParams())}`,
          ctrl.signal,
        )) as StoreProductDetail;
      } catch {
        if (ctrl.signal.aborted) return;
        setState({ ...EMPTY, loading: false, error: 'Product not found.' });
        return;
      }
      if (ctrl.signal.aborted) return;
      setState((s) => ({ ...s, product, loading: false }));

      related.then((items) => {
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, related: items.filter((p) => p.id !== id) }));
      });

      pushRecentlyViewed(subdomain, id);
      const ids = readRecentlyViewed(subdomain, id).slice(0, RAIL_LIMIT);
      if (ids.length === 0) return;
      const recentParams = new URLSearchParams({ ids: ids.join(',') });
      try {
        const items = itemsOf(await getJson(`${base}?${withStoreDraft(recentParams)}`, ctrl.signal));
        if (!ctrl.signal.aborted) setState((s) => ({ ...s, recent: items.filter((p) => p.id !== id) }));
      } catch {
        /* the rail just stays hidden */
      }
    })();

    return () => ctrl.abort();
  }, [subdomain, id]);

  return state;
}
