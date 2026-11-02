'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Loader2, ShieldCheck, Tag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { startPlanUpgrade } from '@/lib/subscription/client-upgrade';
import { isPurchasableUpgradePlan } from '@/lib/subscription/trial-plan';
import { productLineForModule, type PlatformModule } from '@/lib/platform-modules';
import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';
import { connectSeatsLabel } from '@/lib/subscription/billing-labels';
import {
  billingCycleMonths,
  computePlanAmount,
  isBillingCycleOffered,
  type BillingCycle,
} from '@/lib/subscription/apply-plan-change';

export interface UpgradePlanRow {
  id: string;
  is_public?: boolean;
  name: string;
  display_name: string;
  description: string;
  price_monthly: number;
  price_yearly: number;
  price_3year?: number | null;
  currency: string;
  features: {
    limits: Record<string, number | undefined>;
    features: Record<string, boolean>;
  };
  sort_order: number;
  product_line?: string | null;
}

export interface UpgradePlanPickerProps {
  moduleKey?: PlatformModule;
  initialPlanId?: string;
  showTrialOption?: boolean;
  onBack?: () => void;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
}

const formatPrice = (amount: number) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 0 }).format(amount);

function planHighlights(plan: UpgradePlanRow): string[] {
  const limits = plan.features?.limits ?? {};
  const out: string[] = [];
  const describe = (value: number | undefined, unlimited: string, counted: (n: number) => string) => {
    if (value === undefined || value === null) return;
    if (value === -1) out.push(unlimited);
    else if (value > 0) out.push(counted(value));
  };
  describe(limits.max_invoices_per_month, 'Unlimited invoices', (n) => `${n} invoices a month`);
  describe(limits.max_customers, 'Unlimited customers', (n) => `${n} customers`);
  if (plan.id === 'connect' || plan.id === 'connect_free') out.push(connectSeatsLabel(limits.max_users));
  else describe(limits.max_users, 'Unlimited users', (n) => `${n} ${n === 1 ? 'user' : 'users'}`);
  describe(limits.max_ai_replies_per_month, 'Unlimited AI replies', (n) => `${n} AI replies a month`);
  describe(limits.max_whatsapp_per_day, 'Unlimited WhatsApp messages', (n) => `${n} WhatsApp messages a day`);
  return out;
}

/** Step two of the upgrade popup: every plan of the product, billing period, coupon and payment. */
export function UpgradePlanPicker({
  moduleKey,
  initialPlanId,
  showTrialOption,
  onBack,
  onClose,
  onUpgradeSuccess,
}: UpgradePlanPickerProps) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [plans, setPlans] = useState<UpgradePlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [billingCycle, setBillingCycle] = useState<BillingCycle>('monthly');
  const [upgrading, setUpgrading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);
  const [startingTrial, setStartingTrial] = useState(false);

  const trialConfig =
    showTrialOption && moduleKey ? MODULE_ADD_CONFIG[moduleKey as Exclude<PlatformModule, 'crm'>] : null;
  /** Products that activate on their own ₹0 plan with no paid tiers; paid-only products list plans. */
  const isFreeModule = !!trialConfig && !trialConfig.trialDays && !trialConfig.paidOnly;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/subscriptions/plans');
        if (!response.ok) return;
        const data = await response.json();
        const all: UpgradePlanRow[] = data.plans || [];
        const initialPlan = initialPlanId ? all.find((p) => p.id === initialPlanId) : null;
        const productLine = moduleKey
          ? productLineForModule(moduleKey)
          : initialPlan
            ? initialPlan.product_line ?? 'billing'
            : null;
        const available = all
          .filter((p) => isPurchasableUpgradePlan(p.id) && p.is_public !== false)
          .filter((p) => !productLine || (p.product_line ?? 'billing') === productLine);
        if (cancelled) return;
        setPlans(available);
        if (available.length > 0) {
          setSelectedPlanId(available.find((p) => p.id === initialPlanId)?.id ?? available[0].id);
        }
      } catch (error) {
        console.error('Error fetching plans:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [initialPlanId, moduleKey]);

  useEffect(() => {
    setCouponApplied(false);
    setCouponMessage(null);
  }, [selectedPlanId, billingCycle]);

  const listPrice = (plan: UpgradePlanRow) => computePlanAmount(plan, billingCycle);
  const offersThreeYear = plans.some((p) => Number(p.price_3year) > 0);
  const cycleOptions: Array<{ id: BillingCycle; label: string }> = [
    { id: 'monthly', label: 'Monthly' },
    { id: 'yearly', label: 'Yearly' },
    ...(offersThreeYear ? [{ id: 'three_year' as const, label: '3 years' }] : []),
  ];
  const selectedPlan = plans.find((p) => p.id === selectedPlanId);

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
          trialConfig.trialDays ? `${trialConfig.label} ${trialConfig.trialDays}-day trial started` : `${trialConfig.label} added`,
        );
        onUpgradeSuccess?.();
        onClose();
        window.location.reload();
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Could not start the trial.');
    } finally {
      setStartingTrial(false);
    }
  }

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
      } else {
        setCouponMessage(data.error || data.message || 'That coupon is not valid.');
      }
    } catch {
      setCouponMessage('Could not check the coupon. Try again.');
    } finally {
      setCouponLoading(false);
    }
  }

  async function handleUpgrade() {
    if (!selectedPlanId || !business?.id) return;
    setUpgrading(true);
    try {
      const result = await startPlanUpgrade({
        businessId: business.id,
        planId: selectedPlanId,
        moduleKey,
        billingCycle,
        amountInr: selectedPlan ? listPrice(selectedPlan) : 0,
        couponCode: couponApplied ? couponCode.trim() : undefined,
      });
      if (result.mode === 'instant') {
        toast.success(`You're now on ${selectedPlan?.display_name ?? 'your new plan'}`);
        onUpgradeSuccess?.();
        onClose();
        window.location.reload();
      }
      // mode === 'redirect': the browser is on its way to the payment page.
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : 'The upgrade did not go through. Try again.');
    } finally {
      setUpgrading(false);
    }
  }

  return (
    <div className="px-5 pb-5 pt-4 text-[#1d2b28]">
      <div className="mb-3 flex items-center gap-2">
        {onBack && (
          <button type="button" onClick={onBack} className="rounded-lg p-1 text-[#8a7b6b] hover:bg-[#f6f0e8]" aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </button>
        )}
        <h2 className="text-lg font-semibold text-primary-600">
          {trialConfig ? `Add ${trialConfig.label}` : 'Choose your plan'}
        </h2>
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <Loader2 className="h-7 w-7 animate-spin text-accent-500" />
        </div>
      ) : (
        <>
          {trialConfig && (isFreeModule || trialConfig.trialDays) ? (
            <div className="mb-4 rounded-xl border border-[#cfe6db] bg-[#eef6f2] p-4">
              <p className="text-sm font-semibold text-[#14533f]">
                {isFreeModule ? `Add ${trialConfig.label} free` : `Start a ${trialConfig.trialDays}-day free trial`}
              </p>
              <p className="mt-1 text-sm text-[#4f7a6c]">
                {trialConfig.description} {isFreeModule ? 'No payment needed.' : 'No card needed.'}
              </p>
              <button
                type="button"
                onClick={handleStartTrial}
                disabled={startingTrial}
                className="mt-3 inline-flex items-center gap-2 rounded-lg bg-[#1f9d6a] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1a8a5d] disabled:opacity-50"
              >
                {startingTrial ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                {isFreeModule ? `Add ${trialConfig.label}` : 'Start free trial'}
              </button>
            </div>
          ) : null}

          {!isFreeModule && (
            <>
              <div className="mb-3 flex justify-center">
                <div className="inline-flex rounded-full bg-[#f3ebe1] p-0.5" role="radiogroup" aria-label="Billing period">
                  {cycleOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={billingCycle === opt.id}
                      onClick={() => setBillingCycle(opt.id)}
                      className={`rounded-full px-4 py-1.5 text-sm font-medium ${
                        billingCycle === opt.id ? 'bg-primary-600 text-[#fef6ef]' : 'text-[#6b5a48]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-4 grid max-h-[46vh] gap-2 overflow-y-auto">
                {plans.map((plan) => {
                  const isSelected = selectedPlanId === plan.id;
                  const offered = isBillingCycleOffered(plan, billingCycle);
                  const price = listPrice(plan);
                  const months = billingCycleMonths(billingCycle);
                  const saving =
                    months > 1 && Number(plan.price_monthly) > 0
                      ? Math.round((1 - price / (Number(plan.price_monthly) * months)) * 100)
                      : 0;
                  return (
                    <button
                      type="button"
                      key={plan.id}
                      onClick={() => setSelectedPlanId(plan.id)}
                      className={`rounded-xl border-[1.5px] p-3 text-left ${
                        isSelected ? 'border-accent-500 bg-[#fff8f1]' : 'border-[#ead9c6] bg-white hover:border-accent-300'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-semibold text-primary-600">{plan.display_name}</p>
                          <p className="mt-0.5 line-clamp-2 text-xs text-[#7a6c5d]">{plan.description}</p>
                        </div>
                        <div className="shrink-0 text-right">
                          {offered ? (
                            <>
                              <p className="font-semibold text-primary-600">{formatPrice(price)}</p>
                              <p className="text-[11px] text-[#7a6c5d]">
                                {billingCycle === 'three_year' ? 'for 3 years' : billingCycle === 'yearly' ? 'a year' : 'a month'}
                                {saving > 0 ? ` · save ${saving}%` : ''}
                              </p>
                            </>
                          ) : (
                            <p className="text-xs text-[#7a6c5d]">Not offered for this period</p>
                          )}
                        </div>
                      </div>
                      {isSelected && planHighlights(plan).length > 0 && (
                        <ul className="mt-2 grid gap-1">
                          {planHighlights(plan)
                            .slice(0, 4)
                            .map((h) => (
                              <li key={h} className="flex items-center gap-1.5 text-xs text-[#3d3a35]">
                                <Check className="h-3.5 w-3.5 text-[#1f9d6a]" /> {h}
                              </li>
                            ))}
                        </ul>
                      )}
                    </button>
                  );
                })}
              </div>

              {selectedPlan && listPrice(selectedPlan) > 0 && (
                <div className="mb-4 rounded-xl bg-[#f6f0e8] p-3">
                  <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-[#6b5f52]">
                    <Tag className="h-3.5 w-3.5" /> Have a coupon?
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={couponCode}
                      onChange={(e) => {
                        setCouponCode(e.target.value.toUpperCase());
                        setCouponApplied(false);
                        setCouponMessage(null);
                      }}
                      placeholder="DIWALI20"
                      className="flex-1 rounded-lg border border-[#e2d3c2] bg-white px-3 py-2 text-sm"
                    />
                    <button
                      type="button"
                      onClick={applyCoupon}
                      disabled={couponLoading || !couponCode.trim()}
                      className="rounded-lg border border-[#e2d3c2] bg-white px-4 py-2 text-sm font-semibold text-primary-600 disabled:opacity-50"
                    >
                      {couponLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Apply'}
                    </button>
                  </div>
                  {couponMessage && (
                    <p className={`mt-2 text-xs ${couponApplied ? 'text-[#1f7a55]' : 'text-red-600'}`}>{couponMessage}</p>
                  )}
                </div>
              )}

              <button
                type="button"
                onClick={handleUpgrade}
                disabled={!selectedPlanId || upgrading || (!!selectedPlan && !isBillingCycleOffered(selectedPlan, billingCycle))}
                className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent-500 text-[15px] font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                {upgrading ? (
                  <>
                    <Loader2 className="h-5 w-5 animate-spin" /> Opening payment…
                  </>
                ) : selectedPlan && listPrice(selectedPlan) <= 0 ? (
                  `Switch to ${selectedPlan.display_name}`
                ) : (
                  `Pay for ${selectedPlan?.display_name ?? 'this plan'}`
                )}
              </button>
              <p className="mt-2 flex items-center justify-center gap-1 text-[11.5px] text-[#8a7b6b]">
                <ShieldCheck className="h-3.5 w-3.5 text-[#1f9d6a]" /> Secure UPI or card · works right after payment
              </p>
            </>
          )}
        </>
      )}
    </div>
  );
}
