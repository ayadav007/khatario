/**
 * Client-side helper: free / 100% coupon → instant; paid → Razorpay checkout redirect.
 */

export type BillingCycle = 'monthly' | 'yearly';

export interface StartPlanUpgradeParams {
  businessId: string;
  planId: string;
  billingCycle?: BillingCycle;
  /** Pre-discount list price from UI */
  amountInr: number;
  couponCode?: string;
}

export interface StartPlanUpgradeResult {
  mode: 'instant' | 'redirect';
}

export async function startPlanUpgrade(
  params: StartPlanUpgradeParams,
): Promise<StartPlanUpgradeResult> {
  const billingCycle = params.billingCycle ?? 'monthly';
  const couponCode = params.couponCode?.trim() || undefined;

  if (params.amountInr <= 0 && !couponCode) {
    const res = await fetch('/api/subscriptions/upgrade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        business_id: params.businessId,
        plan_id: params.planId,
        billing_cycle: billingCycle,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'Failed to upgrade plan');
    }
    return { mode: 'instant' };
  }

  const res = await fetch('/api/subscriptions/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      business_id: params.businessId,
      plan_id: params.planId,
      billing_cycle: billingCycle,
      coupon_code: couponCode,
    }),
  });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    if (data.code === 'PAYMENT_NOT_CONFIGURED') {
      throw new Error(
        data.error ||
          'Online payments are not available. Please contact support.',
      );
    }
    if (data.code === 'INVALID_COUPON') {
      throw new Error(data.error || 'Invalid coupon code');
    }
    throw new Error(data.error || data.details || 'Failed to start checkout');
  }

  if (data.mode === 'instant') {
    return { mode: 'instant' };
  }

  if (!data.checkoutUrl) {
    throw new Error('No checkout URL returned');
  }

  window.location.href = data.checkoutUrl;
  return { mode: 'redirect' };
}
