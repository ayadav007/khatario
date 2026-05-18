import type { BillingCycle } from '@/lib/subscription/apply-plan-change';
import { computePlanAmount } from '@/lib/subscription/apply-plan-change';
import {
  calculateDiscount,
  validateCoupon,
  type Coupon,
} from '@/lib/subscription/coupons';
import { queryOne } from '@/lib/db';

export interface CheckoutPricingResult {
  baseAmount: number;
  discountAmount: number;
  finalAmount: number;
  couponId?: string;
  couponCode?: string;
  freeMonths?: number;
}

export async function resolveCheckoutPricing(params: {
  businessId: string;
  planId: string;
  billingCycle: BillingCycle;
  couponCode?: string | null;
}): Promise<CheckoutPricingResult> {
  const plan = await queryOne<{
    price_monthly: string | number;
    price_yearly: string | number;
    is_active: boolean;
  }>(
    `SELECT price_monthly, price_yearly, is_active FROM subscription_plans WHERE id = $1`,
    [params.planId],
  );

  if (!plan?.is_active) {
    throw new Error('Invalid or inactive plan');
  }

  const baseAmount = computePlanAmount(plan, params.billingCycle);
  let discountAmount = 0;
  let couponId: string | undefined;
  let couponCode: string | undefined;
  let freeMonths: number | undefined;

  if (params.couponCode?.trim()) {
    const validation = await validateCoupon(
      params.couponCode.trim(),
      params.businessId,
      params.planId,
      params.billingCycle,
    );
    if (!validation.valid || !validation.coupon) {
      throw new Error(validation.error || 'Invalid coupon');
    }
    couponId = validation.coupon.id;
    couponCode = validation.coupon.code;

    if (validation.coupon.type === 'free_months') {
      freeMonths = validation.coupon.value;
      discountAmount = 0;
    } else if (validation.discount) {
      discountAmount = Math.round(validation.discount.amount * 100) / 100;
    }
  }

  const finalAmount = Math.max(
    0,
    Math.round((baseAmount - discountAmount) * 100) / 100,
  );

  return {
    baseAmount,
    discountAmount,
    finalAmount,
    couponId,
    couponCode,
    freeMonths,
  };
}

export function formatCouponSuccessMessage(
  coupon: Coupon,
  pricing: CheckoutPricingResult,
): string {
  if (pricing.freeMonths) {
    return `Coupon applied: ${pricing.freeMonths} month(s) free on this plan.`;
  }
  if (pricing.discountAmount > 0) {
    return `Coupon applied: you save ₹${pricing.discountAmount.toLocaleString('en-IN')}.`;
  }
  return 'Coupon is valid for this plan.';
}
