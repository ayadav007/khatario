'use client';

import { Crown, TrendingUp, Sparkles, Zap } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useLayoutData } from '@/contexts/LayoutDataContext';

interface SubscriptionBadgeProps {
  businessId: string;
}

export function SubscriptionBadge({ businessId }: SubscriptionBadgeProps) {
  const router = useRouter();
  const { subscription, loading } = useLayoutData();

  if (loading || !subscription) return null;

  const planCode = (
    subscription?.plan_name ||
    subscription?.plan_id ||
    subscription?.plan?.code ||
    'free'
  ).toLowerCase();
  const planDisplayName =
    subscription?.plan_display_name ||
    subscription?.plan?.display_name ||
    subscription?.plan_name ||
    'Free';

  const showTrialBadge =
    subscription?.show_trial_badge === true ||
    (subscription?.status === 'trial' &&
      subscription?.show_trial_badge !== false);

  const planConfig: Record<
    string,
    {
      icon: React.ReactNode;
      colorClass: string;
    }
  > = {
    free: {
      icon: null,
      colorClass: 'bg-gray-100 text-gray-800 border-gray-300',
    },
    trial: {
      icon: <Sparkles className="w-3.5 h-3.5" />,
      colorClass: 'bg-slate-100 text-slate-800 border-slate-300',
    },
    professional: {
      icon: <Sparkles className="w-3.5 h-3.5" />,
      colorClass: 'bg-primary-600 text-white border-primary-600',
    },
    business: {
      icon: <Zap className="w-3.5 h-3.5" />,
      colorClass: 'bg-purple-600 text-white border-purple-600',
    },
    enterprise: {
      icon: <Crown className="w-3.5 h-3.5" />,
      colorClass: 'bg-gradient-to-r from-purple-600 to-primary-600 text-white border-purple-600',
    },
  };

  const config = planConfig[planCode] || planConfig.free;

  return (
    <button
      onClick={() => router.push('/settings/subscription')}
      className={`flex items-center space-x-2 px-3 py-1.5 rounded-full text-xs font-semibold border-2 transition hover:scale-105 shadow-sm ${config.colorClass}`}
      title="Click to view subscription details"
    >
      {config.icon}
      <span>{planDisplayName}</span>
      {showTrialBadge && planCode !== 'free' && (
        <span className="ml-1 opacity-90">(Trial)</span>
      )}
      {planCode !== 'enterprise' && planCode !== 'free' && (
        <TrendingUp className="w-3.5 h-3.5 ml-1 opacity-80" />
      )}
    </button>
  );
}
