'use client';

import { useState } from 'react';
import {
  Check,
  Calendar,
  AlertTriangle,
  ChevronRight,
  Loader2,
  X,
} from 'lucide-react';
import { startPlanUpgrade } from '@/lib/subscription/client-upgrade';
import { useToastContext } from '@/contexts/ToastContext';
import { getPlanChangeAction } from '@/lib/subscription/trial-plan';

export interface SubscriptionPlanFeatures {
  limits: {
    max_invoices_per_month: number;
    max_customers: number;
    max_items: number;
    max_users: number;
    max_whatsapp_per_day: number;
  };
  features: Record<string, boolean>;
}

export interface SubscriptionAvailablePlan {
  id: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  sort_order: number;
  product_line?: string;
  features: SubscriptionPlanFeatures;
}

type DowngradeWarning = {
  limitType: string;
  currentCount: number;
  newLimit: number;
  willExceed: boolean;
  message: string;
};

export function SubscriptionChangePlanModal({
  currentPlanId,
  scheduledPlanId,
  availablePlans,
  currentPlanSortOrder,
  businessId,
  moduleKey,
  endDate,
  onClose,
  onSuccess,
}: {
  currentPlanId: string;
  scheduledPlanId: string | null;
  availablePlans: SubscriptionAvailablePlan[];
  currentPlanSortOrder: number;
  businessId: string;
  moduleKey?: string;
  endDate: string | null;
  onClose: () => void;
  onSuccess: (upgradedPlanName?: string) => void;
}) {
  const toast = useToastContext();
  const [processing, setProcessing] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState<SubscriptionAvailablePlan | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [downgradeWarnings, setDowngradeWarnings] = useState<DowngradeWarning[]>([]);
  const [warningsLoading, setWarningsLoading] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);

  function listPrice(plan: SubscriptionAvailablePlan): number {
    return billingCycle === 'yearly'
      ? Number(plan.price_yearly) || 0
      : Number(plan.price_monthly) || 0;
  }

  async function applyCouponForConfirmPlan() {
    if (!confirmPlan || !couponCode.trim()) return;
    setCouponLoading(true);
    setCouponMessage(null);
    setCouponApplied(false);
    try {
      const res = await fetch('/api/subscriptions/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          business_id: businessId,
          plan_id: confirmPlan.id,
          code: couponCode.trim(),
          billing_cycle: billingCycle,
        }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setCouponApplied(true);
        setCouponMessage(data.message || 'Coupon will apply at checkout.');
        toast.success(data.message || 'Coupon validated');
      } else {
        setCouponMessage(data.error || data.message || 'Invalid coupon');
        toast.error(data.error || 'Invalid coupon');
      }
    } catch {
      setCouponMessage('Failed to validate coupon');
    } finally {
      setCouponLoading(false);
    }
  }

  function getPlanAction(
    plan: SubscriptionAvailablePlan
  ): 'current' | 'upgrade' | 'downgrade' {
    return getPlanChangeAction(currentPlanId, currentPlanSortOrder, plan);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  async function handleSelectPlan(plan: SubscriptionAvailablePlan) {
    const action = getPlanAction(plan);
    if (action === 'current') return;

    if (action === 'downgrade') {
      setConfirmPlan(plan);
      setWarningsLoading(true);
      try {
        const res = await fetch('/api/subscriptions/downgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            business_id: businessId,
            target_plan_id: plan.id,
            module_key: moduleKey,
            confirmed: false,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || data.details || 'Could not preview downgrade');
          setConfirmPlan(null);
          return;
        }
        setDowngradeWarnings(data.warnings || []);
        setScheduledDate(data.scheduled_date || endDate);
      } catch {
        setDowngradeWarnings([]);
        setScheduledDate(endDate);
      } finally {
        setWarningsLoading(false);
      }
      return;
    }

    setConfirmPlan(plan);
    setDowngradeWarnings([]);
    setScheduledDate(null);
    setCouponCode('');
    setCouponApplied(false);
    setCouponMessage(null);
    setBillingCycle('monthly');
  }

  async function handleConfirm() {
    if (!confirmPlan) return;
    const action = getPlanAction(confirmPlan);
    setProcessing(true);

    try {
      const endpoint =
        action === 'downgrade' ? '/api/subscriptions/downgrade' : '/api/subscriptions/upgrade';
      const body =
        action === 'downgrade'
          ? {
              business_id: businessId,
              target_plan_id: confirmPlan.id,
              module_key: moduleKey,
              confirmed: true,
            }
          : { business_id: businessId, plan_id: confirmPlan.id, module_key: moduleKey };

      if (action === 'upgrade') {
        const amountInr = listPrice(confirmPlan);
        const result = await startPlanUpgrade({
          businessId,
          planId: confirmPlan.id,
          moduleKey,
          billingCycle,
          amountInr,
          couponCode: couponApplied ? couponCode.trim() : undefined,
        });
        if (result.mode === 'instant') {
          onSuccess(confirmPlan.display_name);
        }
        return;
      }

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const data = await res.json();

      if (res.ok && data.success) {
        toast.success(data.message || `Switched to ${confirmPlan.display_name} plan`);
        onSuccess();
      } else {
        toast.error(data.error || 'Failed to change plan');
      }
    } catch {
      toast.error('Failed to change plan');
    } finally {
      setProcessing(false);
    }
  }

  const confirmAction = confirmPlan ? getPlanAction(confirmPlan) : null;
  const confirmCtaLabel =
    confirmAction === 'upgrade'
      ? listPrice(confirmPlan!) > 0
        ? 'Proceed to pay'
        : 'Confirm upgrade'
      : 'Schedule downgrade';

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl bg-surface dark:bg-slate-900/95 sm:rounded-2xl">
        <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          {!confirmPlan ? (
            <>
              <div className="mb-6 flex items-start justify-between gap-3">
                <div>
                  <h2 className="settings-section-title mb-0">Change plan</h2>
                  <p className="type-body-secondary mt-1">
                    Choose the plan that fits your business needs
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  className="rounded-lg p-1 text-text-muted hover:bg-slate-100 hover:text-text-secondary dark:hover:bg-slate-800"
                  aria-label="Close"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
                {availablePlans.map((plan) => {
                  const action = getPlanAction(plan);
                  const isCurrent = action === 'current';
                  const isUpgrade = action === 'upgrade';

                  return (
                    <div
                      key={plan.id}
                      className={`flex flex-col rounded-xl border-2 p-5 ${
                        isCurrent
                          ? 'border-primary-500 bg-surface ring-2 ring-primary-200 dark:bg-slate-900/80 dark:ring-primary-800'
                          : 'border-border bg-surface hover:border-slate-400 dark:bg-slate-900/80 dark:hover:border-slate-500'
                      }`}
                    >
                      {isCurrent ? (
                        <span className="mb-2 self-start rounded-full bg-green-600 px-2 py-0.5 text-caption font-semibold text-white">
                          Current plan
                        </span>
                      ) : null}
                      <h3 className="text-base font-bold text-text-primary md:text-lg">
                        {plan.display_name}
                      </h3>
                      <p className="type-body-sm mb-3 flex-grow text-text-secondary">
                        {plan.description}
                      </p>

                      <div className="mb-4">
                        {plan.price_monthly === 0 ? (
                          <span className="text-lg font-bold text-text-primary md:text-xl">
                            Free
                          </span>
                        ) : (
                          <div>
                            <span className="text-lg font-bold text-text-primary md:text-xl">
                              ₹{plan.price_monthly}
                            </span>
                            <span className="text-caption text-text-muted md:text-sm">/month</span>
                            {plan.price_yearly > 0 ? (
                              <p className="mt-0.5 text-caption text-green-700">
                                Save{' '}
                                {Math.round(
                                  (1 - plan.price_yearly / (plan.price_monthly * 12)) * 100
                                )}
                                % yearly
                              </p>
                            ) : null}
                          </div>
                        )}
                      </div>

                      <ul className="type-body-sm mb-4 space-y-1.5 text-text-secondary">
                        {plan.features?.limits ? (
                          <>
                            <li className="flex items-center gap-1.5">
                              <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                              {plan.features.limits.max_invoices_per_month === -1
                                ? 'Unlimited invoices'
                                : `${plan.features.limits.max_invoices_per_month} invoices/mo`}
                            </li>
                            <li className="flex items-center gap-1.5">
                              <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                              {plan.features.limits.max_customers === -1
                                ? 'Unlimited customers'
                                : `${plan.features.limits.max_customers} customers`}
                            </li>
                            <li className="flex items-center gap-1.5">
                              <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                              {plan.features.limits.max_users === -1
                                ? 'Unlimited users'
                                : `${plan.features.limits.max_users} users`}
                            </li>
                          </>
                        ) : null}
                        {plan.features?.features
                          ? Object.entries(plan.features.features)
                              .filter(([, v]) => v)
                              .slice(0, 4)
                              .map(([key]) => (
                                <li key={key} className="flex items-center gap-1.5">
                                  <Check className="h-3.5 w-3.5 shrink-0 text-green-600" />
                                  {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                                </li>
                              ))
                          : null}
                      </ul>

                      {isCurrent ? (
                        <button
                          type="button"
                          disabled
                          className="w-full cursor-default rounded-lg border border-border bg-gray-100 py-2 text-sm font-semibold text-text-secondary dark:bg-slate-800"
                        >
                          Current plan
                        </button>
                      ) : scheduledPlanId === plan.id ? (
                        <button
                          type="button"
                          disabled
                          className="w-full cursor-default rounded-lg border border-amber-300 bg-amber-50 py-2 text-sm font-semibold text-amber-800"
                        >
                          Scheduled
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSelectPlan(plan)}
                          className={`w-full rounded-lg py-2 text-sm font-semibold transition ${
                            isUpgrade
                              ? 'bg-primary-600 text-white hover:bg-primary-700'
                              : 'border border-border bg-gray-100 text-text-secondary hover:bg-gray-200 dark:bg-slate-800 dark:hover:bg-slate-700'
                          }`}
                        >
                          {isUpgrade ? 'Upgrade' : 'Downgrade'}
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <>
              <div className="mb-6 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="settings-section-title mb-0">
                    Confirm {confirmAction === 'upgrade' ? 'upgrade' : 'downgrade'}
                  </h2>
                  <p className="type-body-secondary mt-1">
                    {confirmAction === 'upgrade'
                      ? `You're upgrading to ${confirmPlan.display_name}`
                      : `You're downgrading to ${confirmPlan.display_name}`}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setConfirmPlan(null)}
                  className="shrink-0 rounded-lg p-1 text-text-muted hover:bg-slate-100 hover:text-text-secondary dark:hover:bg-slate-800"
                  aria-label="Back to plan list"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mb-6 rounded-xl border border-border bg-gray-50 p-5 dark:bg-slate-800/50">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="type-label text-text-muted">New plan</p>
                    <p className="text-lg font-bold text-text-primary md:text-xl">
                      {confirmPlan.display_name}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    {listPrice(confirmPlan) === 0 ? (
                      <p className="text-lg font-bold text-text-primary md:text-xl">Free</p>
                    ) : (
                      <p className="text-lg font-bold text-text-primary md:text-xl">
                        ₹{listPrice(confirmPlan).toLocaleString('en-IN')}
                        <span className="text-caption font-normal text-text-muted md:text-sm">
                          /{billingCycle === 'yearly' ? 'yr' : 'mo'}
                        </span>
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {confirmAction === 'upgrade' && listPrice(confirmPlan) > 0 ? (
                <div className="mb-6 space-y-4">
                  <div>
                    <p className="type-label mb-2 text-text-secondary">Billing cycle</p>
                    <div className="flex flex-col gap-2 sm:flex-row">
                      <button
                        type="button"
                        onClick={() => {
                          setBillingCycle('monthly');
                          setCouponApplied(false);
                          setCouponMessage(null);
                        }}
                        className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition ${
                          billingCycle === 'monthly'
                            ? 'border-gray-900 bg-gray-900 text-white'
                            : 'border-border bg-surface text-text-secondary'
                        }`}
                      >
                        Monthly · ₹{confirmPlan.price_monthly}/mo
                      </button>
                      {confirmPlan.price_yearly > 0 ? (
                        <button
                          type="button"
                          onClick={() => {
                            setBillingCycle('yearly');
                            setCouponApplied(false);
                            setCouponMessage(null);
                          }}
                          className={`flex-1 rounded-lg border py-2.5 text-sm font-semibold transition ${
                            billingCycle === 'yearly'
                              ? 'border-gray-900 bg-gray-900 text-white'
                              : 'border-border bg-surface text-text-secondary'
                          }`}
                        >
                          Yearly · ₹{confirmPlan.price_yearly}/yr
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <p className="type-label mb-2 text-text-secondary">Coupon code</p>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={couponCode}
                        onChange={(e) => {
                          setCouponCode(e.target.value.toUpperCase());
                          setCouponApplied(false);
                          setCouponMessage(null);
                        }}
                        placeholder="Enter code"
                        className="input min-h-10 flex-1 py-2 text-sm"
                      />
                      <button
                        type="button"
                        onClick={applyCouponForConfirmPlan}
                        disabled={couponLoading || !couponCode.trim()}
                        className="shrink-0 rounded-lg border border-border bg-gray-100 px-4 py-2 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-800"
                      >
                        {couponLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          'Apply'
                        )}
                      </button>
                    </div>
                    {couponMessage ? (
                      <p
                        className={`mt-1.5 text-caption ${
                          couponApplied ? 'text-green-700' : 'text-red-600'
                        }`}
                      >
                        {couponMessage}
                      </p>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {confirmAction === 'downgrade' ? (
                <div className="mb-6 space-y-3">
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                    <div className="mb-1 flex items-center gap-2 font-semibold">
                      <Calendar className="h-4 w-4 shrink-0" />
                      Scheduled downgrade
                    </div>
                    Your current plan will remain active until{' '}
                    <strong>{formatDate(scheduledDate)}</strong>. After that, you&apos;ll
                    automatically be moved to {confirmPlan.display_name}.
                  </div>

                  {warningsLoading ? (
                    <div className="flex items-center gap-2 text-text-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Checking impact on your data...
                    </div>
                  ) : downgradeWarnings.some((w) => w.willExceed) ? (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                      <div className="mb-2 flex items-center gap-2 font-semibold text-amber-800">
                        <AlertTriangle className="h-5 w-5 shrink-0" />
                        Data impact warnings
                      </div>
                      <ul className="space-y-1 text-sm text-amber-800">
                        {downgradeWarnings
                          .filter((w) => w.willExceed)
                          .map((w, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="mt-0.5">•</span>
                              <span>
                                {w.message} ({w.currentCount} current /{' '}
                                {w.newLimit === -1 ? 'unlimited' : w.newLimit} allowed)
                              </span>
                            </li>
                          ))}
                      </ul>
                      <p className="mt-2 text-caption text-amber-700">
                        Your existing data won&apos;t be deleted, but you won&apos;t be able to
                        create new records above the plan limits after the switch.
                      </p>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm text-green-800">
                      No data impact detected. You can safely switch to this plan.
                    </div>
                  )}
                </div>
              ) : null}

              {confirmAction === 'upgrade' ? (
                <div className="mb-6 rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
                  {listPrice(confirmPlan) > 0
                    ? `You'll be redirected to secure payment. After payment, ${confirmPlan.display_name} features unlock immediately.`
                    : `Your plan will be upgraded immediately with access to all ${confirmPlan.display_name} features.`}
                </div>
              ) : null}
            </>
          )}
        </div>

        {confirmPlan ? (
          <div className="shrink-0 border-t border-border bg-surface p-4 dark:bg-slate-900/95 sm:p-6">
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:gap-3">
              <button
                type="button"
                onClick={() => setConfirmPlan(null)}
                className="w-full rounded-lg border border-border bg-gray-100 py-3 text-sm font-semibold text-text-secondary transition hover:bg-gray-200 disabled:opacity-50 dark:bg-slate-800 dark:hover:bg-slate-700 sm:flex-1"
                disabled={processing}
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={processing || warningsLoading}
                className={`flex w-full items-center justify-center gap-2 rounded-lg py-3 text-sm font-semibold transition disabled:opacity-50 sm:flex-1 ${
                  confirmAction === 'upgrade'
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-amber-600 text-white hover:bg-amber-700'
                }`}
              >
                {processing ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : (
                  <>
                    <span className="min-w-0">{confirmCtaLabel}</span>
                    <ChevronRight className="hidden h-4 w-4 shrink-0 sm:block" />
                  </>
                )}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
