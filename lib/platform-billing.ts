/**
 * Platform SaaS billing: billing_transactions, webhooks, payment emails.
 */

import { createHash } from 'crypto';
import { query, queryOne, queryRows } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import {
  getBusinessPlatformRecipient,
  getPlatformAdminRecipientEmails,
  getPlatformNotificationSettings,
  platformEmailLayout,
  sendPlatformEmail,
} from '@/lib/platform-email';
import {
  getPlatformEmailTemplates,
  resolveTemplate,
  type PlatformTemplateId,
} from '@/lib/platform-email-templates';

import { lookupTenantWhatsAppPhone, sendPlatformEventWhatsApp } from '@/lib/platform-whatsapp-send';
import type { VerifyWebhookResult } from '@/lib/payments/types';
import {
  completeAddonCheckoutPayment,
  isWhatsAppAddonType,
} from '@/lib/platform-addon-checkout';
import {
  assertBillingTransactionTransition,
  BillingTransactionStateError,
} from '@/lib/platform-billing-transaction-state';
import {
  completeSubscriptionCheckoutPayment,
  type CheckoutCompletion,
  extractCheckoutMetaFromWebhookNotes,
  getPlatformEasebuzzProvider,
  getPlatformRazorpayProvider,
} from '@/lib/platform-subscription-checkout';
import { applyRazorpayRefundNotice, PlatformRefundError } from '@/lib/platform-refunds';
import { readRazorpayRefundNotice } from '@/lib/payments/providers/razorpay-payment-provider';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { normalizeBillingCycle } from '@/lib/subscription/apply-plan-change';
import { getPrimaryModuleSubscription } from '@/lib/subscription/module-subscriptions';
import {
  formatModulePlanReceiptLabel,
} from '@/lib/subscription/billing-labels';
import { normalizePlatformModule, type PlatformModule } from '@/lib/platform-modules';
import type { BillingTxStatus } from '@/lib/platform-billing-transaction-state';

export type { BillingTxStatus };

export interface RecordBillingInput {
  businessId: string;
  planId: string;
  moduleKey?: PlatformModule | string | null;
  /** List/base price before discount */
  amount: number;
  billingCycle?: 'monthly' | 'yearly' | 'three_year';
  paymentMethod?: string;
  paymentReference?: string | null;
  status: BillingTxStatus;
  description?: string;
  gatewayResponse?: unknown;
  skipEmails?: boolean;
  couponId?: string | null;
  discountAmount?: number;
  /** Upgrade credit taken off the total (not part of the coupon discount). */
  creditAmount?: number;
  /** Stored in the row's metadata column. */
  metadata?: Record<string, unknown>;
}

async function sendTemplatedTenantEmail(
  templateId: PlatformTemplateId,
  businessId: string,
  recipientEmail: string,
  vars: Record<string, string | number | undefined | null>,
  templateKey: 'payment_success' | 'payment_failed' | 'subscription_upgraded',
): Promise<boolean> {
  const stored = await getPlatformEmailTemplates();
  const { subject, html } = resolveTemplate(templateId, stored, vars);
  const body = platformEmailLayout(subject.replace(/\[Khatario\]\s*/i, '').trim(), html);
  return sendPlatformEmail({
    to: recipientEmail,
    subject,
    html: body,
    templateKey,
    businessId,
    metadata: { templateId },
  });
}

export async function notifyAdminsPaymentFailure(params: {
  businessId: string;
  businessName: string;
  planName: string;
  amount: number;
  reason?: string;
}): Promise<number> {
  const settings = await getPlatformNotificationSettings();
  if (!settings.notify_payment_failures) return 0;

  const recipients = await getPlatformAdminRecipientEmails();
  if (recipients.length === 0) return 0;

  const subject = `[Khatario Admin] Payment failed: ${params.businessName}`;
  const html = platformEmailLayout('Payment failed', `
    <p><strong>${params.businessName}</strong></p>
    <p>Plan: ${params.planName} · Amount: ₹${params.amount}</p>
    <p>${params.reason || 'No additional details.'}</p>
    <p><a href="${process.env.NEXT_PUBLIC_APP_URL || 'https://app.khatario.com'}/admin/businesses/${params.businessId}">View business</a></p>
  `);

  let sent = 0;
  for (const to of recipients) {
    const ok = await sendPlatformEmail({
      to,
      subject,
      html,
      templateKey: 'admin_payment_failure',
      businessId: params.businessId,
    });
    if (ok) sent++;
  }
  try {
    const { sendPlatformAdminPush } = await import('@/lib/platform-push');
    await sendPlatformAdminPush({
      event: 'incident',
      title: `Payment failed: ${params.businessName}`,
      body: `${params.planName} · ₹${params.amount}`,
      url: `/admin/businesses/${params.businessId}`,
    });
  } catch (err) {
    console.warn('[billing] admin push failed', err instanceof Error ? err.message : err);
  }
  return sent;
}

export async function recordBillingTransaction(
  input: RecordBillingInput,
): Promise<{ id: string; status: BillingTxStatus }> {
  if (input.paymentReference?.trim()) {
    const existing = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM billing_transactions
       WHERE business_id = $1 AND payment_reference = $2 AND type <> 'refund'
       LIMIT 1`,
      [input.businessId, input.paymentReference.trim()],
    );
    if (existing) {
      return { id: existing.id, status: existing.status as BillingTxStatus };
    }
  }

  const planMeta = await queryOne<{ display_name: string; product_line: string | null }>(
    `SELECT display_name, product_line FROM subscription_plans WHERE id = $1`,
    [input.planId],
  );

  let moduleKey: PlatformModule | null = null;
  if (input.moduleKey) {
    moduleKey = normalizePlatformModule(input.moduleKey);
  }
  if (!moduleKey) {
    try {
      moduleKey = await resolveModuleKeyForPlan(input.planId);
    } catch {
      moduleKey = 'billing';
    }
  }

  const planDisplayName = planMeta?.display_name ?? input.planId;
  const description =
    input.description ??
    formatModulePlanReceiptLabel(moduleKey, planDisplayName, input.billingCycle);

  const base = Math.round(input.amount * 100) / 100;
  const discount = Math.round((input.discountAmount ?? 0) * 100) / 100;
  const credit = Math.round((input.creditAmount ?? 0) * 100) / 100;
  const total = Math.max(0, Math.round((base - discount - credit) * 100) / 100);

  const row = await queryOne<{ id: string; status: string }>(
    `INSERT INTO billing_transactions (
       business_id, type, status, amount, currency, plan_id, module_key,
       billing_cycle, payment_method, payment_reference, gateway_response, description,
       coupon_id, discount_amount, total_amount, metadata
     ) VALUES ($1, 'payment', $2, $3, 'INR', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
     RETURNING id, status`,
    [
      input.businessId,
      input.status,
      base,
      input.planId,
      moduleKey,
      input.billingCycle ?? 'monthly',
      input.paymentMethod ?? 'manual',
      input.paymentReference?.trim() || null,
      input.gatewayResponse ? JSON.stringify(input.gatewayResponse) : null,
      description,
      input.couponId ?? null,
      discount,
      total,
      JSON.stringify(input.metadata ?? {}),
    ],
  );

  if (!row) throw new Error('Failed to record billing transaction');

  if (!input.skipEmails) {
    await dispatchBillingEmails(row.id, input.status);
  }

  return { id: row.id, status: input.status };
}

export async function updateBillingTransactionStatus(
  transactionId: string,
  status: BillingTxStatus,
  gatewayResponse?: unknown,
): Promise<void> {
  // A payment becomes `refunded` only through lib/platform-refunds.ts, which returns the money at the gateway first.
  if (status === 'refunded') {
    throw new BillingTransactionStateError(
      'REFUND_REQUIRES_REFUND_FLOW',
      'A payment can only be marked refunded by refunding it (refundPlatformPayment), which returns the money through the payment gateway.',
      'completed',
      'refunded',
    );
  }
  const current = await queryOne<{ status: BillingTxStatus }>(
    `SELECT status FROM billing_transactions WHERE id = $1`,
    [transactionId],
  );

  if (!current) {
    throw new BillingTransactionStateError(
      'TRANSACTION_NOT_FOUND',
      `Billing transaction ${transactionId} not found`,
      'pending',
      status,
    );
  }

  assertBillingTransactionTransition(current.status, status);

  // Guarded by the status we checked: a row that changed underneath us is never overwritten.
  const updated = await query(
    `UPDATE billing_transactions
     SET status = $2,
         gateway_response = CASE WHEN $3::jsonb IS NULL THEN gateway_response
                                 ELSE COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('webhook', $3::jsonb) END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = $4
     RETURNING id`,
    [transactionId, status, gatewayResponse ? JSON.stringify(gatewayResponse) : null, current.status],
  );
  if (!updated?.rows?.length) {
    throw new BillingTransactionStateError(
      'INVALID_STATUS_TRANSITION',
      `Billing transaction ${transactionId} changed while moving ${current.status} to ${status}`,
      current.status,
      status,
    );
  }
  await dispatchBillingEmails(transactionId, status);
}

/**
 * Close a checkout as failed only while it is still `pending` (single guarded UPDATE, so a payment
 * that completed concurrently is never overwritten). Sends the failure notifications only when the
 * row actually changed and `notify` is true (an expired link is not a failure anyone needs told).
 * Returns false when the row was already settled or is not this business's.
 */
export async function markCheckoutFailedIfPending(
  transactionId: string,
  businessId: string,
  gatewayResponse?: unknown,
  notify = true,
): Promise<boolean> {
  const updated = await query(
    `UPDATE billing_transactions
     SET status = 'failed',
         gateway_response = CASE WHEN $3::jsonb IS NULL THEN gateway_response
                                 ELSE COALESCE(gateway_response, '{}'::jsonb) || jsonb_build_object('webhook', $3::jsonb) END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND status = 'pending'
     RETURNING id`,
    [transactionId, businessId, gatewayResponse ? JSON.stringify(gatewayResponse) : null],
  );
  if (!updated?.rows?.length) return false;
  if (notify) await dispatchBillingEmails(transactionId, 'failed');
  return true;
}

/** Hosted payment links on platform checkouts expire after this long. */
export const PLATFORM_LINK_EXPIRY_MS = 24 * 60 * 60 * 1000;

/**
 * Close gateway checkouts still `pending` after `olderThanHours` as failed. One guarded UPDATE, so a
 * payment that completed at the same moment is never overwritten. Sends no email, WhatsApp or push
 * (nobody needs a failure notice for a link they never opened). A later verified payment still
 * activates through the `failed -> completed` transition. Returns the number of checkouts closed.
 */
export async function expireStaleCheckouts(olderThanHours = 48): Promise<number> {
  const res = await query<{ id: string; business_id: string }>(
    `UPDATE billing_transactions
     SET status = 'failed',
         description = COALESCE(description, '') || ' (checkout expired)',
         updated_at = CURRENT_TIMESTAMP
     WHERE status = 'pending'
       AND type = 'payment'
       AND payment_method IN ('razorpay', 'easebuzz')
       AND created_at < NOW() - make_interval(hours => $1)
     RETURNING id, business_id`,
    [olderThanHours],
  );
  const rows = res?.rows ?? [];
  for (const r of rows) {
    // The rows are already closed; one failed log must not lose the count or the other events.
    try {
      await logSubscriptionEvent(r.business_id, 'checkout_expired', { transaction_id: r.id });
    } catch (err) {
      console.error('[platform-billing] could not log checkout_expired', r.id, err);
    }
  }
  return rows.length;
}

/** Errors that no redelivery can fix: the event is ignored instead of retried. */
function terminalCheckoutError(err: unknown): string | null {
  if (err instanceof BillingTransactionStateError) return err.message;
  const msg = err instanceof Error ? err.message : String(err);
  if (msg === 'CHECKOUT_TRANSACTION_NOT_FOUND') return 'Checkout transaction not found for this business';
  if (msg === 'CHECKOUT_PLAN_MISSING') return 'Checkout transaction has no plan';
  if (msg === 'CHECKOUT_TYPE_MISMATCH') {
    return 'CHECKOUT_TYPE_MISMATCH: the checkout row is not of the type this payment event claims';
  }
  if (msg === 'PAYMENT_REFERENCE_ALREADY_USED') {
    return 'PAYMENT_REFERENCE_ALREADY_USED: this gateway payment id already activated another checkout';
  }
  return null;
}

/**
 * Customer email / WhatsApp, admin notice and the payment_succeeded / payment_failed event for a
 * status that was already written (e.g. inside a checkout transaction). Call after COMMIT.
 */
export async function notifyBillingTransactionStatus(
  transactionId: string,
  status: BillingTxStatus,
): Promise<void> {
  await dispatchBillingEmails(transactionId, status);
}

async function dispatchBillingEmails(
  transactionId: string,
  status: BillingTxStatus,
): Promise<void> {
  const tx = await queryOne<{
    business_id: string;
    plan_id: string;
    amount: string;
    billing_cycle: string | null;
    payment_reference: string | null;
    description: string | null;
  }>(
    `SELECT business_id, plan_id, amount, billing_cycle, payment_reference, description
     FROM billing_transactions WHERE id = $1`,
    [transactionId],
  );
  if (!tx) return;

  const plan = await queryOne<{ display_name: string }>(
    `SELECT display_name FROM subscription_plans WHERE id = $1`,
    [tx.plan_id],
  );
  const recipient = await getBusinessPlatformRecipient(tx.business_id);
  const planName = plan?.display_name || tx.plan_id;
  const amount = parseFloat(tx.amount);

  if (status === 'completed' && amount > 0) {
    await logSubscriptionEvent(tx.business_id, 'payment_succeeded', {
      to_plan_id: tx.plan_id,
      transaction_id: transactionId,
    });
    if (recipient?.email) {
      await sendTemplatedTenantEmail(
        'payment_success',
        tx.business_id,
        recipient.email,
        {
          businessName: recipient.businessName,
          planName,
          amount,
          billingCycle: tx.billing_cycle || 'monthly',
          paymentReference: tx.payment_reference || transactionId.slice(0, 8),
        },
        'payment_success',
      );
    }
  } else if (status === 'failed') {
    await logSubscriptionEvent(tx.business_id, 'payment_failed', {
      to_plan_id: tx.plan_id,
      transaction_id: transactionId,
    });
    const reason = tx.description || 'Please try again or use a different payment method.';
    if (recipient?.email) {
      await sendTemplatedTenantEmail(
        'payment_failed',
        tx.business_id,
        recipient.email,
        {
          businessName: recipient.businessName,
          planName,
          amount,
          billingCycle: tx.billing_cycle || 'monthly',
          reason,
        },
        'payment_failed',
      );
    }
    const waPhone = await lookupTenantWhatsAppPhone(tx.business_id);
    if (waPhone) {
      await sendPlatformEventWhatsApp({
        eventKey: 'subscription_payment_failed',
        toPhone: waPhone,
        vars: [recipient?.businessName || '', planName, String(amount)],
      });
    }
    await notifyAdminsPaymentFailure({
      businessId: tx.business_id,
      businessName: recipient?.businessName || tx.business_id,
      planName,
      amount,
      reason,
    });
  }
}

/** Record billing + emails after a successful plan upgrade (tenant or admin). */
export async function recordUpgradeBilling(params: {
  businessId: string;
  planId: string;
  planDisplayName: string;
  moduleKey?: PlatformModule | string | null;
  amount: number;
  billingCycle: 'monthly' | 'yearly' | 'three_year';
  paymentMethod: string;
  paymentReference?: string | null;
  paymentStatus?: BillingTxStatus;
}): Promise<void> {
  const status = params.paymentStatus ?? 'completed';
  const moduleKey =
    params.moduleKey ?? (await resolveModuleKeyForPlan(params.planId).catch(() => 'billing'));

  if (status === 'completed' && params.amount <= 0) {
    const recipient = await getBusinessPlatformRecipient(params.businessId);
    if (recipient?.email) {
      const stored = await getPlatformEmailTemplates();
      const { subject, html } = resolveTemplate(
        'subscription_upgraded',
        stored,
        {
          businessName: recipient.businessName,
          planName: params.planDisplayName,
          billingCycle: params.billingCycle,
        },
      );
      await sendPlatformEmail({
        to: recipient.email,
        subject,
        html: platformEmailLayout(subject.replace(/\[Khatario\]\s*/i, '').trim(), html),
        templateKey: 'subscription_upgraded',
        businessId: params.businessId,
      });
    }
    return;
  }

  const recorded = await recordBillingTransaction({
    businessId: params.businessId,
    planId: params.planId,
    moduleKey,
    amount: params.amount,
    billingCycle: params.billingCycle,
    paymentMethod: params.paymentMethod,
    paymentReference: params.paymentReference,
    status,
    description: formatModulePlanReceiptLabel(
      moduleKey,
      params.planDisplayName,
      params.billingCycle,
    ),
    skipEmails: false,
  });

  if (status === 'completed' && params.amount > 0) {
    try {
      const { maybeCreatePartnerCommissionOnPayment } = await import('@/lib/partners/commission');
      await maybeCreatePartnerCommissionOnPayment({
        businessId: params.businessId,
        billingTransactionId: recorded.id,
        saleAmount: params.amount,
      });
    } catch (partnerErr) {
      console.error('Partner commission on upgrade billing failed:', partnerErr);
    }
  }
}

function extractBusinessIdFromWebhook(verified: VerifyWebhookResult): string | null {
  const raw = verified.rawPayload as Record<string, unknown> | undefined;
  const payload = raw?.payload as Record<string, unknown> | undefined;
  const payment = (payload?.payment as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const plink = (payload?.payment_link as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;

  const notesSources = [
    payment?.notes,
    plink?.notes,
    (payment as Record<string, unknown> | undefined)?.notes,
  ];

  for (const notes of notesSources) {
    if (notes && typeof notes === 'object') {
      const n = notes as Record<string, unknown>;
      const bid = n.business_id ?? n.businessId;
      if (typeof bid === 'string' && bid.length > 10) return bid.trim();
    }
  }

  const ref = verified.orderReference?.trim();
  if (ref && /^[0-9a-f-]{36}$/i.test(ref)) return ref;

  return null;
}

function extractPlanMetaFromWebhook(verified: VerifyWebhookResult): {
  planId?: string;
  billingCycle?: 'monthly' | 'yearly' | 'three_year';
} {
  const raw = verified.rawPayload as Record<string, unknown> | undefined;
  const payload = raw?.payload as Record<string, unknown> | undefined;
  const payment = (payload?.payment as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const notes = payment?.notes as Record<string, unknown> | undefined;
  if (!notes) return {};
  return {
    planId: typeof notes.plan_id === 'string' ? notes.plan_id : undefined,
    billingCycle:
      notes.billing_cycle === 'yearly' ||
      notes.billing_cycle === 'monthly' ||
      notes.billing_cycle === 'three_year'
        ? notes.billing_cycle
        : undefined,
  };
}

/**
 * Webhook event states: `received` (inserted; in progress or crashed), `processed`, `failed`
 * (gateway reported a failure), `pending`, `ignored`, `error` (processing threw).
 */
export type PlatformWebhookEventStatus =
  | 'received'
  | 'processed'
  | 'failed'
  | 'pending'
  | 'ignored'
  | 'error';

/** An event is (re)processed when it is new or its last attempt never finished or threw. */
export function shouldProcessWebhookEvent(logged: { isNew: boolean; status: string }): boolean {
  return logged.isNew || logged.status === 'received' || logged.status === 'error';
}

export async function logPlatformWebhookEvent(params: {
  provider: string;
  idempotencyKey: string;
  eventType: string;
  businessId?: string | null;
  billingTransactionId?: string | null;
  status: string;
  payload: unknown;
  processingNotes?: string;
}): Promise<{ isNew: boolean; status: string }> {
  const row = await queryOne<{ status: string }>(
    `INSERT INTO platform_billing_webhook_events
       (provider, idempotency_key, event_type, business_id, billing_transaction_id, status, payload, processing_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (provider, idempotency_key) DO NOTHING
     RETURNING status`,
    [
      params.provider,
      params.idempotencyKey,
      params.eventType,
      params.businessId ?? null,
      params.billingTransactionId ?? null,
      params.status,
      JSON.stringify(params.payload ?? {}),
      params.processingNotes ?? null,
    ],
  );
  if (row) return { isNew: true, status: row.status ?? params.status };

  const existing = await queryOne<{ status: string }>(
    `SELECT status FROM platform_billing_webhook_events
     WHERE provider = $1 AND idempotency_key = $2`,
    [params.provider, params.idempotencyKey],
  );
  return { isNew: false, status: existing?.status ?? 'unknown' };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export type PlatformRazorpayWebhookResult = { ok: boolean; duplicate?: boolean; error?: string };

export async function processPlatformRazorpayWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<PlatformRazorpayWebhookResult> {
  const provider = await getPlatformRazorpayProvider();
  if (!provider) {
    return { ok: false, error: 'Platform Razorpay not configured' };
  }

  const verified = await provider.verifyWebhook({ rawBody, headers });
  if (!verified.verified) {
    return { ok: false, error: verified.reason || 'Verification failed' };
  }

  const refundNotice = readRazorpayRefundNotice((verified.rawPayload ?? {}) as Record<string, unknown>);
  const isRefundEvent = (verified.eventType ?? '').startsWith('refund.');
  const idemKey = isRefundEvent && refundNotice.providerRefundId
    ? // One refund has several events (created, processed, failed) and one payment can have several refunds.
      createHash('sha256')
        .update(`platform|razorpay|refund|${verified.eventType}|${refundNotice.providerRefundId}`)
        .digest('hex')
    : verified.providerPaymentId
    ? createHash('sha256')
        .update(`platform|razorpay|${verified.eventType}|${verified.providerPaymentId}|${verified.status}`)
        .digest('hex')
    : createHash('sha256').update(`platform|razorpay|${rawBody}`).digest('hex');

  const logged = await logPlatformWebhookEvent({
    provider: 'razorpay',
    idempotencyKey: idemKey,
    eventType: verified.eventType || 'unknown',
    status: 'received',
    payload: verified.rawPayload ?? {},
  });

  if (!shouldProcessWebhookEvent(logged)) {
    return { ok: true, duplicate: true };
  }

  try {
    return await handleVerifiedRazorpayEvent(verified, idemKey);
  } catch (err) {
    // Leave the event retryable: the gateway's redelivery (or a manual replay) processes it again.
    await query(
      `UPDATE platform_billing_webhook_events SET status = 'error', processing_notes = $2
       WHERE provider = 'razorpay' AND idempotency_key = $1`,
      [idemKey, errorMessage(err)],
    ).catch((markErr) => console.error('[platform-billing] could not mark webhook event error', markErr));
    // Link the event to its checkout row (business taken from that row, not from notes) for the admin log.
    const txRef = isRefundEvent ? null : extractCheckoutMetaFromWebhookNotes(verified).billingTransactionId;
    if (txRef) {
      await query(
        `UPDATE platform_billing_webhook_events e
         SET billing_transaction_id = t.id, business_id = t.business_id
         FROM billing_transactions t
         WHERE e.provider = 'razorpay' AND e.idempotency_key = $1 AND t.id::text = $2`,
        [idemKey, txRef],
      ).catch(() => undefined);
    }
    throw err;
  }
}

async function handleVerifiedRazorpayEvent(
  verified: VerifyWebhookResult,
  idemKey: string,
): Promise<PlatformRazorpayWebhookResult> {
  const markEvent = (
    status: PlatformWebhookEventStatus,
    notes: string,
    businessId: string | null = null,
    billingTransactionId: string | null = null,
  ) =>
    query(
      `UPDATE platform_billing_webhook_events
       SET status = $2, processing_notes = $3,
           business_id = COALESCE($4, business_id),
           billing_transaction_id = COALESCE($5, billing_transaction_id)
       WHERE provider = 'razorpay' AND idempotency_key = $1`,
      [idemKey, status, notes, businessId, billingTransactionId],
    );

  // Refund events settle refund rows only; they never reach the payment or activation code below.
  if ((verified.eventType ?? '').startsWith('refund.')) {
    try {
      const outcome = await applyRazorpayRefundNotice(
        readRazorpayRefundNotice((verified.rawPayload ?? {}) as Record<string, unknown>),
      );
      const status: PlatformWebhookEventStatus =
        outcome.outcome === 'ignored' ? 'ignored' : outcome.outcome === 'failed' ? 'failed' : outcome.outcome === 'pending' ? 'pending' : 'processed';
      await markEvent(status, outcome.note, outcome.businessId, outcome.billingTransactionId);
      return { ok: true };
    } catch (err) {
      if (err instanceof PlatformRefundError) {
        // A definite answer about this event: redelivery will not change it.
        await markEvent('ignored', err.message);
        return { ok: true, error: err.message };
      }
      throw err;
    }
  }

  const businessId = extractBusinessIdFromWebhook(verified);
  if (!businessId) {
    await markEvent('ignored', 'No business_id in webhook notes');
    return { ok: true, error: 'No business_id in payload' };
  }

  const legacyMeta = extractPlanMetaFromWebhook(verified);
  const checkoutMeta = extractCheckoutMetaFromWebhookNotes(verified);
  const sub = await getPrimaryModuleSubscription(businessId, true);
  const planId =
    checkoutMeta.planId || legacyMeta.planId || sub?.plan_id || 'free';
  const amount = verified.amount ?? 0;
  const billingCycle =
    checkoutMeta.billingCycle || legacyMeta.billingCycle || 'monthly';
  const billingTransactionId = checkoutMeta.billingTransactionId;

  let billingTxId: string | null = billingTransactionId ?? null;
  let notes = '';

  if (verified.status === 'success') {
    if (!billingTransactionId) {
      await markEvent(
        'ignored',
        'Legacy webhook path disabled — missing billing_transaction_id and checkout plan metadata (checkout transaction reference required)',
      );
      return {
        ok: true,
        error: 'Webhook ignored: checkout transaction reference required',
      };
    }

    // The notes only pick which completion to try; each one re-reads the locked row and refuses
    // (CHECKOUT_TYPE_MISMATCH) when the stored checkout is of another type.
    const addonRoute = checkoutMeta.checkoutType === 'whatsapp_addon';
    let completion: CheckoutCompletion;
    try {
      completion = addonRoute
        ? await completeAddonCheckoutPayment({
            businessId,
            billingTransactionId,
            providerPaymentId: verified.providerPaymentId,
            // The verified paid amount; a missing amount must not match the stored total.
            amount: verified.amount ?? Number.NaN,
            gatewayResponse: verified.rawPayload,
          })
        : await completeSubscriptionCheckoutPayment({
            businessId,
            planId: checkoutMeta.planId || planId,
            billingCycle,
            billingTransactionId,
            providerPaymentId: verified.providerPaymentId,
            amount: verified.amount ?? Number.NaN,
            gatewayResponse: verified.rawPayload,
          });
    } catch (err) {
      if (errorMessage(err) === 'AMOUNT_MISMATCH') {
        await markEvent(
          'ignored',
          `Amount mismatch: paid ${verified.amount ?? 'unknown'} INR does not match the checkout total`,
          businessId,
          billingTransactionId,
        );
        return { ok: false, error: 'Amount mismatch' };
      }
      const terminal = terminalCheckoutError(err);
      if (terminal) {
        // Not linked to the row: the notes' business may not own it.
        await markEvent('ignored', terminal, businessId);
        return { ok: true, error: terminal };
      }
      throw err;
    }
    if (completion === 'already_completed') {
      await markEvent('processed', 'Duplicate of a completed checkout', businessId, billingTransactionId);
      return { ok: true, duplicate: true };
    }
    notes = addonRoute ? 'WhatsApp addon checkout completed' : 'Subscription checkout completed';
  } else if (verified.status === 'failed' || verified.eventType === 'payment_link.expired') {
    const closesCheckout =
      verified.eventType === 'payment_link.cancelled' || verified.eventType === 'payment_link.expired';
    if (billingTransactionId && !closesCheckout) {
      // One failed attempt does not close the checkout: the customer can retry on the same link.
      await logSubscriptionEvent(businessId, 'payment_attempt_failed', {
        transaction_id: billingTransactionId,
      });
      await markEvent('processed', 'Attempt failed; checkout still open', businessId, billingTransactionId);
      return { ok: true };
    }
    if (billingTransactionId) {
      const current = await queryOne<{ status: string }>(
        `SELECT status FROM billing_transactions WHERE id = $1 AND business_id = $2`,
        [billingTransactionId, businessId],
      );
      if (!current) {
        await markEvent('ignored', 'Checkout transaction not found for this business', businessId);
        return { ok: true };
      }
      billingTxId = billingTransactionId;
      if (current.status !== 'pending') {
        await markEvent(
          'processed',
          `Checkout already ${current.status}; no status change`,
          businessId,
          billingTransactionId,
        );
        return { ok: true };
      }
      // An expired link is the customer walking away, not a failed payment: close the row quietly.
      const expired = verified.eventType === 'payment_link.expired';
      const closed = await markCheckoutFailedIfPending(
        billingTransactionId,
        businessId,
        verified.rawPayload,
        !expired,
      );
      if (closed && expired) {
        try {
          await logSubscriptionEvent(businessId, 'checkout_expired', { transaction_id: billingTransactionId });
        } catch (logErr) {
          console.error('[platform-billing] could not log checkout_expired', logErr);
        }
      }
      if (!closed) {
        await markEvent(
          'processed',
          'Checkout settled concurrently; no status change',
          businessId,
          billingTransactionId,
        );
        return { ok: true };
      }
    } else {
      const { id } = await recordBillingTransaction({
        businessId,
        planId,
        amount,
        billingCycle,
        paymentMethod: 'razorpay',
        paymentReference: verified.providerPaymentId || null,
        status: 'failed',
        description: verified.reason || 'Payment failed',
        gatewayResponse: verified.rawPayload,
      });
      billingTxId = id;
    }
    notes = 'Payment failed';
  } else {
    notes = 'Pending — no billing email sent';
  }

  const eventStatus: PlatformWebhookEventStatus =
    verified.status === 'success'
      ? 'processed'
      : verified.status === 'failed' || verified.eventType === 'payment_link.expired'
        ? 'failed'
        : 'pending';
  await query(
    `UPDATE platform_billing_webhook_events
     SET status = $2, business_id = $3, billing_transaction_id = $4, processing_notes = $5
     WHERE provider = 'razorpay' AND idempotency_key = $1`,
    [idemKey, eventStatus, businessId, billingTxId, notes],
  );

  return { ok: true };
}

function outcomeFromRowStatus(status: string | undefined): 'paid' | 'failed' | 'pending' {
  return status === 'completed' ? 'paid' : status === 'failed' ? 'failed' : 'pending';
}

export type PlatformEasebuzzOutcome = {
  ok: boolean;
  outcome?: 'paid' | 'failed' | 'pending' | 'duplicate' | 'ignored';
  checkoutType?: 'subscription' | 'whatsapp_addon';
  addonType?: string;
  planId?: string | null;
  error?: string;
  httpStatus?: number;
};

/**
 * Easebuzz return / webhook for Khatario's own billing. The business, plan and add-on come
 * from the pending billing_transactions row matched by txnid, never from the callback body.
 */
export async function processPlatformEasebuzzCallback(rawBody: string): Promise<PlatformEasebuzzOutcome> {
  const provider = await getPlatformEasebuzzProvider();
  if (!provider) {
    return { ok: false, error: 'Platform Easebuzz not configured', httpStatus: 400 };
  }
  const verified = await provider.verifyWebhook({ rawBody, headers: {} });
  if (!verified.verified || !verified.providerOrderId) {
    return { ok: false, error: verified.reason || 'Verification failed', httpStatus: 401 };
  }
  const txnid = verified.providerOrderId;

  const tx = await queryOne<{
    id: string;
    business_id: string;
    plan_id: string | null;
    billing_cycle: string | null;
    status: string;
    total_amount: string;
    gateway_response: Record<string, unknown> | null;
  }>(
    `SELECT id, business_id, plan_id, billing_cycle, status, total_amount::text, gateway_response
       FROM billing_transactions
      WHERE payment_method = 'easebuzz' AND payment_reference = $1
      LIMIT 1`,
    [txnid],
  );
  if (!tx) {
    return { ok: true, outcome: 'ignored', error: 'No matching billing transaction' };
  }
  const gw = tx.gateway_response ?? {};
  const checkoutType = gw.checkout_type === 'whatsapp_addon' ? 'whatsapp_addon' : 'subscription';
  const addonType = typeof gw.addon_type === 'string' ? gw.addon_type : undefined;
  const base = { checkoutType, addonType, planId: tx.plan_id } as const;

  const idemKey = createHash('sha256')
    .update(`platform|easebuzz|${txnid}|${verified.status}`)
    .digest('hex');
  const logged = await logPlatformWebhookEvent({
    provider: 'easebuzz',
    idempotencyKey: idemKey,
    eventType: verified.eventType || 'easebuzz_transaction',
    businessId: tx.business_id,
    billingTransactionId: tx.id,
    status: 'received',
    payload: verified.rawPayload ?? {},
  });
  if (!shouldProcessWebhookEvent(logged)) {
    // Not reprocessed: report what the row says now. A repeat of a failure or an ignored event
    // must never read as success to the browser return.
    const now = await queryOne<{ status: string }>(`SELECT status FROM billing_transactions WHERE id = $1`, [tx.id]);
    return { ok: true, outcome: outcomeFromRowStatus(now?.status), ...base };
  }

  const markEvent = (status: PlatformWebhookEventStatus, notes: string) =>
    query(
      `UPDATE platform_billing_webhook_events SET status = $2, processing_notes = $3
        WHERE provider = 'easebuzz' AND idempotency_key = $1`,
      [idemKey, status, notes],
    );

  if (tx.status === 'completed') {
    await markEvent('processed', 'Duplicate of a completed checkout');
    return { ok: true, outcome: 'paid', ...base };
  }

  try {
    if (verified.status === 'success') {
      const expected = Math.round((parseFloat(tx.total_amount) || 0) * 100);
      const paid = Math.round((verified.amount ?? -1) * 100);
      if (expected !== paid) {
        await markEvent('ignored', `Amount mismatch: expected ${expected} paise, got ${paid}`);
        return { ok: false, error: 'Amount mismatch', httpStatus: 422, ...base };
      }
      let completion: 'activated' | 'already_completed';
      try {
        if (checkoutType === 'whatsapp_addon' && isWhatsAppAddonType(addonType)) {
          completion = await completeAddonCheckoutPayment({
            businessId: tx.business_id,
            addonType,
            billingTransactionId: tx.id,
            providerPaymentId: verified.providerPaymentId,
            amount: verified.amount ?? Number.NaN,
            gatewayResponse: verified.rawPayload,
            paymentMethod: 'easebuzz',
          });
        } else {
          completion = await completeSubscriptionCheckoutPayment({
            businessId: tx.business_id,
            planId: tx.plan_id || 'free',
            billingCycle: normalizeBillingCycle(tx.billing_cycle),
            billingTransactionId: tx.id,
            providerPaymentId: verified.providerPaymentId,
            amount: verified.amount ?? Number.NaN,
            gatewayResponse: verified.rawPayload,
            paymentMethod: 'easebuzz',
          });
        }
      } catch (err) {
        if (errorMessage(err) === 'AMOUNT_MISMATCH') {
          await markEvent('ignored', 'Amount mismatch against the locked checkout row');
          return { ok: false, error: 'Amount mismatch', httpStatus: 422, ...base };
        }
        const terminal = terminalCheckoutError(err);
        if (terminal) {
          await markEvent('ignored', terminal);
          return { ok: true, outcome: 'ignored', error: terminal, ...base };
        }
        throw err;
      }
      await markEvent(
        'processed',
        completion === 'already_completed'
          ? 'Duplicate of a completed checkout'
          : checkoutType === 'whatsapp_addon'
            ? 'WhatsApp addon checkout completed'
            : 'Subscription checkout completed',
      );
      return { ok: true, outcome: 'paid', ...base };
    }

    if (verified.status === 'failed') {
      if (tx.status !== 'pending') {
        // failed -> failed (or any other non-pending row) is not a transition; leave the row.
        await markEvent('processed', `Checkout already ${tx.status}; no status change`);
        return { ok: true, outcome: 'failed', ...base };
      }
      const closed = await markCheckoutFailedIfPending(tx.id, tx.business_id, { ...gw, ...verified.rawPayload });
      if (!closed) {
        const now = await queryOne<{ status: string }>(`SELECT status FROM billing_transactions WHERE id = $1`, [tx.id]);
        await markEvent('processed', `Checkout settled concurrently (${now?.status ?? 'unknown'}); no status change`);
        return { ok: true, outcome: now?.status === 'completed' ? 'paid' : 'failed', ...base };
      }
      await markEvent('failed', 'Payment failed');
      return { ok: true, outcome: 'failed', ...base };
    }

    await markEvent('pending', 'Pending — no billing email sent');
    return { ok: true, outcome: 'pending', ...base };
  } catch (err) {
    await markEvent('error', errorMessage(err)).catch((markErr) =>
      console.error('[platform-billing] could not mark easebuzz event error', markErr),
    );
    throw err;
  }
}

export async function listPlatformBillingEvents(limit = 50, offset = 0) {
  return queryRows(
    `SELECT e.*, b.name as business_name
     FROM platform_billing_webhook_events e
     LEFT JOIN businesses b ON e.business_id = b.id
     ORDER BY e.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}

export async function listPlatformBillingTransactions(limit = 50, offset = 0, businessId?: string) {
  if (businessId) {
    return queryRows(
      `SELECT t.*, sp.display_name as plan_display_name
       FROM billing_transactions t
       LEFT JOIN subscription_plans sp ON t.plan_id = sp.id
       WHERE t.business_id = $1
       ORDER BY t.created_at DESC
       LIMIT $2 OFFSET $3`,
      [businessId, limit, offset],
    );
  }
  return queryRows(
    `SELECT t.*, b.name as business_name, sp.display_name as plan_display_name
     FROM billing_transactions t
     LEFT JOIN businesses b ON t.business_id = b.id
     LEFT JOIN subscription_plans sp ON t.plan_id = sp.id
     ORDER BY t.created_at DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
}
