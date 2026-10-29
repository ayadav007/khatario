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
import { loadInvoiceListCache } from '@/lib/offline/invoices/invoice-list-cache';

/** A list request that hangs longer than this is treated as failed. */
const LIST_FETCH_TIMEOUT_MS = 30_000;

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

  const applyList = useCallback(
    (list: T[]) => {
      setData(filter ? list.filter(filter) : list);
    },
    [filter]
  );

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

    /** The device's offline copy of this list; null when there is none or it cannot be read. */
    const readLocal = async (): Promise<T[] | null> => {
      if (!userId) return null;
      const scope = { businessId, userId };
      try {
        if (apiUrl.includes('/api/items')) {
          const local = await browseCatalogItemsLocal(scope, { limit: 20_000 });
          return local == null ? null : (local.map((row) => catalogItemToListItem(row, businessId)) as T[]);
        }
        if (apiUrl.includes('/api/customers')) {
          const local = await listCatalogCustomersLocal(scope, 20_000);
          return local == null ? null : (local.map(catalogCustomerToListCustomer) as T[]);
        }
        if (apiUrl.includes('/api/invoices')) {
          const local = await loadInvoiceListCache(scope);
          return local == null ? null : (local as T[]);
        }
      } catch (err) {
        console.warn('[useEntityList] offline copy could not be read', err);
      }
      return null;
    };

    // An empty offline copy is not an answer: it may just not be synced yet. Only rows count,
    // so a failed or skipped server call never shows "nothing here" in place of real records.
    let hadLocalRows = false;

    try {
      // ── Phase 1: local-first read ──────────────────────────────────────────
      // Serve the offline copy immediately when it has rows (captive Wi-Fi included).
      const local = await readLocal();
      if (local && local.length > 0) {
        applyList(local);
        setFromCache(true);
        setLoading(false);
        hadLocalRows = true;
      }

      // ── Phase 2: skip API when fully offline ───────────────────────────────
      if (isAppOffline()) {
        if (!hadLocalRows) {
          setData([]);
          setError(new Error('You are offline and this list is not saved on this device yet.'));
        }
        return;
      }

      // ── Phase 3: API refresh ───────────────────────────────────────────────
      // If Phase 1 already showed rows the user sees them instantly; the API result
      // silently overwrites with the freshest server data.
      const url = buildApiUrl(apiUrl, {
        business_id: businessId,
        ...queryParams,
      });
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), LIST_FETCH_TIMEOUT_MS);
      let res: Response;
      try {
        res = await fetch(url, { cache: 'no-store', signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
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
      applyList(list);
      setFromCache(false);
      setError(null);
    } catch (err) {
      // ── Phase 4: last-resort fallback ──────────────────────────────────────
      // Rows from the offline copy are already on screen: keep them, quietly.
      if (hadLocalRows) return;

      const local = await readLocal();
      if (local && local.length > 0) {
        applyList(local);
        setFromCache(true);
        setError(null);
        return;
      }

      // Nothing to show: say so instead of an empty list that looks like "no records".
      setData([]);
      toast.error('Could not load data. Check your connection and try again.');
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSyncing(false);
      setLoading(false);
    }
  }, [apiUrl, businessId, userId, queryParams, responseKey, applyList]);

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
