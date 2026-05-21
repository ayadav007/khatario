'use client';

import { useState, useEffect } from 'react';
import { AlertTriangle, Clock, X, ArrowRight, Shield } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { getSubscriptionBannerPlacement } from '@/lib/mobile-navigation';
import { clsx } from 'clsx';
import {
  parseLocalDateOnly,
  startOfLocalToday,
} from '@/lib/subscription/date-only';

interface SubscriptionStatus {
  plan_id: string;
  status: string;
  trial_end_date: string | null;
  end_date: string | null;
  cancel_at_period_end: boolean;
  grace_period_end: string | null;
}

type BannerType = 'trial_ending' | 'trial_expired' | 'grace_expiring' | 'grace_expired' | 'cancelled' | null;

export function SubscriptionBanner() {
  const { business } = useAuth();
  const pathname = usePathname();
  const placement = getSubscriptionBannerPlacement(pathname);
  const [dismissed, setDismissed] = useState(false);
  const [bannerType, setBannerType] = useState<BannerType>(null);
  const [daysRemaining, setDaysRemaining] = useState(0);
  const [cancelDate, setCancelDate] = useState('');

  useEffect(() => {
    if (!business?.id) return;

    fetch(`/api/subscriptions/current?business_id=${business.id}`)
      .then((res) => res.json())
      .then((data) => {
        const sub = data.subscription;
        if (!sub) return;

        const now = new Date();

        if (sub.cancel_at_period_end && sub.end_date) {
          const end = new Date(sub.end_date);
          if (end > now) {
            setCancelDate(
              end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
            );
            setBannerType('cancelled');
            return;
          }
        }

        if (sub.show_trial_extension_modal) {
          return;
        }

        if (sub.grace_period_end) {
          const graceEnd = new Date(sub.grace_period_end);
          if (graceEnd > now) {
            setDaysRemaining(Math.ceil((graceEnd.getTime() - now.getTime()) / 86400000));
            setBannerType('grace_expiring');
            return;
          }
          if (sub.status === 'expired' || sub.plan_id === 'free') {
            if (sub.downgraded_from) {
              setBannerType('grace_expired');
              return;
            }
          }
        }

        if (sub.trial_end_date) {
          const trialEnd = parseLocalDateOnly(sub.trial_end_date);
          if (!trialEnd) return;

          const today = startOfLocalToday();
          const msPerDay = 86400000;
          const days = Math.ceil((trialEnd.getTime() - today.getTime()) / msPerDay);

          if (days < 0) {
            if (!sub.show_trial_extension_modal) {
              setBannerType('trial_expired');
            }
          } else if (days === 0) {
            setDaysRemaining(0);
            setBannerType('trial_ending');
          } else if (days <= 7) {
            setDaysRemaining(days);
            setBannerType('trial_ending');
          }
        }
      })
      .catch(() => {});
  }, [business?.id]);

  if (placement === 'hidden' || dismissed || !bannerType) return null;

  /** Compact strip on non-dashboard routes; full strip on dashboard only */
  if (placement === 'compact' && bannerType !== 'trial_ending' && bannerType !== 'grace_expiring') {
    return null;
  }

  const configs: Record<
    NonNullable<BannerType>,
    {
      bg: string;
      border: string;
      text: string;
      icon: React.ReactNode;
      message: string;
      cta: string;
    }
  > = {
    trial_ending: {
      bg: 'bg-yellow-50',
      border: 'border-yellow-300',
      text: 'text-yellow-800',
      icon: <Clock className="w-4 h-4" />,
      message: `Your trial ends in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}. Upgrade to keep full access.`,
      cta: 'Upgrade Now',
    },
    trial_expired: {
      bg: 'bg-orange-50',
      border: 'border-orange-300',
      text: 'text-orange-800',
      icon: <AlertTriangle className="w-4 h-4" />,
      message:
        'Your trial has expired. You are on the Free plan — upgrade anytime to restore full access.',
      cta: 'Upgrade Now',
    },
    grace_expiring: {
      bg: 'bg-orange-50',
      border: 'border-orange-400',
      text: 'text-orange-900',
      icon: <AlertTriangle className="w-4 h-4" />,
      message: `Grace period: ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} remaining. After this, your account will be restricted to the free plan.`,
      cta: 'Upgrade Now',
    },
    grace_expired: {
      bg: 'bg-red-50',
      border: 'border-red-300',
      text: 'text-red-800',
      icon: <Shield className="w-4 h-4" />,
      message: 'Your account has been restricted to the free plan. Upgrade to restore full access.',
      cta: 'Upgrade',
    },
    cancelled: {
      bg: 'bg-blue-50',
      border: 'border-blue-300',
      text: 'text-blue-800',
      icon: <Clock className="w-4 h-4" />,
      message: `Your subscription will end on ${cancelDate}. You have full access until then.`,
      cta: 'Reactivate',
    },
  };

  const config = configs[bannerType];
  const isCompact = placement === 'compact';

  return (
    <div
      className={clsx(
        config.bg,
        config.border,
        'border-b',
        isCompact ? 'px-3 py-1.5 lg:hidden' : 'px-4 py-2.5'
      )}
    >
      <div className="flex items-center justify-between gap-2 max-w-7xl mx-auto">
        <div
          className={clsx(
            'flex min-w-0 items-center gap-1.5',
            config.text,
            isCompact ? 'text-xs' : 'text-sm'
          )}
        >
          {config.icon}
          <span className="font-medium truncate">
            {isCompact
              ? `Trial ends in ${daysRemaining}d — upgrade to keep access`
              : config.message}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/settings/subscription"
            className={clsx(
              config.text,
              'font-semibold hover:underline flex items-center gap-0.5 whitespace-nowrap',
              isCompact ? 'text-xs' : 'text-sm'
            )}
          >
            {config.cta}
            {!isCompact && <ArrowRight className="w-3.5 h-3.5" />}
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className={clsx(config.text, 'opacity-60 hover:opacity-100 p-0.5')}
            aria-label="Dismiss"
          >
            <X className={isCompact ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
          </button>
        </div>
      </div>
    </div>
  );
}
