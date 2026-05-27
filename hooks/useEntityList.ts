'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { buildApiUrl } from '@/lib/api-helpers';
import { isAppOffline } from '@/lib/network/offline-state';
import {
  browseCatalogItemsLocal,
  listCatalogCustomersLocal,
} from '@/lib/offline/catalog/client-search';
import {
  catalogCustomerToListCustomer,
  catalogItemToListItem,
} from '@/lib/offline/catalog/catalog-to-entity';

const EMPTY_QUERY_PARAMS: Record<string, string | number | boolean | null | undefined> = {};

interface UseEntityListOptions<T> {
  apiUrl: string;
  businessId: string | null;
  /** When set, fetch is skipped until this is non-null (avoids 400 from APIs that require user_id) */
  userId?: string | null;
  queryParams?: Record<string, string | number | boolean | null | undefined>;
  responseKey?: string;
  filter?: (row: T) => boolean;
}

interface UseEntityListResult<T> {
  data: T[];
  loading: boolean;
  syncing: boolean;
  /** True when the displayed data came from the local catalog (not a live API response). */
  fromCache: boolean;
  error: Error | null;
  refresh: () => Promise<void>;
}

export function useEntityList<T = Record<string, unknown>>(
  options: UseEntityListOptions<T>
): UseEntityListResult<T> {
  const { apiUrl, businessId, userId, responseKey, filter } = options;
  const queryParams = options.queryParams ?? EMPTY_QUERY_PARAMS;
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setData([]);
      setLoading(false);
      return;
    }
    if (userId !== undefined && userId === null) {
      setLoading(false);
      return;
    }
    setSyncing(true);
    setError(null);

    let hadLocalData = false;

    try {
      // ── Phase 1: local-first read ──────────────────────────────────────────
      // Serve catalog data immediately whenever it is populated.
      // This works even on captive Wi-Fi where isAppOffline() stays false.
      if (userId) {
        const scope = { businessId, userId };

        if (apiUrl.includes('/api/items')) {
          const local = await browseCatalogItemsLocal(scope, { limit: 20_000 });
          if (local != null) {
            const list = local.map((row) => catalogItemToListItem(row, businessId)) as T[];
            setData(filter ? (list.filter(filter) as T[]) : list);
            setFromCache(true);
            setLoading(false);
            hadLocalData = true;
          }
        } else if (apiUrl.includes('/api/customers')) {
          const local = await listCatalogCustomersLocal(scope, 20_000);
          if (local != null) {
            const list = local.map(catalogCustomerToListCustomer) as T[];
            setData(filter ? (list.filter(filter) as T[]) : list);
            setFromCache(true);
            setLoading(false);
            hadLocalData = true;
          }
        }
      }

      // ── Phase 2: skip API when fully offline ───────────────────────────────
      if (isAppOffline()) return;

      // ── Phase 3: background API refresh ───────────────────────────────────
      // If Phase 1 already set data the user sees it instantly; the API result
      // silently overwrites with the freshest server data.
      const url = buildApiUrl(apiUrl, {
        business_id: businessId,
        ...queryParams,
      });
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed to fetch list: ${res.status}`);
      }
      const json = await res.json();
      const rows =
        (responseKey ? json?.[responseKey] : undefined) ??
        json?.data ??
        json?.rows ??
        json?.items ??
        [];
      const list = Array.isArray(rows) ? (rows as T[]) : [];
      setData(filter ? (list.filter(filter) as T[]) : list);
      setFromCache(false);
      hadLocalData = true;
    } catch (err) {
      // ── Phase 4: last-resort fallback ──────────────────────────────────────
      // If Phase 1 already showed local data we swallow the API error silently.
      if (hadLocalData) return;

      if (userId) {
        const scope = { businessId, userId };
        if (apiUrl.includes('/api/items')) {
          const local = await browseCatalogItemsLocal(scope, { limit: 20_000 });
          if (local != null) {
            const list = local.map((row) => catalogItemToListItem(row, businessId)) as T[];
            setData(filter ? (list.filter(filter) as T[]) : list);
            setFromCache(true);
            setError(null);
            return;
          }
        }
        if (apiUrl.includes('/api/customers')) {
          const local = await listCatalogCustomersLocal(scope, 20_000);
          if (local != null) {
            const list = local.map(catalogCustomerToListCustomer) as T[];
            setData(filter ? (list.filter(filter) as T[]) : list);
            setFromCache(true);
            setError(null);
            return;
          }
        }
      }

      // Nothing from catalog either — surface the error.
      toast.error('Could not load data. Connect to the internet or sync your catalog.');
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, [apiUrl, businessId, userId, queryParams, responseKey, filter]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  const lastFetchKeyRef = useRef<string>('');
  const paramsKey = JSON.stringify(queryParams);

  useEffect(() => {
    if (!businessId) {
      setData([]);
      setLoading(false);
      return;
    }
    if (userId !== undefined && userId === null) {
      setLoading(false);
      return;
    }
    const key = `${apiUrl}|${businessId}|${userId ?? ''}|${paramsKey}`;
    if (lastFetchKeyRef.current === key) {
      return;
    }
    lastFetchKeyRef.current = key;
    setLoading(true);
    refreshRef.current();
  }, [apiUrl, businessId, userId, paramsKey]);

  return { data, loading, syncing, fromCache, error, refresh };
}
