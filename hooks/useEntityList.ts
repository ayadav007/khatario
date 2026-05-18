'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { buildApiUrl } from '@/lib/api-helpers';

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
    try {
      const url = buildApiUrl(apiUrl, {
        business_id: businessId,
        ...queryParams,
      });
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        throw new Error(`Failed to fetch list: ${res.status}`);
      }
      const json = await res.json();
      const rows = (responseKey ? json?.[responseKey] : undefined) ?? json?.data ?? json?.rows ?? json?.items ?? [];
      const list = Array.isArray(rows) ? (rows as T[]) : [];
      setData(filter ? list.filter(filter) : list);
    } catch (err) {
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

  return { data, loading, syncing, error, refresh };
}
