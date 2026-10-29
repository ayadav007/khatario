'use client';

import { Crown, TrendingUp } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLayoutData } from '@/contexts/LayoutDataContext';

/** Current plan with an Upgrade action, for the desktop profile menu. */
export function SubscriptionMenuRow({ onNavigate }: { onNavigate?: () => void }) {
  const router = useRouter();
  const { subscription, loading } = useLayoutData();

  if (loading || !subscription) return null;

  const nestedPlan = subscription.plan as { code?: string; display_name?: string } | undefined;
  const planDisplayName =
    subscription.plan_display_name ||
    nestedPlan?.display_name ||
    subscription.plan_name ||
    'Free';
  const isTrial =
    (subscription.show_trial_badge === true ||
      (subscription.status === 'trial' && subscription.show_trial_badge !== false)) &&
    !/\btrial\b/i.test(planDisplayName);

  const go = () => {
    onNavigate?.();
    router.push('/settings/subscription');
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <Crown className="h-4 w-4 shrink-0 text-purple-600 dark:text-purple-400" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-text-primary">
          {planDisplayName}
          {isTrial && <span className="ml-1 text-xs font-normal text-text-muted">(Trial)</span>}
        </span>
        <span className="block text-xs text-text-muted">Current plan</span>
      </span>
      <button
        type="button"
        onClick={go}
        className="flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-r from-purple-600 to-primary-600 px-3 py-1 text-xs font-semibold text-white shadow-sm transition hover:opacity-90"
      >
        <TrendingUp className="h-3.5 w-3.5" aria-hidden />
        Upgrade
      </button>
    </div>
  );
}
