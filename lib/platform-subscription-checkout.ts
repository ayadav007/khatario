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

  sendPlatformEmail,

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
  isPaymentReferenceViolation,
  type BillingTxStatus,
} from '@/lib/platform-billing-transaction-state';

import { formatModulePlanReceiptLabel } from '@/lib/subscription/billing-labels';

import { normalizePlatformModule } from '@/lib/platform-modules';

import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';

import { isTaxedMode, issueInvoiceNumber } from '@/lib/platform-tax';
import { escapeHtml } from '@/lib/platform-receipt';

import { redeemCoupon } from '@/lib/subscription/coupons';

import {
  consumeCreditSources,
  recheckUpgradeCredit,
  type StoredUpgradeCredit,
} from '@/lib/subscription/upgrade-credit';

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

  /** Credit for unused paid time on the current plan that was taken off `amount` (0 when none). */
  creditApplied: number;

  /** Unused paid time worth this much is not used by this purchase (the charge never goes below ₹1). */
  creditUnused: number;

  /** What the customer's unused paid time is worth towards this plan. */
  creditAvailable: number;

  /** GST included in `amount` (0 when GST is off). */
  taxAmount: number;

  /** The part of `amount` that is not tax. */
  taxableAmount: number;

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



  // The product is the plan's own. A client-sent module_key that names another product is refused.
  const moduleKey = await resolveModuleKeyForPlan(input.planId);
  const claimedModule = normalizePlatformModule(input.moduleKey);
  if (claimedModule && claimedModule !== moduleKey) {
    throw new Error('MODULE_PLAN_MISMATCH');
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

  const pending = await recordBillingTransaction({

    businessId: input.businessId,

    planId: input.planId,

    moduleKey,

    amount: pricing.baseAmount,

    discountAmount: pricing.discountAmount,

    // The credit is decided now and stored; completion checks the paid amount against this row.
    creditAmount: pricing.creditApplied,

    metadata:
      pricing.creditApplied > 0
        ? {
            upgrade_credit: {
              amount: pricing.creditApplied,
              available: pricing.creditAvailable,
              unused: pricing.creditUnused,
              from_plan_id: pricing.creditFromPlanId,
              from_transaction_id: pricing.creditFromTransactionId,
              from_transaction_ids: pricing.creditAllocation.map((a) => a.id),
              // Paise taken from each source, oldest first. Applied when the payment completes.
              allocation: pricing.creditAllocation,
              unused_days: pricing.creditUnusedDays,
              period_days: pricing.creditPeriodDays,
            },
          }
        : undefined,

    tax: pricing.tax,

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

    creditApplied: pricing.creditApplied,

    creditUnused: pricing.creditUnused,

    creditAvailable: pricing.creditAvailable,

    taxAmount: pricing.taxAmount,

    taxableAmount: pricing.taxableAmount,

    currency: 'INR',

    billingTransactionId: pending.id,

    paymentLinkId: link.providerPaymentId,

    keyId,

  };

}



export type CheckoutCompletion = 'activated' | 'already_completed';

export type CheckoutCompletionDetail = {
  completion: CheckoutCompletion;
  /** Set when the upgrade credit was no longer available: the days this payment bought. */
  shortenedDays?: number;
  /** Why the credit was refused (see `recheckUpgradeCredit`). */
  creditRejected?: string;
};

/**
 * Complete a hosted checkout after a verified gateway payment (Razorpay webhook, Easebuzz callback).
 *
 * One transaction: lock the billing row, check status and paid amount, mark it completed and
 * activate the plan stored on that row. A second event for the same payment waits on the row
 * lock, then sees `completed` and returns `already_completed` without side effects.
 * `planId` / `billingCycle` in params are accepted for compatibility and ignored.
 * Throws `Error('AMOUNT_MISMATCH')` when the paid amount differs from the row's total.
 */
export async function completeSubscriptionCheckoutPayment(
  params: Parameters<typeof completeSubscriptionCheckoutPaymentDetailed>[0],
): Promise<CheckoutCompletion> {
  return (await completeSubscriptionCheckoutPaymentDetailed(params)).completion;
}

/** Same as `completeSubscriptionCheckoutPayment`, and also says when the period was shortened. */
export async function completeSubscriptionCheckoutPaymentDetailed(params: {

  businessId: string;

  planId: string;

  billingCycle: BillingCycle;

  billingTransactionId?: string | null;

  providerPaymentId?: string | null;

  /** Paid amount in rupees, from the verified gateway event. */
  amount: number;

  gatewayResponse?: unknown;

  paymentMethod?: PlatformPaymentProviderId;

}): Promise<CheckoutCompletionDetail> {

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
    creditRejected?: string;
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
      upgrade_credit: StoredUpgradeCredit | null;
      invoice_prefix: string | null;
      gst_mode: string | null;
      taxable_amount: string | null;
    }>(
      `SELECT status, plan_id, billing_cycle, coupon_id, total_amount::text AS total_amount, taxable_amount::text AS taxable_amount,
              gateway_response->>'checkout_type' AS checkout_type,
              metadata->'upgrade_credit' AS upgrade_credit,
              metadata->'tax'->>'invoice_prefix' AS invoice_prefix, gst_mode
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
      return { completion: 'already_completed' };
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

    // An upgrade credit granted at checkout is re-checked here. Lock order: checkout row (above),
    // the per-(business, module) lock, then the credit source rows. `applyModuleSubscriptionPlanChange`
    // takes the same transaction lock again, which is harmless.
    const credit = tx.upgrade_credit && Number(tx.upgrade_credit.amount) > 0 ? tx.upgrade_credit : null;
    let creditRejected: string | undefined;
    if (credit) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
        `module_plan_change:${params.businessId}:${moduleKey}`,
      ]);
      creditRejected =
        (await recheckUpgradeCredit(client, {
          businessId: params.businessId,
          moduleKey,
          targetPlanId: planId,
          checkoutId: billingTransactionId,
          stored: credit,
        })) ?? undefined;
    }

    // Razorpay: the completed row records the gateway PAYMENT id (replacing the payment link id set at
    // checkout; the link id stays in gateway_response.payment_link_id), so the unique index on
    // completed payment references means one gateway payment activates one checkout.
    // Easebuzz: the reference is the txnid for both pending and completed rows; keep it.
    await client.query(
      `UPDATE billing_transactions
       SET status = 'completed',
           payment_reference = CASE WHEN $4::boolean THEN COALESCE($2, payment_reference)
                                    ELSE COALESCE(payment_reference, $2) END,
           gateway_response = CASE WHEN $3::jsonb IS NULL THEN gateway_response
                                   ELSE COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('webhook', $3::jsonb) END,
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('paid_at', CURRENT_TIMESTAMP::text),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        billingTransactionId,
        paymentReference,
        params.gatewayResponse ? JSON.stringify(params.gatewayResponse) : null,
        paymentMethod === 'razorpay',
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
        // The customer already paid the reduced price: if the credit is gone they get the days
        // that amount buys, not the whole period.
        // Days are bought with the pre-tax part of what was paid (the credit is pre-tax too); GST buys no days.
        shorten:
          credit && creditRejected
            ? { paidPaise: tx.taxable_amount != null ? Math.round(Number(tx.taxable_amount) * 100) : expectedPaise, creditPaise: Math.round(Number(credit.amount) * 100) }
            : undefined,
      },
      client,
    );

    if (credit && !creditRejected) {
      // The sources are spent: marked in this transaction with the paise taken from each.
      await consumeCreditSources(
        client,
        params.businessId,
        billingTransactionId,
        credit.allocation ?? [],
      );
    } else if (credit && creditRejected) {
      await client.query(
        `UPDATE billing_transactions
         SET metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{upgrade_credit}',
               COALESCE(metadata->'upgrade_credit', '{}'::jsonb)
               || jsonb_build_object('rejected', $2::text, 'shortened_days', $3::int)),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1`,
        [billingTransactionId, creditRejected, result.shortened_days ?? null],
      );
    }

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

    // The payment row records the period it bought: for a renewal from the old end date (the days
    // already paid for are not sold again), otherwise from the module row's start. It ends at the
    // module row's end now, after free months and carried trial days, so it never disagrees with
    // the subscription.
    await client.query(
      `UPDATE billing_transactions bt
       SET period_start = COALESCE($4::date, bms.start_date), period_end = bms.end_date
       FROM business_module_subscriptions bms
       WHERE bt.id = $1 AND bms.business_id = $2 AND bms.module_key = $3
         AND bt.business_id = bms.business_id`,
      [billingTransactionId, params.businessId, moduleKey, result.paidFrom ?? null],
    );

    // The tax invoice number, only for a payment priced with GST (the mode stored on the row, not today's
    // setting). It is the LAST statement before COMMIT: the counter row is the last lock this transaction
    // takes, so it can never be part of a lock cycle, and it is held for milliseconds. A payment that does
    // not complete never gets one; a repeat returned above.
    if (isTaxedMode(tx.gst_mode)) await issueInvoiceNumber(client, billingTransactionId, tx.invoice_prefix);

    await client.query('COMMIT');

    committed = {
      planId,
      totalAmount: Number(tx.total_amount) || 0,
      result,
      creditRejected,
    };
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isPaymentReferenceViolation(err)) throw new Error('PAYMENT_REFERENCE_ALREADY_USED');
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
      periodKind: committed.result.period_kind,
    });
  } catch (err) {
    console.error('[checkout] post-commit plan activation steps failed:', err);
  }

  try {
    await notifyBillingTransactionStatus(billingTransactionId, 'completed');
  } catch (err) {
    console.error('[checkout] payment success notification failed:', err);
  }

  if (committed.creditRejected && committed.result.shortened_days) {
    try {
      const plan = await queryOne<{ display_name: string }>(
        `SELECT display_name FROM subscription_plans WHERE id = $1`,
        [committed.planId],
      );
      const recipient = await getBusinessPlatformRecipient(params.businessId);
      const planName = plan?.display_name || committed.planId;
      const days = committed.result.shortened_days;
      const text = `Your upgrade credit was no longer available, so this payment bought ${days} day${days === 1 ? '' : 's'} of ${planName}. Please contact support if you think this is wrong.`;
      console.warn(
        `[checkout] upgrade credit rejected (${committed.creditRejected}) tx=${billingTransactionId} business=${params.businessId} days=${days}`,
      );
      if (recipient?.email) {
        await sendPlatformEmail({
          to: recipient.email,
          subject: 'Your Khatario upgrade',
          html: `<p>${escapeHtml(text)}</p>`,
          text,
          templateKey: 'payment_success',
          businessId: params.businessId,
          metadata: { upgrade_credit_rejected: committed.creditRejected },
        });
      }
    } catch (err) {
      console.error('[checkout] shortened-period notice failed:', err);
    }
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

  return {
    completion: 'activated',
    ...(committed.creditRejected
      ? { creditRejected: committed.creditRejected, shortenedDays: committed.result.shortened_days }
      : {}),
  };
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


