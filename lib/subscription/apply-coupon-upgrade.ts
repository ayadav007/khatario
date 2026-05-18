import { recordBillingTransaction } from '@/lib/platform-billing';
import { notifyAdminsSubscriptionChange, getBusinessPlatformRecipient } from '@/lib/platform-email';
import { redeemCoupon } from '@/lib/subscription/coupons';
import {
  applySubscriptionPlanChange,
  extendSubscriptionForFreeMonths,
  type BillingCycle,
} from '@/lib/subscription/apply-plan-change';
import type { CheckoutPricingResult } from '@/lib/subscription/checkout-pricing';

/** Zero-amount upgrade (100% coupon, free_months, or free plan) with optional coupon redemption. */
export async function applyInstantPlanUpgradeWithCoupon(params: {
  businessId: string;
  planId: string;
  planDisplayName: string;
  billingCycle: BillingCycle;
  pricing: CheckoutPricingResult;
  paymentMethod?: string;
}): Promise<{ subscription_id: string }> {
  const sub = await applySubscriptionPlanChange({
    businessId: params.businessId,
    planId: params.planId,
    billingCycle: params.billingCycle,
    paymentMethod: params.paymentMethod ?? 'coupon',
  });

  if (params.pricing.freeMonths && params.pricing.freeMonths > 0) {
    await extendSubscriptionForFreeMonths(
      params.businessId,
      params.pricing.freeMonths,
    );
  }

  if (params.pricing.couponId) {
    const { id: billingTxId } = await recordBillingTransaction({
      businessId: params.businessId,
      subscriptionId: sub.subscription_id,
      planId: params.planId,
      amount: params.pricing.baseAmount,
      discountAmount: params.pricing.discountAmount,
      couponId: params.pricing.couponId,
      billingCycle: params.billingCycle,
      paymentMethod: 'coupon',
      status: 'completed',
      description: `Upgrade to ${params.planDisplayName} (coupon)`,
    });
    await redeemCoupon(
      params.pricing.couponId,
      params.businessId,
      params.planId,
      billingTxId,
    );
  } else if (params.pricing.finalAmount <= 0 && params.pricing.baseAmount <= 0) {
    await recordBillingTransaction({
      businessId: params.businessId,
      subscriptionId: sub.subscription_id,
      planId: params.planId,
      amount: 0,
      billingCycle: params.billingCycle,
      paymentMethod: params.paymentMethod ?? 'manual',
      status: 'completed',
      description: `Upgrade to ${params.planDisplayName}`,
      skipEmails: false,
    });
  }

  const recipient = await getBusinessPlatformRecipient(params.businessId);
  await notifyAdminsSubscriptionChange({
    businessId: params.businessId,
    businessName: recipient?.businessName || params.businessId,
    planDisplayName: params.planDisplayName,
    event: 'upgraded',
  });

  return { subscription_id: sub.subscription_id };
}
