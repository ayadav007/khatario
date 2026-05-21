'use client';

import { useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { startPlanUpgrade } from '@/lib/subscription/client-upgrade';
import { useToastContext } from '@/contexts/ToastContext';
import { TRIAL_PLAN_ID, getPlanChangeAction } from '@/lib/subscription/trial-plan';
import { CreditCard, TrendingUp, Check, Zap, AlertCircle, ArrowRight, ArrowDown, MessageSquare, Lock, Calendar, Clock, X, Loader2, History, Tag, AlertTriangle, ChevronRight } from 'lucide-react';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import { CelebrationOverlay } from '@/components/ui/CelebrationOverlay';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';

interface CurrentSubscription {
  subscription_id: string;
  business_id: string;
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  trial_end_date: string | null;
  plan_name: string;
  plan_display_name: string;
  plan_description: string;
  price_monthly: number;
  price_yearly: number;
  currency: string;
  features: {
    limits: {
      max_invoices_per_month: number;
      max_customers: number;
      max_items: number;
      max_users: number;
      max_whatsapp_per_day: number;
    };
    features: Record<string, boolean>;
  };
  trial_days_remaining: number | null;
  scheduled_plan_id: string | null;
  billing_cycle: 'monthly' | 'yearly';
  grace_period_end?: string | null;
  cancel_at_period_end?: boolean;
  is_operational?: boolean;
  is_grace_period_active?: boolean;
  grace_days_remaining?: number | null;
  enabled_features: { id: string; label: string; category: string; description: string | null }[];
}

interface AvailablePlan {
  id: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  sort_order: number;
  features: CurrentSubscription['features'];
}

interface UsageData {
  limit_type: string;
  current_count: number;
  max_limit: number;
  allowed: boolean;
}

interface BillingRecord {
  date: string;
  description: string;
  amount: number;
  status: string;
}

function ChangePlanModal({
  currentPlanId,
  scheduledPlanId,
  availablePlans,
  currentPlanSortOrder,
  businessId,
  endDate,
  onClose,
  onSuccess,
}: {
  currentPlanId: string;
  scheduledPlanId: string | null;
  availablePlans: AvailablePlan[];
  /** From full plan list — used with {@link getPlanChangeAction} (Trial is special-cased). */
  currentPlanSortOrder: number;
  businessId: string;
  endDate: string | null;
  onClose: () => void;
  onSuccess: (upgradedPlanName?: string) => void;
}) {
  const toast = useToastContext();
  const [processing, setProcessing] = useState(false);
  const [confirmPlan, setConfirmPlan] = useState<AvailablePlan | null>(null);
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [downgradeWarnings, setDowngradeWarnings] = useState<{ limitType: string; currentCount: number; newLimit: number; willExceed: boolean; message: string }[]>([]);
  const [warningsLoading, setWarningsLoading] = useState(false);
  const [scheduledDate, setScheduledDate] = useState<string | null>(null);

  function listPrice(plan: AvailablePlan): number {
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

  function getPlanAction(plan: AvailablePlan): 'current' | 'upgrade' | 'downgrade' {
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

  async function handleSelectPlan(plan: AvailablePlan) {
    const action = getPlanAction(plan);
    if (action === 'current') return;

    if (action === 'downgrade') {
      setConfirmPlan(plan);
      setWarningsLoading(true);
      try {
        const res = await fetch('/api/subscriptions/downgrade', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ business_id: businessId, target_plan_id: plan.id, confirmed: false }),
        });
        const data = await res.json();
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
      const endpoint = action === 'downgrade' ? '/api/subscriptions/downgrade' : '/api/subscriptions/upgrade';
      const body =
        action === 'downgrade'
          ? { business_id: businessId, target_plan_id: confirmPlan.id, confirmed: true }
          : { business_id: businessId, plan_id: confirmPlan.id };

      if (action === 'upgrade') {
        const amountInr = listPrice(confirmPlan);
        const result = await startPlanUpgrade({
          businessId,
          planId: confirmPlan.id,
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

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-surface dark:bg-slate-900/80 rounded-2xl max-w-5xl w-full max-h-[90vh] overflow-y-auto p-6">
        {!confirmPlan ? (
          <>
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-text-primary">Change Plan</h2>
                <p className="text-text-secondary mt-1">Choose the plan that fits your business needs</p>
              </div>
              <button onClick={onClose} className="text-text-muted hover:text-text-secondary text-2xl">×</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {availablePlans.map((plan) => {
                const action = getPlanAction(plan);
                const isCurrent = action === 'current';
                const isUpgrade = action === 'upgrade';

                return (
                  <div
                    key={plan.id}
                    className={`border-2 rounded-xl p-5 flex flex-col ${
                      isCurrent
                        ? 'border-primary-500 bg-surface dark:bg-slate-900/80 ring-2 ring-primary-200 dark:ring-primary-800'
                        : 'border-border bg-surface dark:bg-slate-900/80 hover:border-slate-400 dark:hover:border-slate-500'
                    }`}
                  >
                    {isCurrent && (
                      <span className="self-start text-xs font-semibold bg-green-600 text-white px-2 py-0.5 rounded-full mb-2">
                        Current Plan
                      </span>
                    )}
                    <h3 className="text-lg font-bold text-text-primary">{plan.display_name}</h3>
                    <p className="text-sm text-text-secondary mb-3 flex-grow">{plan.description}</p>

                    <div className="mb-4">
                      {plan.price_monthly === 0 ? (
                        <span className="text-2xl font-bold text-text-primary">Free</span>
                      ) : (
                        <div>
                          <span className="text-2xl font-bold text-text-primary">₹{plan.price_monthly}</span>
                          <span className="text-text-muted text-sm">/month</span>
                          {plan.price_yearly > 0 && (
                            <p className="text-xs text-green-600 mt-0.5">
                              Save {Math.round((1 - plan.price_yearly / (plan.price_monthly * 12)) * 100)}% yearly
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    <ul className="space-y-1.5 mb-4 text-xs text-text-secondary">
                      {plan.features?.limits && (
                        <>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-green-500" />
                            {plan.features.limits.max_invoices_per_month === -1
                              ? 'Unlimited invoices'
                              : `${plan.features.limits.max_invoices_per_month} invoices/mo`}
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-green-500" />
                            {plan.features.limits.max_customers === -1
                              ? 'Unlimited customers'
                              : `${plan.features.limits.max_customers} customers`}
                          </li>
                          <li className="flex items-center gap-1.5">
                            <Check className="w-3.5 h-3.5 text-green-500" />
                            {plan.features.limits.max_users === -1
                              ? 'Unlimited users'
                              : `${plan.features.limits.max_users} users`}
                          </li>
                        </>
                      )}
                      {plan.features?.features &&
                        Object.entries(plan.features.features)
                          .filter(([, v]) => v)
                          .slice(0, 4)
                          .map(([key]) => (
                            <li key={key} className="flex items-center gap-1.5">
                              <Check className="w-3.5 h-3.5 text-green-500" />
                              {key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}
                            </li>
                          ))}
                    </ul>

                    {isCurrent ? (
                      <button disabled className="w-full py-2 rounded-lg font-semibold bg-gray-100 text-gray-700 border border-gray-300 cursor-default text-sm">
                        Current Plan
                      </button>
                    ) : scheduledPlanId === plan.id ? (
                      <button disabled className="w-full py-2 rounded-lg font-semibold bg-amber-100 text-amber-700 border border-amber-300 cursor-default text-sm">
                        Scheduled
                      </button>
                    ) : (
                      <button
                        onClick={() => handleSelectPlan(plan)}
                        className={`w-full py-2 rounded-lg font-semibold transition text-sm ${
                          isUpgrade
                            ? 'bg-primary-600 text-white hover:bg-primary-700'
                            : 'bg-gray-100 dark:bg-slate-800 text-text-secondary hover:bg-gray-200 dark:hover:bg-slate-700 border border-border'
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
            <div className="flex justify-between items-start mb-6">
              <div>
                <h2 className="text-2xl font-bold text-text-primary">
                  Confirm {getPlanAction(confirmPlan) === 'upgrade' ? 'Upgrade' : 'Downgrade'}
                </h2>
                <p className="text-text-secondary mt-1">
                  {getPlanAction(confirmPlan) === 'upgrade'
                    ? `You're upgrading to ${confirmPlan.display_name}`
                    : `You're downgrading to ${confirmPlan.display_name}`}
                </p>
              </div>
              <button onClick={() => setConfirmPlan(null)} className="text-text-muted hover:text-text-secondary text-2xl">×</button>
            </div>

            <div className="bg-gray-50 dark:bg-slate-800/50 border rounded-xl p-5 mb-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-muted">New Plan</p>
                  <p className="text-xl font-bold text-text-primary">{confirmPlan.display_name}</p>
                </div>
                <div className="text-right">
                  {listPrice(confirmPlan) === 0 ? (
                    <p className="text-xl font-bold text-text-primary">Free</p>
                  ) : (
                    <p className="text-xl font-bold text-text-primary">
                      ₹{listPrice(confirmPlan).toLocaleString('en-IN')}
                      <span className="text-sm font-normal text-text-muted">
                        /{billingCycle === 'yearly' ? 'yr' : 'mo'}
                      </span>
                    </p>
                  )}
                </div>
              </div>
            </div>

            {getPlanAction(confirmPlan) === 'upgrade' && listPrice(confirmPlan) > 0 && (
              <div className="mb-6 space-y-4">
                <div>
                  <p className="text-sm font-medium text-text-secondary mb-2">Billing cycle</p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setBillingCycle('monthly');
                        setCouponApplied(false);
                        setCouponMessage(null);
                      }}
                      className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${
                        billingCycle === 'monthly'
                          ? 'bg-gray-900 text-white border-gray-900'
                          : 'bg-surface border-border text-text-secondary'
                      }`}
                    >
                      Monthly · ₹{confirmPlan.price_monthly}/mo
                    </button>
                    {confirmPlan.price_yearly > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setBillingCycle('yearly');
                          setCouponApplied(false);
                          setCouponMessage(null);
                        }}
                        className={`flex-1 py-2 rounded-lg text-sm font-semibold border transition ${
                          billingCycle === 'yearly'
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-surface border-border text-text-secondary'
                        }`}
                      >
                        Yearly · ₹{confirmPlan.price_yearly}/yr
                      </button>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-sm font-medium text-text-secondary mb-2">Coupon code</p>
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
                      className="flex-1 px-3 py-2 border border-border rounded-lg text-sm"
                    />
                    <button
                      type="button"
                      onClick={applyCouponForConfirmPlan}
                      disabled={couponLoading || !couponCode.trim()}
                      className="px-4 py-2 rounded-lg text-sm font-semibold bg-gray-100 border border-border hover:bg-gray-200 disabled:opacity-50"
                    >
                      {couponLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                    </button>
                  </div>
                  {couponMessage && (
                    <p
                      className={`text-xs mt-1.5 ${
                        couponApplied ? 'text-green-700' : 'text-red-600'
                      }`}
                    >
                      {couponMessage}
                    </p>
                  )}
                </div>
              </div>
            )}

            {getPlanAction(confirmPlan) === 'downgrade' && (
              <div className="mb-6 space-y-3">
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-sm text-blue-700">
                  <div className="flex items-center gap-2 font-semibold mb-1">
                    <Calendar className="w-4 h-4" />
                    Scheduled Downgrade
                  </div>
                  Your current plan will remain active until <strong>{formatDate(scheduledDate)}</strong>.
                  After that, you'll automatically be moved to {confirmPlan.display_name}.
                </div>

                {warningsLoading ? (
                  <div className="flex items-center gap-2 text-text-muted">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking impact on your data...
                  </div>
                ) : downgradeWarnings.some((w) => w.willExceed) ? (
                  <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                    <div className="flex items-center gap-2 text-amber-700 font-semibold mb-2">
                      <AlertTriangle className="w-5 h-5" />
                      Data Impact Warnings
                    </div>
                    <ul className="space-y-1 text-sm text-amber-700">
                      {downgradeWarnings.filter((w) => w.willExceed).map((w, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5">•</span>
                          <span>{w.message} ({w.currentCount} current / {w.newLimit === -1 ? 'unlimited' : w.newLimit} allowed)</span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-xs text-amber-600 mt-2">
                      Your existing data won't be deleted, but you won't be able to create new records above the plan limits after the switch.
                    </p>
                  </div>
                ) : (
                  <div className="bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
                    No data impact detected. You can safely switch to this plan.
                  </div>
                )}
              </div>
            )}

            {getPlanAction(confirmPlan) === 'upgrade' && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-6 text-sm text-blue-700">
                {listPrice(confirmPlan) > 0
                  ? `You'll be redirected to secure payment. After payment, ${confirmPlan.display_name} features unlock immediately.`
                  : `Your plan will be upgraded immediately with access to all ${confirmPlan.display_name} features.`}
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setConfirmPlan(null)}
                className="flex-1 py-3 rounded-lg font-semibold bg-gray-100 dark:bg-slate-800 text-text-secondary hover:bg-gray-200 dark:hover:bg-slate-700 border border-border transition"
                disabled={processing}
              >
                Back
              </button>
              <button
                onClick={handleConfirm}
                disabled={processing || warningsLoading}
                className={`flex-1 py-3 rounded-lg font-semibold transition flex items-center justify-center gap-2 ${
                  getPlanAction(confirmPlan) === 'upgrade'
                    ? 'bg-primary-600 text-white hover:bg-primary-700'
                    : 'bg-amber-600 text-white hover:bg-amber-700'
                } disabled:opacity-50`}
              >
                {processing ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    {getPlanAction(confirmPlan) === 'upgrade'
                      ? listPrice(confirmPlan) > 0
                        ? 'Proceed to payment'
                        : 'Confirm Upgrade'
                      : 'Schedule Downgrade'}
                    <ChevronRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function SubscriptionTab({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const searchParams = useSearchParams();
  const [subscription, setSubscription] = useState<CurrentSubscription | null>(null);
  const [availablePlans, setAvailablePlans] = useState<AvailablePlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [showUpgradeModal, setShowUpgradeModal] = useState(false);
  const [celebrationPlan, setCelebrationPlan] = useState<string | null>(null);
  const [addons, setAddons] = useState<any[]>([]);
  const [addonsLoading, setAddonsLoading] = useState(true);
  const [showAddonModal, setShowAddonModal] = useState(false);

  const [usageData, setUsageData] = useState<UsageData[]>([]);
  const [usageLoading, setUsageLoading] = useState(true);

  const [billingHistory, setBillingHistory] = useState<BillingRecord[]>([]);
  const [billingLoading, setBillingLoading] = useState(true);

  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  const [cancellingDowngrade, setCancellingDowngrade] = useState(false);

  const [couponCode, setCouponCode] = useState('');
  const [couponLoading, setCouponLoading] = useState(false);
  const [couponResult, setCouponResult] = useState<{ valid: boolean; message?: string } | null>(null);

  /** Trial is signup-only; only show the Trial card when it is the current plan. */
  const plansForChangeModal = useMemo(
    () =>
      availablePlans.filter(
        (p) => p.id !== TRIAL_PLAN_ID || subscription?.plan_id === TRIAL_PLAN_ID
      ),
    [availablePlans, subscription?.plan_id]
  );

  const currentPlanSortOrder = useMemo(
    () => availablePlans.find((p) => p.id === subscription?.plan_id)?.sort_order ?? 0,
    [availablePlans, subscription?.plan_id]
  );

  useEffect(() => {
    fetchSubscription();
    fetchAvailablePlans();
    fetchAddons();
    fetchBillingHistory();
  }, [businessId]);

  useEffect(() => {
    const payment = searchParams.get('payment');
    if (!payment) return;

    if (payment === 'success') {
      const planLabel = searchParams.get('plan');
      toast.success(
        planLabel
          ? `Payment received! Welcome to ${decodeURIComponent(planLabel)}.`
          : 'Payment received! Your plan will update shortly.',
      );
      setCelebrationPlan(planLabel ? decodeURIComponent(planLabel) : 'your new plan');
      fetchSubscription();
      fetchBillingHistory();
    } else if (payment === 'cancelled') {
      toast.error('Payment was cancelled. You can try again anytime.');
    }

    const url = new URL(window.location.href);
    url.searchParams.delete('payment');
    url.searchParams.delete('plan');
    window.history.replaceState({}, '', url.pathname + url.search);
  }, [searchParams]);

  useEffect(() => {
    if (subscription) {
      fetchUsageData();
    }
  }, [subscription, businessId]);

  async function fetchAddons() {
    try {
      const response = await fetch(`/api/subscriptions/addons/current?business_id=${businessId}`);
      if (response.ok) {
        const data = await response.json();
        setAddons(data.addons || []);
      }
    } catch (error) {
      console.error('Error fetching addons:', error);
    } finally {
      setAddonsLoading(false);
    }
  }

  async function fetchSubscription() {
    try {
      const response = await fetch(`/api/subscriptions/current?business_id=${businessId}`);
      if (response.ok) {
        const data = await response.json();
        setSubscription(data.subscription);
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    } finally {
      setLoading(false);
    }
  }

  async function fetchAvailablePlans() {
    try {
      const response = await fetch('/api/subscriptions/plans');
      if (!response.ok) {
        console.error('Error fetching plans:', response.status);
        return;
      }
      const data = await response.json();
      setAvailablePlans(data.plans || []);
    } catch (error) {
      console.error('Error fetching plans:', error);
    }
  }

  async function fetchUsageData() {
    setUsageLoading(true);
    try {
      const types = ['invoices', 'customers', 'items', 'users'] as const;
      const results = await Promise.all(
        types.map((t) =>
          fetch(`/api/subscriptions/check-limit?business_id=${businessId}&limit_type=${t}`)
            .then((r) => r.json())
            .then((data) => ({
              limit_type: t,
              current_count: data.current ?? 0,
              max_limit: data.limit ?? 0,
              allowed: data.allowed ?? true,
            }))
        )
      );
      setUsageData(results);
    } catch (error) {
      console.error('Error fetching usage data:', error);
    } finally {
      setUsageLoading(false);
    }
  }

  async function fetchBillingHistory() {
    setBillingLoading(true);
    try {
      const response = await fetch(`/api/subscriptions/billing-history?business_id=${businessId}`);
      if (response.ok) {
        const data = await response.json();
        setBillingHistory(data.transactions || data.history || []);
      }
    } catch (error) {
      console.error('Error fetching billing history:', error);
    } finally {
      setBillingLoading(false);
    }
  }

  async function handleCancelSubscription() {
    setCancelling(true);
    try {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      if (response.ok) {
        toast.success('Subscription cancelled successfully');
        setShowCancelDialog(false);
        fetchSubscription();
      } else {
        const data = await response.json();
        toast.error(data.error || 'Failed to cancel subscription');
      }
    } catch (error) {
      toast.error('Failed to cancel subscription');
    } finally {
      setCancelling(false);
    }
  }

  async function handleCancelDowngrade() {
    setCancellingDowngrade(true);
    try {
      const response = await fetch('/api/subscriptions/cancel-downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ business_id: businessId }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        toast.success('Scheduled downgrade cancelled. Your current plan will continue.');
        fetchSubscription();
      } else {
        toast.error(data.error || 'Failed to cancel downgrade');
      }
    } catch {
      toast.error('Failed to cancel downgrade');
    } finally {
      setCancellingDowngrade(false);
    }
  }

  async function handleApplyCoupon() {
    if (!couponCode.trim() || !subscription) return;
    setCouponLoading(true);
    setCouponResult(null);
    try {
      const response = await fetch('/api/subscriptions/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          code: couponCode.trim(),
          business_id: businessId,
          plan_id: subscription.plan_id,
          billing_cycle: subscription.billing_cycle || 'monthly',
        }),
      });
      const data = await response.json();
      if (response.ok && data.valid) {
        setCouponResult({
          valid: true,
          message: data.message || 'Valid — use when upgrading or at checkout.',
        });
        toast.success(data.message || 'Coupon is valid for your plan');
      } else {
        setCouponResult({ valid: false, message: data.error || data.message || 'Invalid coupon code' });
      }
    } catch (error) {
      setCouponResult({ valid: false, message: 'Failed to validate coupon' });
    } finally {
      setCouponLoading(false);
    }
  }

  function getUsageColor(current: number, max: number): string {
    if (max === -1) return 'bg-green-500';
    const pct = (current / max) * 100;
    if (pct > 90) return 'bg-red-500';
    if (pct >= 70) return 'bg-yellow-500';
    return 'bg-green-500';
  }

  function getUsagePercent(current: number, max: number): number {
    if (max === -1) return 100;
    if (max === 0) return 0;
    return Math.min((current / max) * 100, 100);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    });
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (!subscription) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <p className="text-text-secondary">Unable to load subscription details</p>
      </div>
    );
  }

  const isFreePlan = subscription.plan_id === 'free';
  const isCancelled =
    subscription.status === 'cancelled' || Boolean(subscription.cancel_at_period_end);
  const isGracePeriod = Boolean(subscription.is_grace_period_active);
  const isExpiredOrInactive =
    subscription.is_operational === false &&
    subscription.status !== 'trial';

  const usageLabels: Record<string, string> = {
    invoices: 'Invoices this month',
    customers: 'Customers',
    items: 'Items',
    users: 'Users',
  };

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      {isExpiredOrInactive && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-amber-800">
              Subscription {subscription.status === 'expired' ? 'expired' : 'inactive'}
            </p>
            <p className="text-sm text-amber-700 mt-1">
              Renew or change your plan to restore full access. You are currently on{' '}
              {subscription.plan_display_name}.
            </p>
          </div>
        </div>
      )}

      {celebrationPlan && (
        <CelebrationOverlay
          planName={celebrationPlan}
          onComplete={() => {
            setCelebrationPlan(null);
            toast.success(`Welcome to ${celebrationPlan}! All features are now unlocked.`);
          }}
        />
      )}

      {/* Top: Plan Card + Subscription Details side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Plan Card — takes 2 cols (neutral per color rules) */}
        <div className="lg:col-span-2 bg-surface dark:bg-slate-900/80 rounded-2xl p-6 border border-border shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center space-x-3">
              <div className="bg-slate-800 dark:bg-slate-700 p-3 rounded-xl">
                <CreditCard className="w-6 h-6 text-white" />
              </div>
              <div>
                <h2 className="text-2xl font-bold text-text-primary">{subscription.plan_display_name}</h2>
                <p className="text-text-secondary text-sm">{subscription.plan_description}</p>
              </div>
            </div>
            <button
              onClick={() => setShowUpgradeModal(true)}
              className="flex items-center space-x-2 px-5 py-2.5 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-semibold shadow"
            >
              <TrendingUp className="w-4 h-4" />
              <span>Change Plan</span>
            </button>
          </div>

          <div className="mb-5">
            {isFreePlan ? (
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-bold text-text-primary">Free</span>
                <span className="text-text-secondary">forever</span>
              </div>
            ) : (
              <div className="flex items-baseline space-x-2">
                <span className="text-3xl font-bold text-text-primary">₹{subscription.price_monthly}</span>
                <span className="text-text-secondary">/month</span>
              </div>
            )}
          </div>

          {subscription.trial_days_remaining && subscription.trial_days_remaining > 0 && (
            <div className="mb-4 p-3 bg-yellow-100 border border-yellow-300 rounded-lg">
              <div className="flex items-center space-x-2">
                <Zap className="w-4 h-4 text-yellow-600" />
                <p className="text-sm font-medium text-yellow-800">
                  {subscription.trial_days_remaining} days left in your trial
                </p>
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-surface dark:bg-slate-900/80 rounded-lg p-3 border border-border">
              <p className="text-xs text-text-muted mb-0.5">Invoices/mo</p>
              <p className="text-xl font-bold text-text-primary">
                {subscription.features.limits.max_invoices_per_month === -1 ? '∞' : subscription.features.limits.max_invoices_per_month}
              </p>
            </div>
            <div className="bg-surface dark:bg-slate-900/80 rounded-lg p-3 border border-border">
              <p className="text-xs text-text-muted mb-0.5">Customers</p>
              <p className="text-xl font-bold text-text-primary">
                {subscription.features.limits.max_customers === -1 ? '∞' : subscription.features.limits.max_customers}
              </p>
            </div>
            <div className="bg-surface dark:bg-slate-900/80 rounded-lg p-3 border border-border">
              <p className="text-xs text-text-muted mb-0.5">Users</p>
              <p className="text-xl font-bold text-text-primary">
                {subscription.features.limits.max_users === -1 ? '∞' : subscription.features.limits.max_users}
              </p>
            </div>
            <div
              className={`rounded-lg p-3 border cursor-pointer transition ${
                addons.length > 0
                  ? 'bg-green-50 border-green-200'
                  : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200 hover:shadow-md'
              }`}
              onClick={() => !addons.length && setShowAddonModal(true)}
            >
              <div className="flex items-center justify-between mb-0.5">
                <p className="text-xs text-text-muted">WhatsApp/day</p>
                {addons.length > 0 ? (
                  <span className="text-[10px] font-medium bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full">Active</span>
                ) : (
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-500" />
                )}
              </div>
              <p className="text-xl font-bold text-text-primary">
                {subscription.features.limits.max_whatsapp_per_day === -1
                  ? '∞'
                  : subscription.features.limits.max_whatsapp_per_day === 0
                  ? 'None'
                  : subscription.features.limits.max_whatsapp_per_day}
              </p>
              {!addons.length && (
                <p className="text-[10px] text-emerald-600 font-medium mt-1">Boost with Add-on →</p>
              )}
            </div>
          </div>

          {/* WhatsApp Add-on Upsell Banner */}
          {!addonsLoading && addons.length === 0 && (
            <div
              className="mt-4 p-3 bg-gradient-to-r from-emerald-500 to-teal-500 rounded-xl cursor-pointer hover:from-emerald-600 hover:to-teal-600 transition-all shadow-sm"
              onClick={() => setShowAddonModal(true)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="bg-white/20 p-2 rounded-lg">
                    <MessageSquare className="w-5 h-5 text-white" />
                  </div>
                  <div>
                    <p className="text-white font-semibold text-sm">Unlock WhatsApp for Business</p>
                    <p className="text-emerald-100 text-xs">Send invoices, reminders & chat with customers directly</p>
                  </div>
                </div>
                <button className="px-4 py-1.5 bg-surface dark:bg-slate-900/80 text-emerald-600 text-xs font-semibold rounded-lg hover:bg-emerald-50 transition">
                  Explore Add-ons
                </button>
              </div>
            </div>
          )}

          {/* Active Add-ons inline */}
          {!addonsLoading && addons.length > 0 && (
            <div className="mt-4 flex items-center gap-3 flex-wrap">
              {addons.map((addon) => (
                <div key={addon.id} className="flex items-center gap-2 px-3 py-1.5 bg-green-50 rounded-lg border border-green-200">
                  <Check className="w-3.5 h-3.5 text-green-600" />
                  <span className="text-xs font-medium text-text-primary">
                    {addon.addon_type === 'whatsapp_bot' ? 'WhatsApp Bot' : 'Send Message'}
                  </span>
                  <span className="text-xs text-text-muted">₹{addon.price_monthly}/mo</span>
                </div>
              ))}
              <button
                onClick={() => setShowAddonModal(true)}
                className="text-xs text-emerald-600 hover:text-emerald-700 font-medium underline"
              >
                Manage Add-ons
              </button>
            </div>
          )}
        </div>

        {/* Subscription Details — right column */}
        <div className="bg-surface dark:bg-slate-900/80 rounded-xl shadow-sm border border-border p-6 flex flex-col">
          <div className="flex items-center gap-2 mb-4">
            <Calendar className="w-5 h-5 text-primary-600" />
            <h3 className="text-lg font-semibold text-text-primary">Details</h3>
          </div>
          <div className="space-y-3 flex-grow">
            <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
              <Clock className="w-5 h-5 text-text-muted mt-0.5" />
              <div>
                <p className="text-xs text-text-muted">Next Renewal</p>
                <p className="text-sm font-semibold text-text-primary">
                  {subscription.end_date ? formatDate(subscription.end_date) : 'No expiry'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
              <CreditCard className="w-5 h-5 text-text-muted mt-0.5" />
              <div>
                <p className="text-xs text-text-muted">Billing Cycle</p>
                <p className="text-sm font-semibold text-text-primary">
                  {isFreePlan
                    ? 'Free'
                    : subscription.billing_cycle === 'yearly'
                    ? 'Yearly'
                    : 'Monthly'}
                </p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-slate-800/50 rounded-lg">
              <Calendar className="w-5 h-5 text-text-muted mt-0.5" />
              <div>
                <p className="text-xs text-text-muted">Started</p>
                <p className="text-sm font-semibold text-text-primary">
                  {formatDate(subscription.start_date)}
                </p>
              </div>
            </div>
          </div>

          {subscription.scheduled_plan_id && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
              <div className="flex items-center gap-2 mb-1">
                <ArrowDown className="w-4 h-4 text-amber-600" />
                <p className="text-xs font-medium text-amber-800">
                  Downgrade to <strong>{availablePlans.find((p) => p.id === subscription.scheduled_plan_id)?.display_name || subscription.scheduled_plan_id}</strong> on {formatDate(subscription.end_date)}
                </p>
              </div>
              <button
                onClick={handleCancelDowngrade}
                disabled={cancellingDowngrade}
                className="text-xs font-medium text-primary-600 hover:text-primary-800 underline flex items-center gap-1 disabled:opacity-50 mt-1"
              >
                {cancellingDowngrade ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                Cancel Downgrade
              </button>
            </div>
          )}
          {isCancelled && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <AlertTriangle className="w-4 h-4 text-orange-500 flex-shrink-0" />
              <p className="text-xs font-medium text-orange-700">
                Cancels on {formatDate(subscription.end_date)}
              </p>
            </div>
          )}
          {isGracePeriod && (
            <div className="mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
              <p className="text-xs font-medium text-red-700">
                Payment grace period —{' '}
                {subscription.grace_days_remaining != null && subscription.grace_days_remaining > 0
                  ? `${subscription.grace_days_remaining} day(s) left`
                  : 'ends soon'}
                {subscription.grace_period_end
                  ? ` (${formatDate(subscription.grace_period_end)})`
                  : ''}
                . Renew to avoid downgrade to Free.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Middle row: Usage + Features side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Current Usage */}
        <div className="bg-surface dark:bg-slate-900/80 rounded-xl shadow-sm border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-primary-600" />
            <h3 className="text-lg font-semibold text-text-primary">Current Usage</h3>
          </div>
          {usageLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : usageData.length > 0 ? (
            <div className="space-y-4">
              {usageData.map((usage, idx) => {
                const label = usageLabels[usage.limit_type] || usage.limit_type;
                const isUnlimited = usage.max_limit === -1;
                const pct = getUsagePercent(usage.current_count, usage.max_limit);
                const barColor = getUsageColor(usage.current_count, usage.max_limit);

                return (
                  <div key={usage.limit_type || idx}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-medium text-text-secondary">{label}</span>
                      <span className="text-sm text-text-muted">
                        {isUnlimited
                          ? `${usage.current_count} — Unlimited`
                          : `${usage.current_count} / ${usage.max_limit}`}
                      </span>
                    </div>
                    <div className="w-full h-2.5 bg-gray-200 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-text-muted text-center py-4">No usage data available</p>
          )}
        </div>

        {/* Features */}
        <div className="bg-surface dark:bg-slate-900/80 rounded-xl shadow-sm border border-border p-6">
          <h3 className="text-lg font-semibold text-text-primary mb-4">Features Included</h3>
          {subscription.enabled_features && subscription.enabled_features.length > 0 ? (
            <div className="space-y-4">
              {(() => {
                const categoryLabels: Record<string, string> = {
                  sales: 'Sales',
                  purchase: 'Purchases',
                  hr: 'HR & Payroll',
                  reports: 'Reports',
                  settings: 'Settings',
                  integrations: 'Integrations',
                  advanced: 'Advanced',
                };
                const grouped = subscription.enabled_features.reduce<Record<string, typeof subscription.enabled_features>>((acc, f) => {
                  const cat = f.category || 'other';
                  if (!acc[cat]) acc[cat] = [];
                  acc[cat].push(f);
                  return acc;
                }, {});
                const categoryOrder = ['sales', 'purchase', 'hr', 'reports', 'settings', 'integrations', 'advanced'];
                const sortedCategories = Object.keys(grouped).sort(
                  (a, b) => (categoryOrder.indexOf(a) === -1 ? 99 : categoryOrder.indexOf(a)) - (categoryOrder.indexOf(b) === -1 ? 99 : categoryOrder.indexOf(b))
                );
                return sortedCategories.map((cat) => (
                  <div key={cat}>
                    <p className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-1.5">
                      {categoryLabels[cat] || cat}
                    </p>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                      {grouped[cat].map((f) => (
                        <div key={f.id} className="flex items-center gap-2 text-sm text-text-secondary" title={f.description || ''}>
                          <Check className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
                          <span>{f.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ));
              })()}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(subscription.features.features)
                .filter(([_, enabled]) => enabled)
                .map(([key, _]) => (
                  <div key={key} className="flex items-center space-x-2 text-sm text-text-secondary">
                    <Check className="w-4 h-4 text-green-500 flex-shrink-0" />
                    <span>{key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}</span>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Bottom row: Billing + Coupon & Add-ons side by side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Billing History — wider */}
        <div className="lg:col-span-2 bg-surface dark:bg-slate-900/80 rounded-xl shadow-sm border border-border p-6">
          <div className="flex items-center gap-2 mb-4">
            <History className="w-5 h-5 text-primary-600" />
            <h3 className="text-lg font-semibold text-text-primary">Billing History</h3>
          </div>
          {billingLoading ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-primary-600" />
            </div>
          ) : billingHistory.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left py-3 px-2 font-medium text-text-muted">Date</th>
                    <th className="text-left py-3 px-2 font-medium text-text-muted">Description</th>
                    <th className="text-right py-3 px-2 font-medium text-text-muted">Amount</th>
                    <th className="text-center py-3 px-2 font-medium text-text-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billingHistory.map((record, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      <td className="py-3 px-2 text-text-secondary">{formatDate(record.date)}</td>
                      <td className="py-3 px-2 text-text-secondary">{record.description}</td>
                      <td className="py-3 px-2 text-right text-text-primary font-medium">₹{record.amount}</td>
                      <td className="py-3 px-2 text-center">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            record.status === 'paid' || record.status === 'success'
                              ? 'bg-green-100 text-green-700'
                              : record.status === 'pending'
                              ? 'bg-yellow-100 text-yellow-700'
                              : record.status === 'failed'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-text-secondary'
                          }`}
                        >
                          {record.status.charAt(0).toUpperCase() + record.status.slice(1)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-6 text-text-muted">
              <History className="w-8 h-8 text-text-muted mx-auto mb-2" />
              <p className="text-sm">No billing history yet</p>
            </div>
          )}
        </div>

        {/* Right column: Coupon */}
        <div className="bg-surface dark:bg-slate-900/80 rounded-xl shadow-sm border border-border p-6">
          <div className="flex items-center gap-2 mb-3">
            <Tag className="w-5 h-5 text-primary-600" />
            <h3 className="text-base font-semibold text-text-primary">Apply Coupon</h3>
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={couponCode}
              onChange={(e) => {
                setCouponCode(e.target.value);
                setCouponResult(null);
              }}
              placeholder="Enter coupon code"
              className="flex-1 px-3 py-2 border border-border rounded-lg text-sm bg-surface text-text-primary focus:ring-2 focus:ring-primary-500 focus:border-primary-500 outline-none"
            />
            <button
              onClick={handleApplyCoupon}
              disabled={couponLoading || !couponCode.trim()}
              className="px-4 py-2 bg-primary-600 text-white text-sm font-medium rounded-lg hover:bg-primary-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {couponLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Tag className="w-3.5 h-3.5" />}
              Apply
            </button>
          </div>
          {couponResult && (
            <div className={`mt-2 flex items-center gap-2 text-sm ${couponResult.valid ? 'text-green-600' : 'text-red-600'}`}>
              {couponResult.valid ? <Check className="w-4 h-4" /> : <X className="w-4 h-4" />}
              <span>{couponResult.message}</span>
            </div>
          )}
        </div>
      </div>

      {/* Cancel Subscription — full width */}
      {!isFreePlan && !isCancelled && (
        <div className="bg-surface dark:bg-slate-900/80 rounded-xl shadow-sm border border-border p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-text-primary">Cancel Subscription</h3>
              <p className="text-sm text-text-muted mt-1">
                Your subscription will remain active until the end of your current billing period.
              </p>
            </div>
            <button
              onClick={() => setShowCancelDialog(true)}
              className="px-5 py-2.5 border border-red-300 text-red-600 text-sm font-medium rounded-lg hover:bg-red-50 transition"
            >
              Cancel Subscription
            </button>
          </div>
        </div>
      )}

      {/* Cancel Confirmation Dialog */}
      {showCancelDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-surface dark:bg-slate-900/80 rounded-2xl max-w-md w-full p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="bg-red-100 p-2 rounded-full">
                <AlertTriangle className="w-6 h-6 text-red-600" />
              </div>
              <h3 className="text-lg font-bold text-text-primary">Cancel Subscription?</h3>
            </div>
            <p className="text-sm text-text-secondary mb-2">
              Are you sure you want to cancel your subscription? You will lose access to:
            </p>
            <ul className="text-sm text-text-secondary mb-6 space-y-1 ml-4 list-disc">
              <li>Premium features and higher limits</li>
              <li>Priority support</li>
              <li>Advanced analytics and reports</li>
            </ul>
            <p className="text-xs text-text-muted mb-6">
              Your subscription will remain active until {formatDate(subscription.end_date)}.
              After that, you will be moved to the Free plan.
            </p>
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={() => setShowCancelDialog(false)}
                className="px-4 py-2 text-sm font-medium text-text-secondary hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg transition"
              >
                Keep Subscription
              </button>
              <button
                onClick={handleCancelSubscription}
                disabled={cancelling}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition disabled:opacity-50 flex items-center gap-2"
              >
                {cancelling && <Loader2 className="w-4 h-4 animate-spin" />}
                Yes, Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <ChangePlanModal
          currentPlanId={subscription.plan_id}
          scheduledPlanId={subscription.scheduled_plan_id}
          availablePlans={plansForChangeModal}
          currentPlanSortOrder={currentPlanSortOrder}
          businessId={businessId}
          endDate={subscription.end_date}
          onClose={() => setShowUpgradeModal(false)}
          onSuccess={(upgradedPlanName?: string) => {
            setShowUpgradeModal(false);
            fetchSubscription();
            fetchUsageData();
            if (upgradedPlanName) {
              setCelebrationPlan(upgradedPlanName);
            }
          }}
        />
      )}

      {/* Add-on Modal */}
      {showAddonModal && (
        <WhatsAppAddonModal
          addonType="all"
          onClose={() => setShowAddonModal(false)}
          onPurchaseSuccess={() => {
            fetchAddons();
            setShowAddonModal(false);
          }}
        />
      )}
    </div>
  );
}
