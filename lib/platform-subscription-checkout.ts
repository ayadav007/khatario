/**

 * Platform SaaS subscription checkout via Razorpay Payment Links.

 */



import { query, queryOne } from '@/lib/db';

import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';

import {

  getBusinessPlatformRecipient,

  notifyAdminsSubscriptionChange,

} from '@/lib/platform-email';

import {

  recordBillingTransaction,

  updateBillingTransactionStatus,

} from '@/lib/platform-billing';

import {

  applySubscriptionPlanChange,

  type BillingCycle,

} from '@/lib/subscription/apply-plan-change';

import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';

import { redeemCoupon } from '@/lib/subscription/coupons';

import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';



export function getPlatformRazorpayProvider(): RazorpayPaymentProvider | null {

  const keyId = process.env.PLATFORM_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;

  const keySecret =

    process.env.PLATFORM_RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

  const webhookSecret =

    process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;



  if (!keyId || !keySecret || !webhookSecret) {

    return null;

  }



  return new RazorpayPaymentProvider({

    clientId: keyId,

    clientSecret: keySecret,

    webhookSecret,

  });

}



export function isPlatformRazorpayConfigured(): boolean {

  return getPlatformRazorpayProvider() !== null;

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



  const provider = getPlatformRazorpayProvider();

  if (!provider) {

    throw new Error('PAYMENT_NOT_CONFIGURED');

  }



  const recipient = await getBusinessPlatformRecipient(input.businessId);



  const pending = await recordBillingTransaction({

    businessId: input.businessId,

    planId: input.planId,

    amount: pricing.baseAmount,

    discountAmount: pricing.discountAmount,

    couponId: pricing.couponId ?? null,

    billingCycle: input.billingCycle,

    paymentMethod: 'razorpay',

    status: 'pending',

    description: `Checkout: ${plan.display_name} (${input.billingCycle})`,

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

      billing_transaction_id: pending.id,

      coupon_id: pricing.couponId ?? '',

      cancel_url: cancelUrl,

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

        JSON.stringify({ payment_link_id: link.providerPaymentId, short_url: link.paymentUrl }),

      ],

    );

  }



  if (!link.paymentUrl) {

    throw new Error('Razorpay did not return a checkout URL');

  }



  const keyId = process.env.PLATFORM_RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || '';



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

}): Promise<void> {

  const plan = await queryOne<{ display_name: string }>(

    `SELECT display_name FROM subscription_plans WHERE id = $1`,

    [params.planId],

  );



  let couponId: string | null = null;



  if (params.billingTransactionId) {

    const tx = await queryOne<{ coupon_id: string | null }>(

      `SELECT coupon_id FROM billing_transactions WHERE id = $1`,

      [params.billingTransactionId],

    );

    couponId = tx?.coupon_id ?? null;



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

  } else {

    await recordBillingTransaction({

      businessId: params.businessId,

      planId: params.planId,

      amount: params.amount,

      billingCycle: params.billingCycle,

      paymentMethod: 'razorpay',

      paymentReference: params.providerPaymentId,

      status: 'completed',

      description: 'Razorpay webhook payment',

      gatewayResponse: params.gatewayResponse,

    });

  }



  await applySubscriptionPlanChange({

    businessId: params.businessId,

    planId: params.planId,

    billingCycle: params.billingCycle,

    paymentMethod: 'razorpay',

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

}



export function extractCheckoutMetaFromWebhookNotes(

  verified: { rawPayload?: unknown; orderReference?: string },

): {

  businessId?: string;

  planId?: string;

  billingCycle?: BillingCycle;

  billingTransactionId?: string;

  couponId?: string;

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

      n.billing_cycle === 'yearly' || n.billing_cycle === 'monthly'

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

    };

  }



  if (verified.orderReference) {

    return { billingTransactionId: verified.orderReference.trim() };

  }



  return {};

}


