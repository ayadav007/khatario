'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, TrendingUp, X } from 'lucide-react';
import { useSubscriptionUsage } from '@/hooks/useSubscriptionUsage';
import {
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
}: {
  row: { limitType: UsageNudgeLimitType; current: number; limit: number; percent: number };
  plan: RecommendedPlan | null | undefined;
}) {
  const short = USAGE_LIMIT_SHORT_LABELS[row.limitType];
  const atLimit = row.limit !== -1 && row.current >= row.limit;
  const planHint =
    plan != null
      ? `Upgrade to ${plan.planLabel} (₹${plan.priceMonthly}/mo) for ${formatPlanLimit(plan.planLimit, row.limitType)} ${short}.`
      : 'Upgrade your plan for higher limits.';

  return (
    <span>
      <strong>
        {row.current}/{row.limit === -1 ? '∞' : row.limit}
      </strong>{' '}
      {short} — {atLimit ? 'limit reached' : `${row.percent}% used`}. {planHint}
    </span>
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

  const visibleRowsKey = useMemo(
    () =>
      visibleRows
        .map((r) => `${r.limitType}:${r.current}:${r.limit}:${r.percent}`)
        .join('|'),
    [visibleRows]
  );

  useEffect(() => {
    setDismissed(false);
  }, [businessId, highlightLimit]);

  useEffect(() => {
    // Dashboard variant does not use `plans`; never setState here — setPlans({}) allocates
    // a new object each run and visibleRows used to churn every render → infinite loop.
    if (!businessId || visibleRows.length === 0 || variant === 'dashboard') {
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
        setPlans((prev) => {
          const next = Object.fromEntries(entries) as Partial<
            Record<UsageNudgeLimitType, RecommendedPlan | null>
          >;
          if (JSON.stringify(prev) === JSON.stringify(next)) return prev;
          return next;
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [businessId, visibleRowsKey, variant]);

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
            <UsageRowContent row={row} plan={plans[row.limitType]} />
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

  const limitsSummary = visibleRows
    .map((row) => {
      const short = USAGE_LIMIT_SHORT_LABELS[row.limitType];
      const cap = row.limit === -1 ? '∞' : row.limit;
      const atLimit = row.limit !== -1 && row.current >= row.limit;
      return `${short} ${row.current}/${cap}${atLimit ? '' : ` (${row.percent}%)`}`;
    })
    .join(' · ');

  /** Dashboard: compact strip — full card was pushing KPIs and Sales insights off-screen on mobile. */
  if (variant === 'dashboard') {
    return (
      <div
        className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${shellClass} ${className}`}
        role="status"
      >
        <div className="flex min-w-0 items-center gap-2">
          {worst === 'critical' ? (
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          ) : (
            <TrendingUp className="h-4 w-4 shrink-0" aria-hidden />
          )}
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold leading-tight">
              {worst === 'critical' ? 'Plan limits reached' : 'Approaching plan limits'}
              <span className="font-normal opacity-90"> — {limitsSummary}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Link
            href="/settings/subscription"
            className={`text-xs font-semibold whitespace-nowrap hover:underline ${
              worst === 'critical' ? 'text-red-800' : 'text-amber-800'
            }`}
          >
            Upgrade
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="opacity-60 hover:opacity-100 p-0.5"
            aria-label="Dismiss"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    );
  }

  return null;
}

/** Client-only: fetches live usage limits (must not SSR). */
export const SubscriptionUsageBanner = dynamic(
  () => Promise.resolve({ default: SubscriptionUsageBannerInner }),
  { ssr: false },
);
