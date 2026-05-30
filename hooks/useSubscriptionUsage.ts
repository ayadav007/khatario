'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  USAGE_NUDGE_LIMIT_TYPES,
  type UsageNudgeLimitType,
  shouldShowUsageNudge,
  usagePercent,
} from '@/lib/subscription/usage-labels';

export interface SubscriptionUsageRow {
  limitType: UsageNudgeLimitType;
  current: number;
  limit: number;
  allowed: boolean;
  percent: number;
  showNudge: boolean;
}

export function useSubscriptionUsage(
  businessId: string | undefined,
  types: UsageNudgeLimitType[] = USAGE_NUDGE_LIMIT_TYPES,
) {
  const [rows, setRows] = useState<SubscriptionUsageRow[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!businessId) {
      setRows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const results = await Promise.all(
        types.map(async (limitType) => {
          const res = await fetch(
            `/api/subscriptions/check-limit?business_id=${encodeURIComponent(businessId)}&limit_type=${limitType}`,
            { credentials: 'include' },
          );
          if (!res.ok) {
            return null;
          }
          const data = await res.json();
          const current = Number(data.current ?? 0);
          const limit = Number(data.limit ?? 0);
          return {
            limitType,
            current,
            limit,
            allowed: Boolean(data.allowed ?? true),
            percent: usagePercent(current, limit),
            showNudge: shouldShowUsageNudge(current, limit),
          } satisfies SubscriptionUsageRow;
        }),
      );
      setRows(results.filter((r): r is SubscriptionUsageRow => r != null));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [businessId, types]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const nudgeRows = rows.filter((r) => r.showNudge);

  return { rows, nudgeRows, loading, refresh };
}
