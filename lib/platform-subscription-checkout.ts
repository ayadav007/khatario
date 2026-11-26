/**

 * Platform SaaS subscription checkout via Razorpay Payment Links.

 */



import type { PoolClient } from 'pg';

import { getPool, query, queryOne } from '@/lib/db';

import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';

import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';

import {
  isEasebuzzReady,
  isRazorpayReady,
  loadPlatformPaymentSecrets,
  type PlatformPaymentProviderId,
  type PlatformPaymentSecrets,
} from '@/lib/platform-payment-settings';

import {

  getBusinessPlatformRecipient,

  notifyAdminsSubscriptionChange,

} from '@/lib/platform-email';

import {

  notifyBillingTransactionStatus,

  PLATFORM_LINK_EXPIRY_MS,

  recordBillingTransaction,

} from '@/lib/platform-billing';

import { normalizeBillingCycle, type BillingCycle } from '@/lib/subscription/apply-plan-change';

import {
  afterPlanChangeCommitted,
  applyModuleSubscriptionPlanChange,
  extendModuleSubscriptionForFreeMonths,
  type ApplyModulePlanChangeResult,
} from '@/lib/subscription/apply-module-plan-change';

import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import {
  assertBillingTransactionTransition,
  type BillingTxStatus,
} from '@/lib/platform-billing-transaction-state';

import { formatModulePlanReceiptLabel } from '@/lib/subscription/billing-labels';

import { normalizePlatformModule } from '@/lib/platform-modules';

import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';

import { redeemCoupon } from '@/lib/subscription/coupons';

import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';



function razorpayFrom(s: PlatformPaymentSecrets): RazorpayPaymentProvider | null {
  if (!isRazorpayReady(s)) return null;
  return new RazorpayPaymentProvider({
    clientId: s.razorpay.keyId,
    clientSecret: s.razorpay.keySecret,
    webhookSecret: s.razorpay.webhookSecret,
  });
}

function easebuzzFrom(s: PlatformPaymentSecrets): EasebuzzPaymentProvider | null {
  if (!isEasebuzzReady(s)) return null;
  return new EasebuzzPaymentProvider({
    clientId: s.easebuzz.key,
    clientSecret: s.easebuzz.salt,
    environment: s.easebuzz.environment,
  });
}

/** Khatario's own Razorpay account. Still used for webhooks after switching away, so old links settle. */
export async function getPlatformRazorpayProvider(): Promise<RazorpayPaymentProvider | null> {
  return razorpayFrom(await loadPlatformPaymentSecrets());
}

export async function isPlatformRazorpayConfigured(): Promise<boolean> {
  return (await getPlatformRazorpayProvider()) !== null;
}

/** Khatario's own Easebuzz account (never a business's credentials). */
export async function getPlatformEasebuzzProvider(): Promise<EasebuzzPaymentProvider | null> {
  return easebuzzFrom(await loadPlatformPaymentSecrets());
}

export type { PlatformPaymentProviderId };

/** Admin > Settings > Payments choice; falls back to PLATFORM_PAYMENT_PROVIDER env, then Razorpay. */
export async function getPlatformPaymentProviderId(): Promise<PlatformPaymentProviderId> {
  return (await loadPlatformPaymentSecrets()).activeProvider;
}

export async function getPlatformCheckoutProvider(): Promise<
  | { id: 'razorpay'; provider: RazorpayPaymentProvider; keyId: string }
  | { id: 'easebuzz'; provider: EasebuzzPaymentProvider }
  | null
> {
  const secrets = await loadPlatformPaymentSecrets();
  if (secrets.activeProvider === 'easebuzz') {
    const provider = easebuzzFrom(secrets);
    return provider ? { id: 'easebuzz', provider } : null;
  }
  const provider = razorpayFrom(secrets);
  return provider ? { id: 'razorpay', provider, keyId: secrets.razorpay.keyId } : null;
}

export async function isPlatformPaymentConfigured(): Promise<boolean> {
  return (await getPlatformCheckoutProvider()) !== null;
}



function appBaseUrl(): string {

  return (

    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||

    'http://localhost:3000'

  );

}



export interface CreateSubscriptionCheckoutInput {

  businessId: string;

  planId: string;

  billingCycle: BillingCycle;

  couponCode?: string | null;

  moduleKey?: string | null;

}



export interface CreateSubscriptionCheckoutResult {

  checkoutUrl: string;

  amount: number;

  baseAmount: number;

  discountAmount: number;

  currency: string;

  billingTransactionId: string;

  paymentLinkId?: string;

  keyId: string;

}



export async function createSubscriptionCheckout(

  input: CreateSubscriptionCheckoutInput,

): Promise<CreateSubscriptionCheckoutResult> {

  if (input.planId === TRIAL_PLAN_ID) {

    throw new Error('Trial plan cannot be purchased');

  }



  const plan = await queryOne<{

    id: string;

    display_name: string;

    price_monthly: string | number;

    price_yearly: string | number;

    is_active: boolean;

  }>(

    `SELECT id, display_name, price_monthly, price_yearly, is_active

     FROM subscription_plans WHERE id = $1`,

    [input.planId],

  );



  if (!plan?.is_active) {

    throw new Error('Invalid or inactive plan');

  }



  const pricing = await resolveCheckoutPricing({

    businessId: input.businessId,

    planId: input.planId,

    billingCycle: input.billingCycle,

    couponCode: input.couponCode,

  });



  if (pricing.baseAmount <= 0 && pricing.finalAmount <= 0) {

    throw new Error('FREE_PLAN_USE_UPGRADE');

  }



  if (pricing.finalAmount <= 0) {

    throw new Error('ZERO_AMOUNT_USE_INSTANT');

  }



  const checkout = await getPlatformCheckoutProvider();

  if (!checkout) {

    throw new Error('PAYMENT_NOT_CONFIGURED');

  }

  const provider = checkout.provider;



  const recipient = await getBusinessPlatformRecipient(input.businessId);

  const moduleKey =
    normalizePlatformModule(input.moduleKey) ?? (await resolveModuleKeyForPlan(input.planId));

  const pending = await recordBillingTransaction({

    businessId: input.businessId,

    planId: input.planId,

    moduleKey,

    amount: pricing.baseAmount,

    discountAmount: pricing.discountAmount,

    couponId: pricing.couponId ?? null,

    billingCycle: input.billingCycle,

    paymentMethod: checkout.id,

    status: 'pending',

    description: formatModulePlanReceiptLabel(
      moduleKey,
      plan.display_name,
      input.billingCycle,
    ),

    skipEmails: true,

    // Written at creation so the row says what it is even if the provider returns no payment id.
    gatewayResponse: { checkout_type: 'subscription', provider: checkout.id },

  });



  const returnUrl = `${appBaseUrl()}/settings/subscription?payment=success&plan=${encodeURIComponent(plan.display_name)}`;

  const cancelUrl = `${appBaseUrl()}/settings/subscription?payment=cancelled`;



  const link = await provider.createHostedPaymentLink({

    businessId: input.businessId,

    orderId: pending.id,

    amount: pricing.finalAmount,

    currency: 'INR',

    customerName: recipient?.businessName,

    customerEmail: recipient?.email ?? undefined,

    returnUrl,

    expiresAt: new Date(Date.now() + PLATFORM_LINK_EXPIRY_MS),

    metadata: {

      description: `Khatario ${plan.display_name} — ${input.billingCycle}`,

      plan_id: input.planId,

      billing_cycle: input.billingCycle,

      module_key: moduleKey,

      billing_transaction_id: pending.id,

      coupon_id: pricing.couponId ?? '',

      cancel_url: cancelUrl,

      ...(checkout.id === 'easebuzz' ? { easebuzz_context: 'PB' } : {}),

    },

  });



  if (link.providerPaymentId) {

    await query(

      `UPDATE billing_transactions

       SET payment_reference = $2,

           gateway_response = COALESCE(gateway_response, '{}'::jsonb) || $3::jsonb,

           updated_at = CURRENT_TIMESTAMP

       WHERE id = $1`,

      [

        pending.id,

        link.providerPaymentId,

        JSON.stringify({
          payment_link_id: link.providerPaymentId,
          short_url: link.paymentUrl,
          provider: checkout.id,
          checkout_type: 'subscription',
        }),

      ],

    );

  }



  if (!link.paymentUrl) {

    throw new Error('Payment provider did not return a checkout URL');

  }



  const keyId = checkout.id === 'razorpay' ? checkout.keyId : '';



  return {

    checkoutUrl: link.paymentUrl,

    amount: pricing.finalAmount,

    baseAmount: pricing.baseAmount,

    discountAmount: pricing.discountAmount,

    currency: 'INR',

    billingTransactionId: pending.id,

    paymentLinkId: link.providerPaymentId,

    keyId,

  };

}



export type CheckoutCompletion = 'activated' | 'already_completed';

/**
 * Complete a hosted checkout after a verified gateway payment (Razorpay webhook, Easebuzz callback).
 *
 * One transaction: lock the billing row, check status and paid amount, mark it completed and
 * activate the plan stored on that row. A second event for the same payment waits on the row
 * lock, then sees `completed` and returns `already_completed` without side effects.
 * `planId` / `billingCycle` in params are accepted for compatibility and ignored.
 * Throws `Error('AMOUNT_MISMATCH')` when the paid amount differs from the row's total.
 */
export async function completeSubscriptionCheckoutPayment(params: {

  businessId: string;

  planId: string;

  billingCycle: BillingCycle;

  billingTransactionId?: string | null;

  providerPaymentId?: string | null;

  /** Paid amount in rupees, from the verified gateway event. */
  amount: number;

  gatewayResponse?: unknown;

  paymentMethod?: PlatformPaymentProviderId;

}): Promise<CheckoutCompletion> {

  const paymentMethod = params.paymentMethod ?? 'razorpay';

  if (!params.billingTransactionId) {
    throw new Error('CHECKOUT_TRANSACTION_REQUIRED');
  }
  const billingTransactionId = params.billingTransactionId;
  const paymentReference = params.providerPaymentId?.trim() || null;

  const client: PoolClient = await getPool().connect();
  let committed: {
    planId: string;
    totalAmount: number;
    result: ApplyModulePlanChangeResult;
  };

  try {
    await client.query('BEGIN');

    const locked = await client.query<{
      status: BillingTxStatus;
      plan_id: string | null;
      billing_cycle: string | null;
      coupon_id: string | null;
      total_amount: string | null;
      checkout_type: string | null;
    }>(
      `SELECT status, plan_id, billing_cycle, coupon_id, total_amount::text AS total_amount,
              gateway_response->>'checkout_type' AS checkout_type
       FROM billing_transactions
       WHERE id = $1 AND business_id = $2
       FOR UPDATE`,
      [billingTransactionId, params.businessId],
    );
    const tx = locked.rows[0];

    if (!tx) {
      throw new Error('CHECKOUT_TRANSACTION_NOT_FOUND');
    }

    if (tx.status === 'completed') {
      await client.query('ROLLBACK');
      return 'already_completed';
    }

    // pending -> completed and failed -> completed only (Task 4 rules).
    assertBillingTransactionTransition(tx.status, 'completed');

    // The stored row decides the checkout type, never the webhook notes. A row with no
    // checkout_type key predates the key and is a subscription checkout.
    if ((tx.checkout_type ?? 'subscription') !== 'subscription') {
      throw new Error('CHECKOUT_TYPE_MISMATCH');
    }

    const expectedPaise = Math.round(Number(tx.total_amount) * 100);
    const paidPaise = Number.isFinite(params.amount) ? Math.round(params.amount * 100) : Number.NaN;
    if (!Number.isFinite(expectedPaise) || paidPaise !== expectedPaise) {
      throw new Error('AMOUNT_MISMATCH');
    }

    if (!tx.plan_id) {
      throw new Error('CHECKOUT_PLAN_MISSING');
    }
    const planId = tx.plan_id;
    const billingCycle = normalizeBillingCycle(tx.billing_cycle);
    const moduleKey = await resolveModuleKeyForPlan(planId, client);

    await client.query(
      `UPDATE billing_transactions
       SET status = 'completed',
           payment_reference = COALESCE(payment_reference, $2),
           gateway_response = CASE WHEN $3::jsonb IS NULL THEN gateway_response
                                   ELSE COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('webhook', $3::jsonb) END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        billingTransactionId,
        paymentReference,
        params.gatewayResponse ? JSON.stringify(params.gatewayResponse) : null,
      ],
    );

    const result = await applyModuleSubscriptionPlanChange(
      {
        businessId: params.businessId,
        moduleKey,
        planId,
        billingCycle,
        paymentMethod,
        paymentReference,
      },
      client,
    );

    // Coupon: redeemed in the same transaction, so a paid checkout gets everything or nothing.
    if (tx.coupon_id) {
      const redeemed = await redeemCoupon(
        tx.coupon_id,
        params.businessId,
        planId,
        billingTransactionId,
        billingCycle,
        client,
      );
      if (redeemed.type === 'free_months') {
        await extendModuleSubscriptionForFreeMonths(params.businessId, moduleKey, redeemed.value, client);
      }
    }

    await client.query('COMMIT');

    committed = {
      planId,
      totalAmount: Number(tx.total_amount) || 0,
      result,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }

  // ---- After COMMIT: each side effect on its own; none of them can undo the activation. ----

  try {
    await afterPlanChangeCommitted(committed.result, {
      fromPlanId: committed.result.from_plan_id,
      paymentMethod,
      paymentReference,
      trialDaysCarried: committed.result.trial_days_carried ?? 0,
    });
  } catch (err) {
    console.error('[checkout] post-commit plan activation steps failed:', err);
  }

  try {
    await notifyBillingTransactionStatus(billingTransactionId, 'completed');
  } catch (err) {
    console.error('[checkout] payment success notification failed:', err);
  }

  try {
    const plan = await queryOne<{ display_name: string }>(
      `SELECT display_name FROM subscription_plans WHERE id = $1`,
      [committed.planId],
    );
    const recipient = await getBusinessPlatformRecipient(params.businessId);
    await notifyAdminsSubscriptionChange({
      businessId: params.businessId,
      businessName: recipient?.businessName || params.businessId,
      planDisplayName: plan?.display_name || committed.planId,
      event: 'upgraded',
    });
  } catch (err) {
    console.error('[checkout] admin subscription notice failed:', err);
  }

  // Partner commission: only when payment settled (not on free trial).
  try {
    const { maybeCreatePartnerCommissionOnPayment } = await import('@/lib/partners/commission');
    await maybeCreatePartnerCommissionOnPayment({
      businessId: params.businessId,
      billingTransactionId,
      saleAmount: committed.totalAmount || params.amount,
    });
  } catch (partnerErr) {
    console.error('Partner commission on checkout settlement failed:', partnerErr);
  }

  return 'activated';
}



export function extractCheckoutMetaFromWebhookNotes(

  verified: { rawPayload?: unknown; orderReference?: string },

): {

  businessId?: string;

  planId?: string;

  billingCycle?: BillingCycle;

  billingTransactionId?: string;

  couponId?: string;

  checkoutType?: string;

  addonType?: string;

} {

  const raw = verified.rawPayload as Record<string, unknown> | undefined;

  const payload = raw?.payload as Record<string, unknown> | undefined;

  const payment = (payload?.payment as Record<string, unknown>)?.entity as

    | Record<string, unknown>

    | undefined;

  const plink = (payload?.payment_link as Record<string, unknown>)?.entity as

    | Record<string, unknown>

    | undefined;



  const sources = [payment?.notes, plink?.notes];



  for (const notes of sources) {

    if (!notes || typeof notes !== 'object') continue;

    const n = notes as Record<string, unknown>;

    const billingCycle =

      n.billing_cycle === 'yearly' || n.billing_cycle === 'monthly' || n.billing_cycle === 'three_year'

        ? n.billing_cycle

        : undefined;

    const couponRaw = n.coupon_id;

    const couponId =

      typeof couponRaw === 'string' && couponRaw.length > 10

        ? couponRaw.trim()

        : undefined;

    return {

      businessId:

        typeof n.business_id === 'string' ? n.business_id.trim() : undefined,

      planId: typeof n.plan_id === 'string' ? n.plan_id.trim() : undefined,

      billingCycle,

      billingTransactionId:

        typeof n.billing_transaction_id === 'string'

          ? n.billing_transaction_id.trim()

          : typeof verified.orderReference === 'string'

            ? verified.orderReference.trim()

            : undefined,

      couponId,

      checkoutType:

        typeof n.checkout_type === 'string' ? n.checkout_type.trim() : undefined,

      addonType:

        typeof n.addon_type === 'string' ? n.addon_type.trim() : undefined,

    };

  }



  if (verified.orderReference) {

    return { billingTransactionId: verified.orderReference.trim() };

  }



  return {};

}


