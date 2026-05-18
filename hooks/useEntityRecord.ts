'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface UseEntityRecordOptions<T> {
  recordId: string | null;
  apiUrl: string | ((id: string) => string);
  responseKey?: string;
  transform?: (raw: any) => T;
}

export function useEntityRecord<T = Record<string, unknown>>({
  recordId,
  apiUrl,
  responseKey,
  transform,
}: UseEntityRecordOptions<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const apiUrlRef = useRef(apiUrl);
  const transformRef = useRef(transform);
  const responseKeyRef = useRef(responseKey);
  apiUrlRef.current = apiUrl;
  transformRef.current = transform;
  responseKeyRef.current = responseKey;

  const refetch = useCallback(async () => {
    if (!recordId) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const url = apiUrlRef.current;
      const path = typeof url === 'function' ? url(recordId) : `${url}/${recordId}`;
      const res = await fetch(path, { cache: 'no-store' });
      if (!res.ok) throw new Error(`Failed to fetch record: ${res.status}`);
      const json = await res.json();
      const key = responseKeyRef.current;
      const raw = key ? json?.[key] : json;
      const tx = transformRef.current;
      setData(tx ? tx(raw) : (raw as T));
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [recordId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return { data, loading, error, refetch };
}
