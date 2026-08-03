import { recordBillingTransaction } from '@/lib/platform-billing';
import { notifyAdminsSubscriptionChange, getBusinessPlatformRecipient } from '@/lib/platform-email';
import { redeemCoupon } from '@/lib/subscription/coupons';
import {
  applySubscriptionPlanChange,
  extendSubscriptionForFreeMonths,
  type BillingCycle,
} from '@/lib/subscription/apply-plan-change';
import {
  applyModuleSubscriptionPlanChange,
  extendModuleSubscriptionForFreeMonths,
} from '@/lib/subscription/apply-module-plan-change';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { normalizePlatformModule } from '@/lib/platform-modules';
import { formatModulePlanReceiptLabel } from '@/lib/subscription/billing-labels';
import type { CheckoutPricingResult } from '@/lib/subscription/checkout-pricing';

/** Zero-amount upgrade (100% coupon, free_months, or free plan) with optional coupon redemption. */
export async function applyInstantPlanUpgradeWithCoupon(params: {
  businessId: string;
  planId: string;
  planDisplayName: string;
  billingCycle: BillingCycle;
  pricing: CheckoutPricingResult;
  paymentMethod?: string;
  moduleKey?: string | null;
}): Promise<{ subscription_id?: string; module_key?: string }> {
  const moduleKey =
    normalizePlatformModule(params.moduleKey) ?? (await resolveModuleKeyForPlan(params.planId));

  let sub: { subscription_id?: string; module_key?: string };
  try {
    const moduleSub = await applyModuleSubscriptionPlanChange({
      businessId: params.businessId,
      moduleKey,
      planId: params.planId,
      billingCycle: params.billingCycle,
      paymentMethod: params.paymentMethod ?? 'coupon',
    });
    sub = { module_key: moduleSub.module_key };
  } catch {
    const legacy = await applySubscriptionPlanChange({
      businessId: params.businessId,
      planId: params.planId,
      billingCycle: params.billingCycle,
      paymentMethod: params.paymentMethod ?? 'coupon',
    });
    sub = { subscription_id: legacy.subscription_id };
  }

  if (params.pricing.freeMonths && params.pricing.freeMonths > 0) {
    try {
      await extendModuleSubscriptionForFreeMonths(
        params.businessId,
        moduleKey,
        params.pricing.freeMonths,
      );
    } catch {
      await extendSubscriptionForFreeMonths(
        params.businessId,
        params.pricing.freeMonths,
      );
    }
  }

  if (params.pricing.couponId) {
    const { id: billingTxId } = await recordBillingTransaction({
      businessId: params.businessId,
      subscriptionId: sub.subscription_id ?? null,
      planId: params.planId,
      moduleKey,
      amount: params.pricing.baseAmount,
      discountAmount: params.pricing.discountAmount,
      couponId: params.pricing.couponId,
      billingCycle: params.billingCycle,
      paymentMethod: 'coupon',
      status: 'completed',
      description: formatModulePlanReceiptLabel(
        moduleKey,
        params.planDisplayName,
        params.billingCycle,
      ) + ' (coupon)',
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
      subscriptionId: sub.subscription_id ?? null,
      planId: params.planId,
      moduleKey,
      amount: 0,
      billingCycle: params.billingCycle,
      paymentMethod: params.paymentMethod ?? 'manual',
      status: 'completed',
      description: formatModulePlanReceiptLabel(
        moduleKey,
        params.planDisplayName,
        params.billingCycle,
      ),
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

  return sub;
}
