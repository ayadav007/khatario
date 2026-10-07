/**

 * Platform SaaS subscription checkout via Razorpay Payment Links.

 */



import { query, queryOne } from '@/lib/db';

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

  recordBillingTransaction,

  updateBillingTransactionStatus,

} from '@/lib/platform-billing';

import { type BillingCycle } from '@/lib/subscription/apply-plan-change';

import { applyModuleSubscriptionPlanChange } from '@/lib/subscription/apply-module-plan-change';

import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { BillingTransactionStateError } from '@/lib/platform-billing-transaction-state';

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

           gateway_response = $3::jsonb,

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



/** Complete upgrade after Razorpay webhook (or internal reconciliation). */

export async function completeSubscriptionCheckoutPayment(params: {

  businessId: string;

  planId: string;

  billingCycle: BillingCycle;

  billingTransactionId?: string | null;

  providerPaymentId?: string | null;

  amount: number;

  gatewayResponse?: unknown;

  paymentMethod?: PlatformPaymentProviderId;

}): Promise<void> {

  const paymentMethod = params.paymentMethod ?? 'razorpay';

  const plan = await queryOne<{ display_name: string }>(

    `SELECT display_name FROM subscription_plans WHERE id = $1`,

    [params.planId],

  );

  const moduleKey = await resolveModuleKeyForPlan(params.planId);



  let couponId: string | null = null;

  if (!params.billingTransactionId) {
    throw new Error('CHECKOUT_TRANSACTION_REQUIRED');
  }

  const tx = await queryOne<{ coupon_id: string | null; status: string }>(
    `SELECT coupon_id, status FROM billing_transactions WHERE id = $1 AND business_id = $2`,
    [params.billingTransactionId, params.businessId],
  );

  if (!tx) {
    throw new Error('CHECKOUT_TRANSACTION_NOT_FOUND');
  }

  if (tx.status !== 'pending') {
    throw new BillingTransactionStateError(
      'INVALID_STATUS_TRANSITION',
      `Checkout transaction is already ${tx.status}`,
      tx.status as 'pending' | 'completed' | 'failed' | 'refunded',
      'completed',
    );
  }

  couponId = tx.coupon_id ?? null;

  await updateBillingTransactionStatus(
    params.billingTransactionId,
    'completed',
    params.gatewayResponse,
  );

  if (params.providerPaymentId) {
    await query(
      `UPDATE billing_transactions
       SET payment_reference = COALESCE(payment_reference, $2)
       WHERE id = $1`,
      [params.billingTransactionId, params.providerPaymentId],
    );
  }

  await applyModuleSubscriptionPlanChange({
    businessId: params.businessId,
    moduleKey,
    planId: params.planId,
    billingCycle: params.billingCycle,
    paymentMethod,
    paymentReference: params.providerPaymentId,
  });



  if (couponId) {

    await redeemCoupon(

      couponId,

      params.businessId,

      params.planId,

      params.billingTransactionId ?? undefined,

    );

  }



  const recipient = await getBusinessPlatformRecipient(params.businessId);

  await notifyAdminsSubscriptionChange({

    businessId: params.businessId,

    businessName: recipient?.businessName || params.businessId,

    planDisplayName: plan?.display_name || params.planId,

    event: 'upgraded',

  });

  // Partner commission: only when payment settled (not on free trial).
  try {
    const { maybeCreatePartnerCommissionOnPayment } = await import('@/lib/partners/commission');
    const saleAmount =
      (await queryOne<{ total_amount: string | number }>(
        `SELECT COALESCE(total_amount, amount, 0) AS total_amount
         FROM billing_transactions WHERE id = $1`,
        [params.billingTransactionId],
      ))?.total_amount ?? params.amount;
    await maybeCreatePartnerCommissionOnPayment({
      businessId: params.businessId,
      billingTransactionId: params.billingTransactionId,
      saleAmount: Number(saleAmount) || params.amount,
    });
  } catch (partnerErr) {
    console.error('Partner commission on checkout settlement failed:', partnerErr);
  }

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


