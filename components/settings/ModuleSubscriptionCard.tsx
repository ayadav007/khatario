'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  CreditCard,
  TrendingUp,
  Zap,
  ArrowDown,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import { Button } from '@/components/ui/Button';
import {
  SubscriptionChangePlanModal,
  type SubscriptionAvailablePlan,
} from '@/components/subscription/SubscriptionChangePlanModal';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';
import { productLineForModule } from '@/lib/platform-modules';
import type { PlatformModule } from '@/lib/platform-modules';

export type ModuleSubscriptionDetail = {
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  trial_end_date: string | null;
  scheduled_plan_id: string | null;
  billing_cycle: 'monthly' | 'yearly';
  plan_display_name: string;
  plan_description: string;
  price_monthly: number;
  price_yearly: number;
  features: {
    limits: Record<string, number>;
  };
  trial_days_remaining: number | null;
  is_operational: boolean;
  cancel_at_period_end?: boolean;
};

type UsageRow = {
  limit_type: string;
  current_count: number;
  max_limit: number;
};

const LIMIT_LABELS: Record<string, string> = {
  invoices: 'Invoices/mo',
  customers: 'Customers',
  items: 'Items',
  employees: 'Employees',
  whatsapp: 'WhatsApp/day',
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function ModuleSubscriptionCard({
  moduleKey,
  label,
  subscription,
  usage,
  availablePlans,
  businessId,
  onPlanChanged,
  onCancelDowngrade,
  onCancelSubscription,
  cancellingDowngrade,
  cancellingSubscription,
}: {
  moduleKey: PlatformModule;
  label: string;
  subscription: ModuleSubscriptionDetail | null;
  usage: UsageRow[];
  availablePlans: SubscriptionAvailablePlan[];
  businessId: string;
  onPlanChanged: () => void;
  onCancelDowngrade: (moduleKey: PlatformModule) => void;
  onCancelSubscription: (moduleKey: PlatformModule) => void;
  cancellingDowngrade: boolean;
  cancellingSubscription: boolean;
}) {
  const [showModal, setShowModal] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);

  const productLine = productLineForModule(moduleKey);

  const plansForModule = useMemo(() => {
    return availablePlans.filter((p) => {
      const line = p.product_line ?? 'billing';
      if (line !== productLine) return false;
      if (p.id === TRIAL_PLAN_ID || p.id === 'hr_trial') {
        return subscription?.plan_id === p.id;
      }
      if (p.id === 'connect') return subscription?.plan_id === 'connect';
      return true;
    });
  }, [availablePlans, productLine, subscription?.plan_id]);

  const currentPlanSortOrder = useMemo(
    () => plansForModule.find((p) => p.id === subscription?.plan_id)?.sort_order ?? 0,
    [plansForModule, subscription?.plan_id],
  );

  if (!subscription) {
    return (
      <div className="rounded-xl border border-border bg-surface p-5">
        <h3 className="font-semibold text-text-primary">{label}</h3>
        <p className="mt-2 text-sm text-text-secondary">No subscription row yet for this product.</p>
        <Link href="/settings/products" className="link-primary mt-3 inline-block text-sm">
          Manage products
        </Link>
      </div>
    );
  }

  const isFree =
    subscription.plan_id === 'free' ||
    subscription.plan_id === 'hr_free' ||
    (moduleKey === 'connect' && Number(subscription.price_monthly) === 0);

  const isCancelled = Boolean(subscription.cancel_at_period_end);

  const limitTiles = usage.slice(0, 4);

  return (
    <>
      <div className="rounded-2xl border border-border bg-surface p-6 shadow-sm">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <div className="shrink-0 rounded-lg bg-slate-800 p-2 dark:bg-slate-700">
              <CreditCard className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">{label}</p>
              <h2 className="settings-section-title mb-0">{subscription.plan_display_name}</h2>
              <p className="text-sm text-text-secondary">{subscription.plan_description}</p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => setShowModal(true)}
            className="shrink-0 gap-1.5 whitespace-nowrap"
          >
            <TrendingUp className="h-3.5 w-3.5" />
            Change plan
          </Button>
        </div>

        <div className="mb-4">
          {isFree ? (
            <div className="flex items-baseline gap-2">
              <span className="type-kpi-value">Free</span>
              <span className="text-text-secondary">for this product</span>
            </div>
          ) : (
            <div className="flex items-baseline gap-2">
              <span className="type-kpi-value">₹{subscription.price_monthly}</span>
              <span className="text-text-secondary">/month</span>
            </div>
          )}
        </div>

        {subscription.trial_days_remaining != null && subscription.trial_days_remaining > 0 ? (
          <div className="mb-4 rounded-lg border border-yellow-300 bg-yellow-100 p-3">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-600" />
              <p className="text-sm font-medium text-yellow-800">
                {subscription.trial_days_remaining} days left in {label} trial
              </p>
            </div>
          </div>
        ) : null}

        {limitTiles.length > 0 ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {limitTiles.map((row) => (
              <div
                key={row.limit_type}
                className="rounded-lg border border-border bg-white p-3 dark:bg-slate-900/40"
              >
                <p className="mb-0.5 text-xs text-text-muted">
                  {LIMIT_LABELS[row.limit_type] ?? row.limit_type}
                </p>
                <p className="text-lg font-bold text-text-primary md:text-xl">
                  {row.max_limit === -1 ? '∞' : `${row.current_count}/${row.max_limit}`}
                </p>
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs text-text-muted">Renewal</p>
            <p className="font-semibold text-text-primary">
              {subscription.end_date ? formatDate(subscription.end_date) : 'No expiry'}
            </p>
          </div>
          <div className="rounded-lg bg-gray-50 p-3 dark:bg-slate-800/50">
            <p className="text-xs text-text-muted">Cycle</p>
            <p className="font-semibold text-text-primary">
              {isFree ? 'Free' : subscription.billing_cycle === 'yearly' ? 'Yearly' : 'Monthly'}
            </p>
          </div>
        </div>

        {subscription.scheduled_plan_id ? (
          <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="mb-1 flex items-center gap-2">
              <ArrowDown className="h-4 w-4 text-amber-600" />
              <p className="text-xs font-medium text-amber-800">
                Downgrade to{' '}
                <strong>
                  {plansForModule.find((p) => p.id === subscription.scheduled_plan_id)
                    ?.display_name || subscription.scheduled_plan_id}
                </strong>{' '}
                on {formatDate(subscription.end_date)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onCancelDowngrade(moduleKey)}
              disabled={cancellingDowngrade}
              className="text-xs font-medium text-amber-700 underline hover:text-amber-900 disabled:opacity-50"
            >
              {cancellingDowngrade ? (
                <span className="inline-flex items-center gap-1">
                  <Loader2 className="h-3 w-3 animate-spin" /> Cancelling…
                </span>
              ) : (
                'Cancel scheduled downgrade'
              )}
            </button>
          </div>
        ) : null}

        {isCancelled ? (
          <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Cancellation scheduled — access continues until{' '}
            {formatDate(subscription.end_date)}. You will move to the free plan after that.
          </div>
        ) : null}

        {!isFree && !isCancelled ? (
          <div className="mt-4 border-t border-border pt-4">
            <button
              type="button"
              onClick={() => setShowCancelDialog(true)}
              className="text-sm font-medium text-red-600 hover:text-red-700"
            >
              Cancel {label} subscription
            </button>
          </div>
        ) : null}
      </div>

      {showCancelDialog ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 dark:bg-slate-900">
            <div className="mb-4 flex items-center gap-3">
              <div className="rounded-full bg-red-100 p-2">
                <AlertTriangle className="h-5 w-5 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-text-primary">Cancel {label}?</h3>
            </div>
            <p className="mb-4 text-sm text-text-secondary">
              Your {label} plan stays active until{' '}
              {subscription.end_date ? formatDate(subscription.end_date) : 'the end of the billing period'}.
              After that you will move to the free tier for this product.
            </p>
            <div className="flex justify-end gap-3">
              <Button variant="secondary" size="sm" onClick={() => setShowCancelDialog(false)}>
                Keep plan
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="border-red-300 text-red-600 hover:bg-red-50"
                disabled={cancellingSubscription}
                onClick={() => {
                  onCancelSubscription(moduleKey);
                  setShowCancelDialog(false);
                }}
              >
                {cancellingSubscription ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Confirm cancel
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {showModal ? (
        <SubscriptionChangePlanModal
          currentPlanId={subscription.plan_id}
          scheduledPlanId={subscription.scheduled_plan_id}
          availablePlans={plansForModule}
          currentPlanSortOrder={currentPlanSortOrder}
          businessId={businessId}
          moduleKey={moduleKey}
          endDate={subscription.end_date}
          onClose={() => setShowModal(false)}
          onSuccess={(name) => {
            setShowModal(false);
            onPlanChanged();
            if (name) {
              /* celebration handled by parent if needed */
            }
          }}
        />
      ) : null}
    </>
  );
}
