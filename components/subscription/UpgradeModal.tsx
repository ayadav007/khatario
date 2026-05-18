'use client';

import { useState, useEffect } from 'react';
import { X, Check, Loader2, TrendingUp, Tag } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { useToastContext } from '@/contexts/ToastContext';
import { startPlanUpgrade } from '@/lib/subscription/client-upgrade';

interface SubscriptionPlan {
  id: string;
  name: string;
  display_name: string;
  description: string;
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
  sort_order: number;
}

interface UpgradeModalProps {
  limitType?: 'invoices' | 'customers' | 'items' | 'users' | 'whatsapp' | 'feature';
  currentCount?: number;
  limit?: number;
  featureName?: string;
  onClose: () => void;
  onUpgradeSuccess?: () => void;
}

export function UpgradeModal({
  limitType,
  currentCount,
  limit,
  featureName,
  onClose,
  onUpgradeSuccess,
}: UpgradeModalProps) {
  const { business } = useAuth();
  const toast = useToastContext();
  const [plans, setPlans] = useState<SubscriptionPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedPlanId, setSelectedPlanId] = useState<string>('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'yearly'>('monthly');
  const [upgrading, setUpgrading] = useState(false);
  const [couponCode, setCouponCode] = useState('');
  const [couponApplied, setCouponApplied] = useState(false);
  const [couponMessage, setCouponMessage] = useState<string | null>(null);
  const [couponLoading, setCouponLoading] = useState(false);

  useEffect(() => {
    fetchPlans();
  }, []);

  useEffect(() => {
    setCouponApplied(false);
    setCouponMessage(null);
  }, [selectedPlanId, billingCycle]);

  function listPrice(plan: SubscriptionPlan): number {
    return billingCycle === 'yearly'
      ? Number(plan.price_yearly) || 0
      : Number(plan.price_monthly) || 0;
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
      const response = await fetch('/api/admin/subscriptions/plans');
      if (response.ok) {
        const data = await response.json();
        const availablePlans = (data.plans || []).filter((p: SubscriptionPlan) => p.id !== 'free');
        setPlans(availablePlans);
        
        // Auto-select the first plan (usually Professional)
        if (availablePlans.length > 0) {
          setSelectedPlanId(availablePlans[0].id);
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
      whatsapp: 'WhatsApp integration is not available in your current plan.',
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
    const limits = plan.features.limits;
    const highlights: string[] = [];

    if (limits.max_invoices_per_month === -1) {
      highlights.push('Unlimited invoices');
    } else {
      highlights.push(`${limits.max_invoices_per_month} invoices/month`);
    }

    if (limits.max_customers === -1) {
      highlights.push('Unlimited customers');
    } else {
      highlights.push(`${limits.max_customers} customers`);
    }

    if (limits.max_users === -1) {
      highlights.push('Unlimited users');
    } else {
      highlights.push(`${limits.max_users} user(s)`);
    }

    if (limits.max_whatsapp_per_day > 0) {
      highlights.push(`${limits.max_whatsapp_per_day} WhatsApp messages/day`);
    }

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
            <h2 className="text-2xl font-bold text-gray-900">Upgrade Your Plan</h2>
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

        {/* Billing Cycle Toggle */}
        <div className="p-6 border-b border-gray-200 bg-gray-50">
          <div className="flex items-center justify-center gap-4">
            <span className={`text-sm font-medium ${billingCycle === 'monthly' ? 'text-gray-900' : 'text-gray-500'}`}>
              Monthly
            </span>
            <button
              type="button"
              onClick={() => setBillingCycle(billingCycle === 'monthly' ? 'yearly' : 'monthly')}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                billingCycle === 'yearly' ? 'bg-primary-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  billingCycle === 'yearly' ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm font-medium ${billingCycle === 'yearly' ? 'text-gray-900' : 'text-gray-500'}`}>
              Yearly
            </span>
            {billingCycle === 'yearly' && (
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded-full font-medium">
                Save up to 17%
              </span>
            )}
          </div>
        </div>

        {/* Plans Grid */}
        <div className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {plans.map((plan) => {
              const isSelected = selectedPlanId === plan.id;
              const price = billingCycle === 'yearly' ? plan.price_yearly : plan.price_monthly;
              const monthlyEquivalent = billingCycle === 'yearly' ? Math.round(plan.price_yearly / 12) : plan.price_monthly;

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
                    <div className="flex items-baseline">
                      <span className="text-3xl font-bold text-gray-900">{formatPrice(price)}</span>
                      {billingCycle === 'yearly' && (
                        <span className="text-sm text-gray-500 ml-2">/year</span>
                      )}
                      {billingCycle === 'monthly' && (
                        <span className="text-sm text-gray-500 ml-2">/month</span>
                      )}
                    </div>
                    {billingCycle === 'yearly' && (
                      <p className="text-xs text-gray-500 mt-1">
                        {formatPrice(monthlyEquivalent)}/month billed annually
                      </p>
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
              disabled={!selectedPlanId || upgrading}
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
              You&apos;ll be redirected to Razorpay for secure payment. Your plan activates after payment
              is confirmed.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

