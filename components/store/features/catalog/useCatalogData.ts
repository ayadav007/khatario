'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { withStoreDraft } from '@/lib/store/store-context';
import type { StoreFacets } from '@/lib/store/store-facets-query';
import type { StoreProduct } from '@/components/store/StoreProductCard';

export interface CatalogCategory {
  id: string;
  name: string;
  item_count?: number;
}

const PAGE_SIZE = 40;

function itemsUrl(subdomain: string, apiParams: string, page: number, branchId: string | null) {
  const p = new URLSearchParams(apiParams);
  if (page > 1) p.set('page', String(page));
  if (branchId) p.set('branch_id', branchId);
  p.set('limit', String(PAGE_SIZE));
  return `/api/public/store/${encodeURIComponent(subdomain)}/items?${withStoreDraft(p)}`;
}

function facetsUrl(subdomain: string, apiParams: string, branchId: string | null) {
  const p = new URLSearchParams(apiParams);
  if (branchId) p.set('branch_id', branchId);
  return `/api/public/store/${encodeURIComponent(subdomain)}/items/facets?${withStoreDraft(p)}`;
}

/**
 * Items and facets for the current catalog filters (`apiParams` from useCatalogFilters).
 * A new filter set restarts at page 1 and drops answers to older requests; loadMore appends.
 * Pass a null subdomain to hold off fetching.
 */
export function useCatalogData(
  subdomain: string | null,
  apiParams: string,
  branchId: string | null = null,
) {
  const [items, setItems] = useState<StoreProduct[]>([]);
  const [total, setTotal] = useState(0);
  const [categories, setCategories] = useState<CatalogCategory[]>([]);
  const [facets, setFacets] = useState<StoreFacets | null>(null);
  // Starts loading so the grid shows placeholders, not "no products", before the first answer.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  // Bumped on every new filter set so late answers (and late "load more" pages) are ignored.
  const generation = useRef(0);
  // Set synchronously so a double click cannot fetch the same page twice before a re-render.
  const loadingMore = useRef(false);
  // Bumped by retry() to run the first-page fetch again.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!subdomain) return;
    const gen = ++generation.current;
    const ctrl = new AbortController();
    setLoading(true);
    setError(null);
    setPage(1);

    fetch(itemsUrl(subdomain, apiParams, 1, branchId), { signal: ctrl.signal })
      .then(async (res) => {
        if (gen !== generation.current) return;
        if (!res.ok) {
          setError('Could not load products.');
          return;
        }
        const data = await res.json();
        if (gen !== generation.current) return;
        setItems((data.items as StoreProduct[]) ?? []);
        setTotal(Number(data.total) || 0);
        if (Array.isArray(data.categories)) setCategories(data.categories);
      })
      .catch(() => {
        if (gen === generation.current && !ctrl.signal.aborted) setError('Could not load products.');
      })
      .finally(() => {
        if (gen === generation.current) setLoading(false);
      });

    // Facets are optional: the grid still works without them.
    fetch(facetsUrl(subdomain, apiParams, branchId), { signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok || gen !== generation.current) return;
        const data = (await res.json()) as StoreFacets;
        if (gen === generation.current) setFacets(data);
      })
      .catch(() => {
        /* aborted or offline */
      });

    return () => ctrl.abort();
  }, [subdomain, apiParams, branchId, reload]);

  const retry = useCallback(() => setReload((n) => n + 1), []);

  const loadMore = useCallback(async () => {
    if (!subdomain || loading || loadingMore.current || items.length >= total) return;
    loadingMore.current = true;
    const gen = generation.current;
    const next = page + 1;
    setLoading(true);
    try {
      const res = await fetch(itemsUrl(subdomain, apiParams, next, branchId));
      if (!res.ok || gen !== generation.current) return;
      const data = await res.json();
      if (gen !== generation.current) return;
      setItems((prev) => [...prev, ...((data.items as StoreProduct[]) ?? [])]);
      setTotal(Number(data.total) || 0);
      setPage(next);
    } catch {
      /* ignore: the button stays for another try */
    } finally {
      loadingMore.current = false;
      if (gen === generation.current) setLoading(false);
    }
  }, [subdomain, apiParams, branchId, loading, items.length, total, page]);

  // A held-off fetch (no subdomain yet) counts as loading too.
  return { items, total, categories, facets, loading: loading || !subdomain, error, retry, loadMore, hasMore: items.length < total };
}
