import type { BillingCycle } from '@/lib/subscription/apply-plan-change';
import { computePlanAmount, isBillingCycleOffered } from '@/lib/subscription/apply-plan-change';
import {
  calculateDiscount,
  validateCoupon,
  type Coupon,
} from '@/lib/subscription/coupons';
import { queryOne } from '@/lib/db';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { resolveCheckoutTax, type CheckoutTax } from '@/lib/platform-tax';
import { allocateCredit, computeUpgradeCredit, type CreditAllocation } from '@/lib/subscription/upgrade-credit';

export interface CheckoutPricingResult {
  baseAmount: number;
  discountAmount: number;
  /** The amount to pay: the price after coupon and credit, plus GST when the mode is exclusive. */
  finalAmount: number;
  /** The price after coupon, credit and the ₹1 floor, before any tax is added. */
  netAmount: number;
  /** GST mode, rate, taxable value and tax as decided now (all zero tax when the mode is none). */
  tax: CheckoutTax;
  taxableAmount: number;
  taxAmount: number;
  couponId?: string;
  couponCode?: string;
  freeMonths?: number;
  /** True when the coupon would have made the price zero on a longer cycle, so it took off one month only. */
  couponCapped?: boolean;
  /** Credit the customer's unused paid time is worth towards this plan (0 when none). */
  creditAvailable: number;
  /** The part of it taken off finalAmount (the charge never goes below ₹1). */
  creditApplied: number;
  /** creditAvailable - creditApplied: unused paid time that this purchase does not use. */
  creditUnused: number;
  creditFromTransactionId: string | null;
  /** The payments the applied credit is taken from, oldest first, with the paise taken from each. */
  creditAllocation: CreditAllocation[];
  /** The plan those payments bought (the module's current plan). */
  creditFromPlanId: string | null;
  creditUnusedDays: number;
  creditPeriodDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function resolveCheckoutPricing(params: {
  businessId: string;
  planId: string;
  billingCycle: BillingCycle;
  couponCode?: string | null;
}): Promise<CheckoutPricingResult> {
  const plan = await queryOne<{
    price_monthly: string | number;
    price_yearly: string | number;
    price_3year: string | number | null;
    is_active: boolean;
  }>(
    `SELECT price_monthly, price_yearly, price_3year, is_active FROM subscription_plans WHERE id = $1`,
    [params.planId],
  );

  if (!plan?.is_active) {
    throw new Error('Invalid or inactive plan');
  }
  if (!isBillingCycleOffered(plan, params.billingCycle)) {
    throw new Error('This billing period is not offered for this plan');
  }

  const baseAmount = computePlanAmount(plan, params.billingCycle);
  let discountAmount = 0;
  let couponId: string | undefined;
  let couponCode: string | undefined;
  let freeMonths: number | undefined;
  let couponCapped = false;

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
      couponCapped = validation.discount.capped === true;
    }
  }

  // Order: list price, coupon, upgrade credit, floor at ₹1. The ₹0 coupon path and an amount
  // already below ₹1 after the coupon are left exactly as they were (no credit is looked up).
  const afterCoupon = Math.max(0, round2(baseAmount - discountAmount));
  let finalAmount = afterCoupon;
  let creditAvailable = 0;
  let creditApplied = 0;
  let creditFromTransactionId: string | null = null;
  let creditAllocation: CreditAllocation[] = [];
  let creditFromPlanId: string | null = null;
  let creditUnusedDays = 0;
  let creditPeriodDays = 0;

  if (afterCoupon >= 1) {
    // The product is the target plan's own, never a value the client sent.
    const moduleKey = await resolveModuleKeyForPlan(params.planId);
    const credit = await computeUpgradeCredit(params.businessId, moduleKey, params.planId);
    creditAvailable = credit.amount;
    if (credit.amount > 0) {
      // A gateway cannot take less than ₹1, so the credit used stops at price - ₹1.
      creditApplied = Math.min(credit.amount, round2(afterCoupon - 1));
      finalAmount = round2(afterCoupon - creditApplied);
      if (creditApplied > 0) {
        creditAllocation = allocateCredit(credit.sources, Math.round(creditApplied * 100));
        creditFromTransactionId =
          creditAllocation.reduce((a, b) => (b.paise > a.paise ? b : a)).id;
        creditFromPlanId = credit.fromPlanId;
        creditUnusedDays = credit.unusedDays;
        creditPeriodDays = credit.periodDays;
      }
    }
  }

  // Tax is applied last, to the amount after coupon, credit and the ₹1 floor. The result is the
  // amount to pay; with GST off (the default) it is exactly finalAmount as computed above.
  const tax = await resolveCheckoutTax(params.businessId, Math.round(finalAmount * 100));

  return {
    baseAmount,
    discountAmount,
    finalAmount: tax.breakdown.payablePaise / 100,
    netAmount: finalAmount,
    tax,
    taxableAmount: tax.breakdown.taxablePaise / 100,
    taxAmount: tax.breakdown.taxPaise / 100,
    creditAvailable,
    creditApplied,
    creditUnused: round2(creditAvailable - creditApplied),
    creditFromTransactionId,
    creditAllocation,
    creditFromPlanId,
    creditUnusedDays,
    creditPeriodDays,
    couponId,
    couponCode,
    freeMonths,
    couponCapped,
  };
}

export function formatCouponSuccessMessage(
  coupon: Coupon,
  pricing: CheckoutPricingResult,
): string {
  if (pricing.freeMonths) {
    return `Coupon applied: ${pricing.freeMonths} month(s) free on this plan.`;
  }
  if (pricing.couponCapped) {
    return `Coupon applied: you save ₹${pricing.discountAmount.toLocaleString('en-IN')} (one month). A coupon takes off at most one month on a longer plan, so you pay the rest.`;
  }
  if (pricing.discountAmount > 0) {
    return `Coupon applied: you save ₹${pricing.discountAmount.toLocaleString('en-IN')}.`;
  }
  return 'Coupon is valid for this plan.';
}
