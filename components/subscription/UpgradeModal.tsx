'use client';

import { useState, useEffect } from 'react';
import { X, Check, Loader2, TrendingUp, Tag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { startPlanUpgrade } from '@/lib/subscription/client-upgrade';
import { isPurchasableUpgradePlan } from '@/lib/subscription/trial-plan';
import { productLineForModule } from '@/lib/platform-modules';
import type { PlatformModule } from '@/lib/platform-modules';
import { MODULE_ADD_CONFIG, getLimitOwnerModule } from '@/lib/subscription/module-entitlements';
import {
  billingCycleMonths,
  computePlanAmount,
  isBillingCycleOffered,
  type BillingCycle,
} from '@/lib/subscription/apply-plan-change';

interface SubscriptionPlan {
  id: string;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  price_3year?: number | null;
  currency: string;
  features: {
    limits: {
      max_invoices_per_month?: number;
      max_customers?: number;
      max_items?: number;
      max_users?: number;
      max_whatsapp_per_day?: number;
      max_ai_replies_per_month?: number;
    };
    features: Record<string, boolean>;
  };
  sort_order: number;
  product_line?: string | null;
}

interface UpgradeModalProps {
  limitType?: 'invoices' | 'customers' | 'items' | 'users' | 'employees' | 'whatsapp' | 'feature';
  currentCount?: number;
  limit?: number;
  featureName?: string;
  /** Pre-select a plan in the upgrade grid (e.g. limit recommendation). */
  initialPlanId?: string;
  /** Scope plan list + checkout to this product module. */
  moduleKey?: PlatformModule;
  /** Show a free trial option alongside paid plans (for module addition flow). */
  showTrialOption?: boolean;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
}

export function UpgradeModal({
  limitType,
  currentCount,
  limit,
  featureName,
  initialPlanId,
  moduleKey: moduleKeyProp,
  showTrialOption,
  onClose,
  onUpgradeSuccess,
}: UpgradeModalProps) {
  const { business, platformSession } = useAuth();
  // Plans are per product: an employee limit must offer HR plans, not Billing ones.
  const limitModule =
    limitType && limitType !== 'feature' ? getLimitOwnerModule(limitType) : null;
  const moduleKey: PlatformModule | undefined =
    moduleKeyProp ??
    limitModule ??
    (initialPlanId ? undefined : platformSession?.primaryModule ?? 'billing');
  const toast = useToastContext();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [upgrading, setUpgrading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);

  const trialConfig =
    showTrialOption && moduleKey
      ? MODULE_ADD_CONFIG[moduleKey as Exclude<PlatformModule, 'crm'>]
      : null;
  /** Products that activate on their own ₹0 plan with no paid tiers; paid-only products list plans. */
  const isFreeModule = !!trialConfig && !trialConfig.trialDays && !trialConfig.paidOnly;

  async function handleStartTrial() {
    if (!trialConfig || !business?.id || !moduleKey) return;
    setStartingTrial(true);
    try {
      const result = await startPlanUpgrade({
        businessId: business.id,
        planId: trialConfig.trialPlanId,
        moduleKey,
        billingCycle: 'monthly',
        amountInr: 0,
      });
      if (result.mode === 'instant') {
        toast.success(
          trialConfig.trialDays
            ? `${trialConfig.label} ${trialConfig.trialDays}-day trial started!`
            : `${trialConfig.label} added.`,
        );
        onUpgradeSuccess?.();
        onClose();
        window.location.reload();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Could not start trial.';
      toast.error(message);
    } finally {
      setStartingTrial(false);
    }
  }

  useEffect(() => {
    void fetchPlans();
  }, [initialPlanId, moduleKey]);

  useEffect(() => {
    setCouponApplied(false);
    setCouponMessage(null);
  }, [selectedPlanId, billingCycle]);

  function listPrice(plan: SubscriptionPlan): number {
    return computePlanAmount(plan, billingCycle);
  }

  const offersThreeYear = plans.some((p) => Number(p.price_3year) > 0);
  const cycleOptions: Array<{ id: BillingCycle; label: string }> = [
    { id: 'monthly', label: 'Monthly' },
    { id: 'yearly', label: 'Yearly' },
    ...(offersThreeYear ? [{ id: 'three_year' as const, label: '3 years' }] : []),
  ];

  async function applyCoupon() {
    if (!couponCode.trim() || !selectedPlanId || !business?.id) return;
    setCouponLoading(true);
    setCouponApplied(false);
    setCouponMessage(null);
    try {
      const res = await fetch('/api/subscriptions/coupons/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          business_id: business.id,
          plan_id: selectedPlanId,
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

  async function fetchPlans() {
    try {
      const response = await fetch('/api/subscriptions/plans');
      if (response.ok) {
        const data = await response.json();
        const initialPlan = initialPlanId
          ? (data.plans || []).find((p: SubscriptionPlan) => p.id === initialPlanId)
          : null;
        const productLine = moduleKey
          ? productLineForModule(moduleKey)
          : initialPlan
            ? initialPlan.product_line ?? 'billing'
            : null;
        const availablePlans = (data.plans || [])
          .filter((p: SubscriptionPlan) => isPurchasableUpgradePlan(p.id))
          .filter((p: SubscriptionPlan) => {
            if (!productLine) return true;
            const line = p.product_line ?? 'billing';
            return line === productLine;
          });
        setPlans(availablePlans);

        if (availablePlans.length > 0) {
          const preferred = initialPlanId
            ? availablePlans.find((p: SubscriptionPlan) => p.id === initialPlanId)
            : null;
          setSelectedPlanId(preferred?.id ?? availablePlans[0].id);
        }
      }
    } catch (error) {
      console.error('Error fetching plans:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpgrade() {
    if (!selectedPlanId || !business?.id) return;

    setUpgrading(true);
    try {
      const selected = plans.find((p) => p.id === selectedPlanId);
      const amountInr = selected ? listPrice(selected) : 0;

      const result = await startPlanUpgrade({
        businessId: business.id,
        planId: selectedPlanId,
        moduleKey,
        billingCycle,
        amountInr,
        couponCode: couponApplied ? couponCode.trim() : undefined,
      });

      if (result.mode === 'instant') {
        toast.success(
          `Successfully upgraded to ${selected?.display_name ?? 'your new plan'}!`,
        );
        onUpgradeSuccess?.();
        onClose();
        window.location.reload();
      }
      // mode === 'redirect' — browser navigates to Razorpay
    } catch (error: unknown) {
      console.error('Upgrade error:', error);
      const message =
        error instanceof Error ? error.message : 'An error occurred during upgrade.';
      toast.error(message);
    } finally {
      setUpgrading(false);
    }
  }

  const getLimitMessage = () => {
    if (!limitType) return null;

    const messages: Record<string, string> = {
      invoices: `You've reached your limit of ${limit} invoices per month.`,
      customers: `You've reached your limit of ${limit} customers.`,
      items: `You've reached your limit of ${limit} items/products.`,
      users: `You've reached your limit of ${limit} user(s).`,
      employees: `You've reached your limit of ${limit} employee(s).`,
      whatsapp: `You've reached your limit of ${limit} WhatsApp messages today.`,
      feature: `${featureName} is not available in your current plan.`,
    };

    return messages[limitType] || 'Upgrade to unlock more features.';
  };

  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 0,
    }).format(amount);
  };

  const getPlanHighlights = (plan: SubscriptionPlan): string[] => {
    const limits = plan.features?.limits ?? {};
    const highlights: string[] = [];
    const describe = (value: number | undefined, unlimited: string, counted: (n: number) => string) => {
      if (value === undefined || value === null) return;
      if (value === -1) highlights.push(unlimited);
      else if (value > 0) highlights.push(counted(value));
    };

    describe(limits.max_invoices_per_month, 'Unlimited invoices', (n) => `${n} invoices/month`);
    describe(limits.max_customers, 'Unlimited customers', (n) => `${n} customers`);
    describe(limits.max_users, 'Unlimited users', (n) => `${n} user(s)`);
    describe(limits.max_ai_replies_per_month, 'Unlimited AI replies', (n) => `${n} AI replies/month`);
    describe(limits.max_whatsapp_per_day, 'Unlimited WhatsApp messages', (n) => `${n} WhatsApp messages/day`);

    return highlights;
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-2xl max-w-2xl w-full p-8">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-8 h-8 animate-spin text-primary-600" />
          </div>
        </div>
      </div>
    );
  }

  const selectedPlan = plans.find(p => p.id === selectedPlanId);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl max-w-5xl w-full my-8 relative">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 z-10"
        >
          <X className="w-6 h-6" />
        </button>

        {/* Header */}
        <div className="p-6 border-b border-gray-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="bg-gray-100 dark:bg-slate-800 p-3 rounded-full">
              <TrendingUp className="w-6 h-6 text-gray-700 dark:text-gray-200" />
            </div>
            <h2 className="text-2xl font-bold text-gray-900">
              {trialConfig ? `Add ${trialConfig.label}` : 'Upgrade Your Plan'}
            </h2>
          </div>
          {limitType && (
            <p className="text-gray-600 mt-2">{getLimitMessage()}</p>
          )}
          {currentCount !== undefined && limit !== undefined && (
            <div className="mt-4 p-3 bg-gray-50 rounded-lg">
              <div className="flex justify-between items-center text-sm mb-2">
                <span className="text-gray-600">Current Usage:</span>
                <span className="font-semibold text-gray-900">
                  {currentCount} / {limit}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2">
                <div
                  className="bg-primary-600 h-2 rounded-full"
                  style={{ width: `${Math.min((currentCount / limit) * 100, 100)}%` }}
                ></div>
              </div>
            </div>
          )}
        </div>

        {isFreeModule && trialConfig ? (
          <div className="p-6">
            <div className="rounded-xl border-2 border-green-200 bg-green-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">Add {trialConfig.label} free</h3>
                  <p className="mt-1 text-sm text-gray-600">
                    {trialConfig.description} No payment needed.
                  </p>
                </div>
                <button
                  onClick={handleStartTrial}
                  disabled={startingTrial}
                  className="flex-shrink-0 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {startingTrial ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                  {startingTrial ? 'Adding...' : `Add ${trialConfig.label}`}
                </button>
              </div>
            </div>
            <button
              onClick={onClose}
              className="mt-4 w-full px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700"
              disabled={startingTrial}
            >
              Maybe Later
            </button>
          </div>
        ) : null}

        {/* Free Trial Option */}
        {trialConfig && trialConfig.trialDays ? (
          <div className="p-6 border-b border-gray-200">
            <div className="rounded-xl border-2 border-green-200 bg-green-50 p-5">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold text-gray-900">
                    Start {trialConfig.trialDays}-day free trial
                  </h3>
                  <p className="mt-1 text-sm text-gray-600">
                    {trialConfig.description} Try all features free for {trialConfig.trialDays} days — no credit card needed.
                  </p>
                </div>
                <button
                  onClick={handleStartTrial}
                  disabled={startingTrial}
                  className="flex-shrink-0 rounded-lg bg-green-600 px-5 py-2.5 text-sm font-semibold text-white shadow hover:bg-green-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                >
                  {startingTrial ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Check className="w-4 h-4" />
                  )}
                  {startingTrial ? 'Starting...' : 'Start Free Trial'}
                </button>
              </div>
            </div>
            <div className="relative mt-6">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-gray-200" />
              </div>
              <div className="relative flex justify-center text-sm">
                <span className="bg-white px-3 text-gray-500">or choose a paid plan</span>
              </div>
            </div>
          </div>
        ) : null}

        {!isFreeModule && (
        <>
        {/* Billing Cycle Toggle */}
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-center">
            <div className="inline-flex rounded-full border border-gray-300 bg-white p-1" role="radiogroup" aria-label="Billing period">
              {cycleOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={billingCycle === opt.id}
                  onClick={() => setBillingCycle(opt.id)}
                  className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                    billingCycle === opt.id ? 'bg-primary-600 text-white' : 'text-gray-600 hover:text-gray-900'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Plans Grid */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {plans.map((plan) => {
              const isSelected = selectedPlanId === plan.id;
              const offered = isBillingCycleOffered(plan, billingCycle);
              const price = listPrice(plan);
              const months = billingCycleMonths(billingCycle);
              const monthlyEquivalent = Math.round(price / months);
              const saving =
                months > 1 && Number(plan.price_monthly) > 0
                  ? Math.round((1 - price / (Number(plan.price_monthly) * months)) * 100)
                  : 0;

              return (
                <div
                  key={plan.id}
                  onClick={() => setSelectedPlanId(plan.id)}
                  className={`relative border-2 rounded-xl p-6 cursor-pointer transition-all ${
                    isSelected
                      ? 'border-primary-600 bg-surface shadow-lg ring-2 ring-primary-200'
                      : 'border-gray-200 hover:border-gray-300 bg-white'
                  }`}
                >
                  {/* Radio Button */}
                  <div className="absolute top-4 right-4">
                    <div
                      className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                        isSelected
                          ? 'border-primary-600 bg-primary-600'
                          : 'border-gray-300'
                      }`}
                    >
                      {isSelected && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                  </div>

                  {/* Plan Name */}
                  <h3 className="text-xl font-bold text-gray-900 mb-2">{plan.display_name}</h3>
                  <p className="text-sm text-gray-600 mb-4">{plan.description}</p>

                  {/* Price */}
                  <div className="mb-4">
                    {offered ? (
                      <>
                        <div className="flex items-baseline">
                          <span className="text-3xl font-bold text-gray-900">{formatPrice(price)}</span>
                          <span className="text-sm text-gray-500 ml-2">
                            {billingCycle === 'three_year' ? 'for 3 years' : billingCycle === 'yearly' ? '/year' : '/month'}
                          </span>
                        </div>
                        {months > 1 && (
                          <p className="text-xs text-gray-500 mt-1">
                            {formatPrice(monthlyEquivalent)}/month
                            {saving > 0 ? ` · save ${saving}%` : ''}
                          </p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-gray-500">Not offered for this billing period</p>
                    )}
                  </div>

                  {/* Highlights */}
                  <ul className="space-y-2">
                    {getPlanHighlights(plan).slice(0, 4).map((highlight, index) => (
                      <li key={index} className="flex items-start text-sm text-gray-700">
                        <Check className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                        <span>{highlight}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>

          {selectedPlan && listPrice(selectedPlan) > 0 && (
            <div className="mb-6 p-4 bg-gray-50 rounded-xl border border-gray-200">
              <div className="flex items-center gap-2 mb-2">
                <Tag className="w-4 h-4 text-gray-500" />
                <p className="text-sm font-medium text-gray-700">Have a coupon?</p>
              </div>
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
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
                <button
                  type="button"
                  onClick={applyCoupon}
                  disabled={couponLoading || !couponCode.trim() || !selectedPlanId}
                  className="px-4 py-2 rounded-lg text-sm font-semibold bg-white border border-gray-300 hover:bg-gray-100 disabled:opacity-50"
                >
                  {couponLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
                </button>
              </div>
              {couponMessage && (
                <p
                  className={`text-xs mt-2 ${
                    couponApplied ? 'text-green-700' : 'text-red-600'
                  }`}
                >
                  {couponMessage}
                </p>
              )}
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-4 border-t border-gray-200">
            <button
              onClick={onClose}
              className="flex-1 px-6 py-3 border border-gray-300 rounded-lg hover:bg-gray-50 transition font-medium text-gray-700"
              disabled={upgrading}
            >
              Maybe Later
            </button>
            <button
              onClick={handleUpgrade}
              disabled={
                !selectedPlanId ||
                upgrading ||
                (!!selectedPlan && !isBillingCycleOffered(selectedPlan, billingCycle))
              }
              className="flex-1 px-6 py-3 bg-primary-600 text-white rounded-lg hover:bg-primary-700 transition font-semibold shadow disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
            >
              {upgrading ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin mr-2" />
                  Processing...
                </>
              ) : selectedPlan && listPrice(selectedPlan) <= 0 ? (
                <>Confirm upgrade to {selectedPlan.display_name}</>
              ) : (
                <>Proceed to payment — {selectedPlan?.display_name}</>
              )}
            </button>
          </div>

          {selectedPlan && listPrice(selectedPlan) > 0 && (
            <p className="text-xs text-gray-500 text-center mt-4">
              You&apos;ll be redirected to our payment partner for secure payment. Your plan activates after payment
              is confirmed.
            </p>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}

