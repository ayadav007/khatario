import { query } from '@/lib/db';
import { markCheckoutFailedIfPending, recordBillingTransaction, updateBillingTransactionStatus } from '@/lib/platform-billing';
import { notifyAdminsSubscriptionChange, getBusinessPlatformRecipient } from '@/lib/platform-email';
import { redeemCoupon, releaseCouponClaim } from '@/lib/subscription/coupons';
import { type BillingCycle } from '@/lib/subscription/apply-plan-change';
import {
  applyModuleSubscriptionPlanChange,
  extendModuleSubscriptionForFreeMonths,
} from '@/lib/subscription/apply-module-plan-change';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { normalizePlatformModule } from '@/lib/platform-modules';
import { formatModulePlanReceiptLabel } from '@/lib/subscription/billing-labels';
import type { CheckoutPricingResult } from '@/lib/subscription/checkout-pricing';

/** Period the row paid for = the module row after the plan change and any free months (not transactional here). */
async function recordPeriodFromModuleRow(
  txId: string,
  businessId: string,
  moduleKey: string,
  paidFrom?: string,
): Promise<void> {
  try {
    await query(
      `UPDATE billing_transactions bt
       SET period_start = COALESCE($4::date, bms.start_date), period_end = bms.end_date
       FROM business_module_subscriptions bms
       WHERE bt.id = $1 AND bms.business_id = $2 AND bms.module_key = $3
         AND bt.business_id = bms.business_id`,
      [txId, businessId, moduleKey, paidFrom ?? null],
    );
  } catch (err) {
    // Informational column only: never skip coupon redemption or fail the upgrade over it.
    console.error('[apply-coupon-upgrade] failed to record billing period', err);
  }
}

/** Zero-amount upgrade (100% coupon, free_months, or free plan) with optional coupon redemption. */
export async function applyInstantPlanUpgradeWithCoupon(params: {
  businessId: string;
  planId: string;
  planDisplayName: string;
  billingCycle: BillingCycle;
  pricing: CheckoutPricingResult;
  paymentMethod?: string;
  moduleKey?: string | null;
}): Promise<{ module_key: string }> {
  const moduleKey =
    normalizePlatformModule(params.moduleKey) ?? (await resolveModuleKeyForPlan(params.planId));

  // With a coupon the order is: record the payment row (pending), claim the redemption under the
  // coupon lock (this is where a coupon that ran out or was already used is refused, before the
  // customer gets anything), then switch the plan, then complete the row. Every redemption carries
  // its payment row id, so the unique key always applies.
  let couponTxId: string | null = null;
  if (params.pricing.couponId) {
    const { id } = await recordBillingTransaction({
      businessId: params.businessId,
      planId: params.planId,
      moduleKey,
      amount: params.pricing.baseAmount,
      discountAmount: params.pricing.discountAmount,
      couponId: params.pricing.couponId,
      billingCycle: params.billingCycle,
      paymentMethod: 'coupon',
      status: 'pending',
      skipEmails: true,
      description: formatModulePlanReceiptLabel(
        moduleKey,
        params.planDisplayName,
        params.billingCycle,
      ) + ' (coupon)',
    });
    couponTxId = id;
    try {
      await redeemCoupon(
        params.pricing.couponId,
        params.businessId,
        params.planId,
        id,
        params.billingCycle,
        undefined,
        { strict: true },
      );
    } catch (err) {
      await markCheckoutFailedIfPending(id, params.businessId, { reason: 'coupon_unavailable' }, false).catch(() => undefined);
      throw err;
    }
  }

  let moduleSub: Awaited<ReturnType<typeof applyModuleSubscriptionPlanChange>>;
  try {
    moduleSub = await applyModuleSubscriptionPlanChange({
      businessId: params.businessId,
      moduleKey,
      planId: params.planId,
      billingCycle: params.billingCycle,
      paymentMethod: params.paymentMethod ?? 'coupon',
    });
    if (params.pricing.freeMonths && params.pricing.freeMonths > 0) {
      await extendModuleSubscriptionForFreeMonths(
        params.businessId,
        moduleKey,
        params.pricing.freeMonths,
      );
    }
  } catch (err) {
    if (couponTxId && params.pricing.couponId) {
      await releaseCouponClaim(params.pricing.couponId, params.businessId, couponTxId).catch((e) =>
        console.error('[apply-coupon-upgrade] could not release coupon claim', e),
      );
      await markCheckoutFailedIfPending(couponTxId, params.businessId, { reason: 'plan_change_failed' }, false).catch(() => undefined);
    }
    throw err;
  }
  const sub = { module_key: moduleSub.module_key };

  if (couponTxId) {
    await updateBillingTransactionStatus(couponTxId, 'completed');
    await recordPeriodFromModuleRow(couponTxId, params.businessId, moduleKey, moduleSub.paidFrom);
  } else if (params.pricing.finalAmount <= 0 && params.pricing.baseAmount <= 0) {
    const { id: zeroTxId } = await recordBillingTransaction({
      businessId: params.businessId,
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
    await recordPeriodFromModuleRow(zeroTxId, params.businessId, moduleKey, moduleSub.paidFrom);
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
