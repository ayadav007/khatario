'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, TrendingUp, X } from 'lucide-react';
import { useSubscriptionUsage } from '@/hooks/useSubscriptionUsage';
import {
  USAGE_LIMIT_LABELS,
  USAGE_LIMIT_SHORT_LABELS,
  formatPlanLimit,
  type UsageNudgeLimitType,
} from '@/lib/subscription/usage-labels';

interface RecommendedPlan {
  planId: string;
  planDisplayName: string;
  planLabel: string;
  priceMonthly: number;
  planLimit: number;
}

export interface SubscriptionUsageBannerProps {
  businessId: string | undefined;
  /** dashboard = all warnable limits; inline = one limit type on list pages */
  variant?: 'dashboard' | 'inline';
  highlightLimit?: UsageNudgeLimitType;
  className?: string;
}

function rowSeverity(current: number, max: number): 'warning' | 'critical' {
  if (max === -1) return 'warning';
  if (current >= max) return 'critical';
  return 'warning';
}

function UsageRowContent({
  row,
  plan,
  compact,
}: {
  row: { limitType: UsageNudgeLimitType; current: number; limit: number; percent: number };
  plan: RecommendedPlan | null | undefined;
  compact?: boolean;
}) {
  const label = USAGE_LIMIT_LABELS[row.limitType];
  const short = USAGE_LIMIT_SHORT_LABELS[row.limitType];
  const atLimit = row.limit !== -1 && row.current >= row.limit;
  const planHint =
    plan != null
      ? `Upgrade to ${plan.planLabel} (₹${plan.priceMonthly}/mo) for ${formatPlanLimit(plan.planLimit, row.limitType)} ${short}.`
      : 'Upgrade your plan for higher limits.';

  if (compact) {
    return (
      <span>
        <strong>
          {row.current}/{row.limit === -1 ? '∞' : row.limit}
        </strong>{' '}
        {short} — {atLimit ? 'limit reached' : `${row.percent}% used`}. {planHint}
      </span>
    );
  }

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 py-2 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-900">{label}</p>
        <p className="text-sm text-gray-600">
          {row.current} / {row.limit === -1 ? 'Unlimited' : row.limit}
          {atLimit ? ' — limit reached' : ` — ${row.percent}% used`}
        </p>
        {plan && (
          <p className="text-xs text-gray-500 mt-0.5">
            {planHint}
          </p>
        )}
      </div>
      <div className="w-full sm:w-32 h-2 bg-gray-200 rounded-full overflow-hidden shrink-0">
        <div
          className={`h-full rounded-full ${atLimit ? 'bg-red-500' : row.percent >= 90 ? 'bg-red-400' : 'bg-amber-500'}`}
          style={{ width: `${row.limit === -1 ? 0 : Math.min(row.percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function SubscriptionUsageBannerInner({
  businessId,
  variant = 'dashboard',
  highlightLimit,
  className = '',
}: SubscriptionUsageBannerProps) {
  const types = useMemo(
    () => (highlightLimit ? [highlightLimit] : undefined),
    [highlightLimit],
  );
  const { nudgeRows, loading } = useSubscriptionUsage(businessId, types);
  const [dismissed, setDismissed] = useState(false);
  const [plans, setPlans] = useState<Partial<Record<UsageNudgeLimitType, RecommendedPlan | null>>>(
    {},
  );

  const visibleRows = useMemo(() => {
    if (highlightLimit) {
      return nudgeRows.filter((r) => r.limitType === highlightLimit);
    }
    return nudgeRows;
  }, [nudgeRows, highlightLimit]);

  useEffect(() => {
    setDismissed(false);
  }, [businessId, highlightLimit]);

  useEffect(() => {
    if (!businessId || visibleRows.length === 0) {
      setPlans({});
      return;
    }

    let cancelled = false;

    void (async () => {
      const entries = await Promise.all(
        visibleRows.map(async (row) => {
          try {
            const res = await fetch(
              `/api/subscriptions/limit-plan?business_id=${encodeURIComponent(businessId)}&limit_type=${row.limitType}&current=${row.current}`,
              { credentials: 'include' },
            );
            if (!res.ok) return [row.limitType, null] as const;
            const data = await res.json();
            return [row.limitType, (data.recommendedPlan as RecommendedPlan | null) ?? null] as const;
          } catch {
            return [row.limitType, null] as const;
          }
        }),
      );
      if (!cancelled) {
        setPlans(Object.fromEntries(entries));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, visibleRows]);

  if (loading || dismissed || visibleRows.length === 0) {
    return null;
  }

  const worst = visibleRows.reduce<'warning' | 'critical'>(
    (acc, row) =>
      rowSeverity(row.current, row.limit) === 'critical' ? 'critical' : acc,
    'warning',
  );

  const shellClass =
    worst === 'critical'
      ? 'bg-red-50 border-red-200 text-red-900'
      : 'bg-amber-50 border-amber-200 text-amber-900';

  const upgradeLink = (
    <Link
      href="/settings/subscription"
      className={`text-sm font-semibold whitespace-nowrap hover:underline ${
        worst === 'critical' ? 'text-red-800' : 'text-amber-800'
      }`}
    >
      View plans
    </Link>
  );

  if (variant === 'inline' && visibleRows[0]) {
    const row = visibleRows[0];
    return (
      <div
        className={`flex items-start justify-between gap-3 rounded-lg border px-3 py-2.5 text-sm ${shellClass} ${className}`}
        role="status"
      >
        <div className="flex items-start gap-2 min-w-0">
          {worst === 'critical' ? (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
          ) : (
            <TrendingUp className="w-4 h-4 shrink-0 mt-0.5" />
          )}
          <div className="min-w-0">
            <UsageRowContent row={row} plan={plans[row.limitType]} compact />
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {upgradeLink}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="opacity-60 hover:opacity-100 p-0.5"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`rounded-xl border p-4 ${shellClass} ${className}`}
      role="status"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2">
          {worst === 'critical' ? (
            <AlertTriangle className="w-5 h-5 shrink-0" />
          ) : (
            <TrendingUp className="w-5 h-5 shrink-0" />
          )}
          <div>
            <h3 className="text-sm font-semibold">
              {worst === 'critical' ? 'Plan limits reached' : 'Approaching plan limits'}
            </h3>
            <p className="text-xs opacity-90 mt-0.5">
              Upgrade before you hit a wall — or compare plans in subscription settings.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {upgradeLink}
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="opacity-60 hover:opacity-100 p-0.5"
            aria-label="Dismiss"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      <div className="bg-white/60 rounded-lg px-3 py-1 border border-black/5">
        {visibleRows.map((row) => (
          <UsageRowContent key={row.limitType} row={row} plan={plans[row.limitType]} />
        ))}
      </div>
    </div>
  );
}

/** Client-only: fetches live usage limits (must not SSR). */
export const SubscriptionUsageBanner = dynamic(
  () => Promise.resolve({ default: SubscriptionUsageBannerInner }),
  { ssr: false },
);
