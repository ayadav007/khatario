'use client';

import { useEntityList } from './useEntityList';

interface UseEntityQueryOptions<T> {
  apiUrl: string;
  businessId: string | null;
  responseKey?: string;
}

export function useEntityQuery<T = Record<string, unknown>>(options: UseEntityQueryOptions<T>) {
  const { data, loading, error, refresh } = useEntityList<T>(options);
  return { data, loading, error, refetch: refresh };
}
