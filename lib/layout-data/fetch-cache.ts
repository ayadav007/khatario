import { isAppOffline } from '@/lib/network/offline-state';

const inFlightRequests = new Map<string, Promise<unknown>>();
const cache = new Map<string, { data: unknown; timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000;

export function getCacheKey(endpoint: string, params?: Record<string, string>): string {
  const paramStr = params ? '?' + new URLSearchParams(params).toString() : '';
  return `${endpoint}${paramStr}`;
}

export function isCacheValid(key: string): boolean {
  const cached = cache.get(key);
  if (!cached) return false;
  return Date.now() - cached.timestamp < CACHE_TTL;
}

export function invalidateCacheKey(key: string): void {
  cache.delete(key);
  inFlightRequests.delete(key);
}

export function setCacheEntry(key: string, data: unknown): void {
  cache.set(key, { data, timestamp: Date.now() });
}

export function readCacheEntry<T>(key: string): T | undefined {
  return cache.get(key)?.data as T | undefined;
}

export function clearLayoutFetchCache(): void {
  cache.clear();
  inFlightRequests.clear();
}

export async function fetchWithDedup<T>(
  endpoint: string,
  params?: Record<string, string>,
  options?: RequestInit
): Promise<T> {
  if (isAppOffline()) {
    throw new Error('Offline');
  }
  const cacheKey = getCacheKey(endpoint, params);

  if (isCacheValid(cacheKey)) {
    return cache.get(cacheKey)!.data as T;
  }

  if (inFlightRequests.has(cacheKey)) {
    return inFlightRequests.get(cacheKey)! as Promise<T>;
  }

  const paramStr = params ? '?' + new URLSearchParams(params).toString() : '';
  const url = `${endpoint}${paramStr}`;

  const promise = fetch(url, options)
    .then(async (res) => {
      if (!res.ok) {
        const errorText = await res.text().catch(() => 'Unknown error');
        throw new Error(`Failed to fetch ${endpoint}: ${res.status} ${errorText}`);
      }

      const text = await res.text();

      if (!text || text.trim() === '') {
        return {} as T;
      }

      try {
        const data = JSON.parse(text);
        cache.set(cacheKey, { data, timestamp: Date.now() });
        return data;
      } catch (parseError) {
        console.error(`Failed to parse JSON from ${endpoint}:`, parseError, 'Response:', text.substring(0, 200));
        throw new Error(`Invalid JSON response from ${endpoint}`);
      }
    })
    .finally(() => {
      inFlightRequests.delete(cacheKey);
    });

  inFlightRequests.set(cacheKey, promise);
  return promise;
}
