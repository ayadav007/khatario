'use client';

import { useRenderLoopProbe } from '@/lib/debug/render-loop-detector';
import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
} from 'react';
import { useAuth } from './AuthContext';
import { useNetworkStatus } from '@/hooks/useNetworkStatus';
import {
  fetchWithDedup,
  getCacheKey,
  invalidateCacheKey,
} from '@/lib/layout-data/fetch-cache';

export interface BadgeCounts {
  unpaid_invoices: number;
  low_stock_items: number;
}

function badgeCountsUnchanged(prev: BadgeCounts, next: BadgeCounts): boolean {
  return (
    prev.unpaid_invoices === next.unpaid_invoices &&
    prev.low_stock_items === next.low_stock_items
  );
}

const defaultBadgeCounts: BadgeCounts = {
  unpaid_invoices: 0,
  low_stock_items: 0,
};

interface BadgeContextType {
  badgeCounts: BadgeCounts;
  refreshBadgeCounts: () => Promise<void>;
}

const BadgeContext = createContext<BadgeContextType>({
  badgeCounts: defaultBadgeCounts,
  refreshBadgeCounts: async () => {},
});

export function BadgeProvider({ children }: { children: React.ReactNode }) {
  useRenderLoopProbe('BadgeProvider');
  const { business, loading: authLoading } = useAuth();
  const { isOnline, lastChangedAt } = useNetworkStatus();
  const prevOnlineRef = useRef(isOnline);
  const [badgeCounts, setBadgeCounts] = useState<BadgeCounts>(defaultBadgeCounts);

  const fetchBadgeCounts = useCallback(async (forceRefresh = false) => {
    if (authLoading || !business?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    if (forceRefresh) {
      invalidateCacheKey(getCacheKey('/api/badges/counts', { business_id: business.id }));
    }

    try {
      const res = await fetchWithDedup<BadgeCounts>('/api/badges/counts', {
        business_id: business.id,
      });

      setBadgeCounts((prev) => {
        const next = res || defaultBadgeCounts;
        if (badgeCountsUnchanged(prev, next)) return prev;
        return next;
      });
    } catch (error) {
      console.error('Failed to fetch badge counts:', error);
    }
  }, [authLoading, business?.id]);

  const refreshBadgeCounts = useCallback(async () => {
    await fetchBadgeCounts(true);
  }, [fetchBadgeCounts]);

  useEffect(() => {
    if (authLoading || !business?.id) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    void fetchBadgeCounts();
  }, [authLoading, business?.id, fetchBadgeCounts]);

  useEffect(() => {
    if (authLoading || !business?.id) return;

    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = isOnline;

    if (!isOnline || !wasOffline) return;

    void fetchBadgeCounts(true);
  }, [isOnline, lastChangedAt, authLoading, business?.id, fetchBadgeCounts]);

  useEffect(() => {
    if (business?.id) return;
    setBadgeCounts(defaultBadgeCounts);
  }, [business?.id]);

  const contextValue = useMemo<BadgeContextType>(
    () => ({
      badgeCounts,
      refreshBadgeCounts,
    }),
    [badgeCounts, refreshBadgeCounts]
  );

  return <BadgeContext.Provider value={contextValue}>{children}</BadgeContext.Provider>;
}

export const useBadges = () => useContext(BadgeContext);
