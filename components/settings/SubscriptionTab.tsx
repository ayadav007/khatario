'use client';

import { useCallback, useEffect, useState, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useToastContext } from '@/contexts/ToastContext';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';
import { CreditCard, TrendingUp, Check, Zap, AlertCircle, ArrowRight, ArrowDown, MessageSquare, Lock, Calendar, Clock, X, Loader2, History, Tag, AlertTriangle } from 'lucide-react';
import { WhatsAppAddonModal } from '@/components/subscription/WhatsAppAddonModal';
import {
  SubscriptionChangePlanModal,
  type SubscriptionAvailablePlan,
} from '@/components/subscription/SubscriptionChangePlanModal';
import { CelebrationOverlay } from '@/components/ui/CelebrationOverlay';
import { Button } from '@/components/ui/Button';
import { SETTINGS_CONTENT_WIDTH } from '@/lib/settings-page-layout';
import {
  ModuleSubscriptionCard,
  type ModuleSubscriptionDetail,
} from '@/components/settings/ModuleSubscriptionCard';
import type { PlatformModule } from '@/lib/platform-modules';
import Link from 'next/link';

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

type AvailablePlan = SubscriptionAvailablePlan;

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
  module_label?: string;
  plan_display_name?: string;
  billing_cycle?: string | null;
}

export function SubscriptionTab({ businessId }: { businessId: string }) {
  const toast = useToastContext();
  const searchParams = useSearchParams();
  const [modulePlans, setModulePlans] = useState<
    {
      module_key: PlatformModule;
      label: string;
      subscription: ModuleSubscriptionDetail | null;
      usage: { limit_type: string; current_count: number; max_limit: number }[];
    }[]
  >([]);
  const [consoleSeats, setConsoleSeats] = useState<{ current: number; max: number } | null>(null);
  const [modulePlansLoading, setModulePlansLoading] = useState(true);
  const [cancellingModuleDowngrade, setCancellingModuleDowngrade] = useState<PlatformModule | null>(
    null,
  );
  const [cancellingModuleSubscription, setCancellingModuleSubscription] =
    useState<PlatformModule | null>(null);

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
  const [sessionExpired, setSessionExpired] = useState(false);

  const authFetchOpts: RequestInit = { credentials: 'include' };

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
    fetchModulePlans();
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

  async function fetchAddons() {
    try {
      const response = await fetch(
        `/api/subscriptions/addons/current?business_id=${businessId}`,
        authFetchOpts,
      );
      if (response.status === 401) {
        setSessionExpired(true);
        return;
      }
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

  async function fetchModulePlans() {
    setModulePlansLoading(true);
    try {
      const response = await fetch('/api/subscriptions/modules/current', authFetchOpts);
      if (response.status === 401) {
        setSessionExpired(true);
        return;
      }
      if (response.ok) {
        const data = await response.json();
        setModulePlans(data.modules ?? []);
        if (data.console_seats) {
          setConsoleSeats({ current: data.console_seats.current, max: data.console_seats.max });
        }
      }
    } catch (error) {
      console.error('Error fetching module plans:', error);
    } finally {
      setModulePlansLoading(false);
    }
  }

  async function handleCancelModuleDowngrade(moduleKey: PlatformModule) {
    setCancellingModuleDowngrade(moduleKey);
    try {
      const response = await fetch('/api/subscriptions/cancel-downgrade', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ business_id: businessId, module_key: moduleKey }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        toast.success('Scheduled downgrade cancelled.');
        fetchModulePlans();
        fetchSubscription();
      } else {
        toast.error(data.error || 'Failed to cancel downgrade');
      }
    } catch {
      toast.error('Failed to cancel downgrade');
    } finally {
      setCancellingModuleDowngrade(null);
    }
  }

  async function handleCancelModuleSubscription(moduleKey: PlatformModule) {
    setCancellingModuleSubscription(moduleKey);
    try {
      const response = await fetch('/api/subscriptions/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ business_id: businessId, module_key: moduleKey }),
      });
      const data = await response.json();
      if (response.ok) {
        toast.success(data.message || 'Cancellation scheduled.');
        fetchModulePlans();
        fetchSubscription();
      } else {
        toast.error(data.error || 'Failed to cancel subscription');
      }
    } catch {
      toast.error('Failed to cancel subscription');
    } finally {
      setCancellingModuleSubscription(null);
    }
  }

  async function fetchSubscription() {
    try {
      const response = await fetch(
        `/api/subscriptions/current?business_id=${businessId}`,
        authFetchOpts,
      );
      if (response.status === 401) {
        setSessionExpired(true);
        return;
      }
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
      const response = await fetch('/api/subscriptions/plans', authFetchOpts);
      if (response.status === 401) {
        setSessionExpired(true);
        return;
      }
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
      const types = ['invoices', 'customers', 'items', 'users', 'employees'] as const;
      const results = await Promise.all(
        types.map((t) =>
          fetch(
            `/api/subscriptions/check-limit?business_id=${businessId}&limit_type=${t}`,
            authFetchOpts,
          )
            .then((r) => {
              if (r.status === 401) {
                setSessionExpired(true);
                return null;
              }
              return r.json();
            })
            .then((data) =>
              data
                ? {
                    limit_type: t,
                    current_count: data.current ?? 0,
                    max_limit: data.limit ?? 0,
                    allowed: data.allowed ?? true,
                  }
                : null,
            ),
        ),
      );
      setUsageData(results.filter((r): r is UsageData => r != null));
    } catch (error) {
      console.error('Error fetching usage data:', error);
    } finally {
      setUsageLoading(false);
    }
  }

  const refreshUsageData = useCallback(() => {
    void fetchUsageData();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- businessId is the only external dep
  }, [businessId]);

  useEffect(() => {
    refreshUsageData();
  }, [refreshUsageData]);

  async function fetchBillingHistory() {
    setBillingLoading(true);
    try {
      const response = await fetch('/api/subscriptions/billing-history', {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        const rows = data.history || data.transactions || [];
        setBillingHistory(
          rows.map(
            (tx: {
              date?: string;
              created_at?: string;
              description?: string;
              amount?: number;
              total_amount?: number;
              status?: string;
              module_label?: string;
              plan_display_name?: string;
              billing_cycle?: string | null;
            }) => ({
              date: tx.date || tx.created_at || '',
              description: tx.description || 'Subscription payment',
              amount: Number(tx.amount ?? tx.total_amount ?? 0),
              status: tx.status || 'pending',
              module_label: tx.module_label,
              plan_display_name: tx.plan_display_name,
              billing_cycle: tx.billing_cycle,
            }),
          ),
        );
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

  if (loading && modulePlansLoading && !sessionExpired) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  if (sessionExpired) {
    return (
      <div className="text-center py-12">
        <Lock className="w-12 h-12 text-amber-600 mx-auto mb-4" />
        <p className="text-lg font-semibold text-text-primary mb-2">Session expired</p>
        <p className="text-text-secondary mb-4">
          Please sign in again to view your subscription and billing details.
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-2 text-primary-600 hover:text-primary-700 font-medium"
        >
          Go to login
          <ArrowRight className="w-4 h-4" />
        </Link>
      </div>
    );
  }

  if (!subscription && modulePlans.length === 0 && !modulePlansLoading && !loading) {
    return (
      <div className="text-center py-12">
        <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
        <p className="text-text-secondary">Unable to load subscription details</p>
        <Button variant="secondary" className="mt-4" onClick={() => {
          setLoading(true);
          setModulePlansLoading(true);
          fetchSubscription();
          fetchModulePlans();
        }}>
          Try again
        </Button>
      </div>
    );
  }

  const isFreePlan = subscription?.plan_id === 'free';
  const isCancelled =
    subscription?.status === 'cancelled' || Boolean(subscription?.cancel_at_period_end);
  const isGracePeriod = Boolean(subscription?.is_grace_period_active);
  const isExpiredOrInactive =
    subscription != null &&
    subscription.is_operational === false &&
    subscription.status !== 'trial';

  const usageLabels: Record<string, string> = {
    invoices: 'Invoices this month',
    customers: 'Customers',
    items: 'Items',
    users: 'Console seats (shared)',
    employees: 'Employees',
    whatsapp: 'WhatsApp today',
  };

  const useModulePlans = modulePlans.length > 0;

  return (
    <div className={`${SETTINGS_CONTENT_WIDTH} space-y-6`}>
      {isExpiredOrInactive && subscription && (
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

      {useModulePlans ? (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-text-secondary">
              Each product has its own plan. Console seats are shared across products.
            </p>
            <Link href="/settings/products" className="link-primary text-sm font-medium">
              Manage products
            </Link>
          </div>

          {consoleSeats ? (
            <div className="rounded-xl border border-border bg-gray-50 p-4 dark:bg-slate-800/40">
              <p className="text-xs font-medium uppercase tracking-wide text-text-muted">
                Console seats (shared)
              </p>
              <p className="mt-1 text-lg font-bold text-text-primary">
                {consoleSeats.max === -1
                  ? `${consoleSeats.current} — Unlimited`
                  : `${consoleSeats.current} / ${consoleSeats.max}`}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Admin logins and app users. Attendance-only employees do not use a seat.
              </p>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {modulePlans.map((mod) => (
              <ModuleSubscriptionCard
                key={mod.module_key}
                moduleKey={mod.module_key}
                label={mod.label}
                subscription={mod.subscription}
                usage={mod.usage}
                availablePlans={availablePlans}
                businessId={businessId}
                onPlanChanged={() => {
                  fetchModulePlans();
                  fetchSubscription();
                  fetchUsageData();
                  fetchBillingHistory();
                }}
                onCancelDowngrade={handleCancelModuleDowngrade}
                onCancelSubscription={handleCancelModuleSubscription}
                cancellingDowngrade={cancellingModuleDowngrade === mod.module_key}
                cancellingSubscription={cancellingModuleSubscription === mod.module_key}
              />
            ))}
          </div>

          {!addonsLoading && (
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-semibold text-text-primary">WhatsApp add-ons</h3>
                <button
                  type="button"
                  onClick={() => setShowAddonModal(true)}
                  className="link-primary text-sm font-medium"
                >
                  {addons.length ? 'Manage' : 'Explore add-ons'}
                </button>
              </div>
              {addons.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {addons.map((addon) => (
                    <div
                      key={addon.id}
                      className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5"
                    >
                      <Check className="h-3.5 w-3.5 text-green-600" />
                      <span className="text-xs font-medium text-text-primary">
                        {addon.addon_type === 'whatsapp_bot' ? 'WhatsApp Bot' : 'Send Message'}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-secondary">
                  Bot and send-message add-ons work with Billing or Connect.
                </p>
              )}
            </div>
          )}
        </div>
      ) : subscription ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-2xl border border-border bg-surface p-6 shadow-sm dark:bg-slate-900/80">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div>
                <h2 className="settings-section-title mb-0">{subscription.plan_display_name}</h2>
                <p className="text-sm text-text-secondary">{subscription.plan_description}</p>
              </div>
              <Button size="sm" variant="primary" onClick={() => setShowUpgradeModal(true)}>
                Change plan
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Legacy single-plan details — grace / cancel banners when not on module API yet */}
      {!useModulePlans && subscription && (isGracePeriod || isCancelled) && (
        <div className="rounded-xl border border-border bg-surface p-4">
          {isCancelled && (
            <p className="text-sm text-orange-700">
              Cancels on {formatDate(subscription.end_date)}
            </p>
          )}
          {isGracePeriod && (
            <p className="text-sm text-red-700">
              Payment grace period — renew to avoid downgrade.
            </p>
          )}
        </div>
      )}

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
          {!subscription ? (
            <p className="text-sm text-text-muted">
              {useModulePlans
                ? 'Included features are listed on each product plan card above.'
                : 'No subscription details available.'}
            </p>
          ) : subscription.enabled_features && subscription.enabled_features.length > 0 ? (
            <div className="space-y-4">
              {(() => {
                const categoryLabels: Record<string, string> = {
                  sales: 'Sales',
                  purchase: 'Purchases',
                  inventory: 'Inventory',
                  hr: 'HR & Payroll',
                  reports: 'Reports',
                  settings: 'Settings',
                  integrations: 'Integrations',
                  advanced: 'Advanced',
                  tools: 'Tools',
                  billing: 'Billing',
                  connect: 'Connect',
                  other: 'Other',
                };
                const formatCategory = (cat: string) =>
                  categoryLabels[cat] ||
                  cat.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
                      {formatCategory(cat)}
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
          ) : subscription.features?.features ? (
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
          ) : (
            <p className="text-sm text-text-muted text-center py-4">No feature list available</p>
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
                    <th className="text-left py-3 px-2 font-medium text-text-muted">Product</th>
                    <th className="text-left py-3 px-2 font-medium text-text-muted">Plan</th>
                    <th className="text-left py-3 px-2 font-medium text-text-muted">Description</th>
                    <th className="text-right py-3 px-2 font-medium text-text-muted">Amount</th>
                    <th className="text-center py-3 px-2 font-medium text-text-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billingHistory.map((record, idx) => (
                    <tr key={idx} className="border-b border-border last:border-0">
                      <td className="py-3 px-2 text-text-secondary">{formatDate(record.date)}</td>
                      <td className="py-3 px-2 text-text-secondary">
                        {record.module_label || '—'}
                      </td>
                      <td className="py-3 px-2 text-text-primary font-medium">
                        {record.plan_display_name || '—'}
                      </td>
                      <td className="py-3 px-2 text-text-secondary text-xs">{record.description}</td>
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

      {/* Cancel Subscription — legacy single-plan UI only */}
      {!useModulePlans && subscription && !isFreePlan && !isCancelled && (
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
      {showCancelDialog && subscription && (
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
      {showUpgradeModal && subscription && !useModulePlans && (
        <SubscriptionChangePlanModal
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
            fetchModulePlans();
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
