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

import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import type { VerifyWebhookResult } from '@/lib/payments/types';
import {
  completeSubscriptionCheckoutPayment,
  extractCheckoutMetaFromWebhookNotes,
  getPlatformRazorpayProvider,
} from '@/lib/platform-subscription-checkout';

export type BillingTxStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export interface RecordBillingInput {
  businessId: string;
  subscriptionId?: string | null;
  planId: string;
  /** List/base price before discount */
  amount: number;
  billingCycle?: 'monthly' | 'yearly';
  paymentMethod?: string;
  paymentReference?: string | null;
  status: BillingTxStatus;
  description?: string;
  gatewayResponse?: unknown;
  skipEmails?: boolean;
  couponId?: string | null;
  discountAmount?: number;
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
  return sent;
}

export async function recordBillingTransaction(
  input: RecordBillingInput,
): Promise<{ id: string; status: BillingTxStatus }> {
  if (input.paymentReference?.trim()) {
    const existing = await queryOne<{ id: string; status: string }>(
      `SELECT id, status FROM billing_transactions
       WHERE business_id = $1 AND payment_reference = $2
       LIMIT 1`,
      [input.businessId, input.paymentReference.trim()],
    );
    if (existing) {
      return { id: existing.id, status: existing.status as BillingTxStatus };
    }
  }

  const sub = await queryOne<{ id: string }>(
    `SELECT id FROM business_subscriptions WHERE business_id = $1 LIMIT 1`,
    [input.businessId],
  );

  const base = Math.round(input.amount * 100) / 100;
  const discount = Math.round((input.discountAmount ?? 0) * 100) / 100;
  const total = Math.max(0, Math.round((base - discount) * 100) / 100);
  const row = await queryOne<{ id: string; status: string }>(
    `INSERT INTO billing_transactions (
       business_id, subscription_id, type, status, amount, currency, plan_id, billing_cycle,
       payment_method, payment_reference, gateway_response, description,
       coupon_id, discount_amount, total_amount
     ) VALUES ($1, $2, 'payment', $3, $4, 'INR', $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING id, status`,
    [
      input.businessId,
      input.subscriptionId ?? sub?.id ?? null,
      input.status,
      base,
      input.planId,
      input.billingCycle ?? 'monthly',
      input.paymentMethod ?? 'manual',
      input.paymentReference?.trim() || null,
      input.gatewayResponse ? JSON.stringify(input.gatewayResponse) : null,
      input.description ?? null,
      input.couponId ?? null,
      discount,
      total,
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
  await query(
    `UPDATE billing_transactions
     SET status = $2,
         gateway_response = COALESCE($3::jsonb, gateway_response),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [transactionId, status, gatewayResponse ? JSON.stringify(gatewayResponse) : null],
  );
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
  subscriptionId?: string;
  planId: string;
  planDisplayName: string;
  amount: number;
  billingCycle: 'monthly' | 'yearly';
  paymentMethod: string;
  paymentReference?: string | null;
  paymentStatus?: BillingTxStatus;
}): Promise<void> {
  const status = params.paymentStatus ?? 'completed';

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

  await recordBillingTransaction({
    businessId: params.businessId,
    subscriptionId: params.subscriptionId,
    planId: params.planId,
    amount: params.amount,
    billingCycle: params.billingCycle,
    paymentMethod: params.paymentMethod,
    paymentReference: params.paymentReference,
    status,
    description: `Upgrade to ${params.planDisplayName}`,
    skipEmails: false,
  });
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
  billingCycle?: 'monthly' | 'yearly';
} {
  const raw = verified.rawPayload as Record<string, unknown> | undefined;
  const payload = raw?.payload as Record<string, unknown> | undefined;
  const payment = (payload?.payment as Record<string, unknown>)?.entity as Record<string, unknown> | undefined;
  const notes = payment?.notes as Record<string, unknown> | undefined;
  if (!notes) return {};
  return {
    planId: typeof notes.plan_id === 'string' ? notes.plan_id : undefined,
    billingCycle:
      notes.billing_cycle === 'yearly' || notes.billing_cycle === 'monthly'
        ? notes.billing_cycle
        : undefined,
  };
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
}): Promise<boolean> {
  const row = await queryOne(
    `INSERT INTO platform_billing_webhook_events
       (provider, idempotency_key, event_type, business_id, billing_transaction_id, status, payload, processing_notes)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (provider, idempotency_key) DO NOTHING
     RETURNING id`,
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
  return Boolean(row);
}

export async function processPlatformRazorpayWebhook(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const provider = getPlatformRazorpayProvider();
  if (!provider) {
    return { ok: false, error: 'Platform Razorpay not configured' };
  }

  const verified = await provider.verifyWebhook({ rawBody, headers });
  if (!verified.verified) {
    return { ok: false, error: verified.reason || 'Verification failed' };
  }

  const idemKey = verified.providerPaymentId
    ? createHash('sha256')
        .update(`platform|razorpay|${verified.eventType}|${verified.providerPaymentId}|${verified.status}`)
        .digest('hex')
    : createHash('sha256').update(`platform|razorpay|${rawBody}`).digest('hex');

  const isNew = await logPlatformWebhookEvent({
    provider: 'razorpay',
    idempotencyKey: idemKey,
    eventType: verified.eventType || 'unknown',
    status: 'received',
    payload: verified.rawPayload ?? {},
  });

  if (!isNew) {
    return { ok: true, duplicate: true };
  }

  const businessId = extractBusinessIdFromWebhook(verified);
  if (!businessId) {
    await query(
      `UPDATE platform_billing_webhook_events SET status = 'ignored', processing_notes = $2
       WHERE provider = 'razorpay' AND idempotency_key = $1`,
      [idemKey, 'No business_id in webhook notes'],
    );
    return { ok: true, error: 'No business_id in payload' };
  }

  const legacyMeta = extractPlanMetaFromWebhook(verified);
  const checkoutMeta = extractCheckoutMetaFromWebhookNotes(verified);
  const sub = await queryOne<{ plan_id: string; id: string }>(
    `SELECT id, plan_id FROM business_subscriptions WHERE business_id = $1`,
    [businessId],
  );
  const planId =
    checkoutMeta.planId || legacyMeta.planId || sub?.plan_id || 'free';
  const amount = verified.amount ?? 0;
  const billingCycle =
    checkoutMeta.billingCycle || legacyMeta.billingCycle || 'monthly';
  const billingTransactionId = checkoutMeta.billingTransactionId;

  let billingTxId: string | null = billingTransactionId ?? null;
  let notes = '';

  if (verified.status === 'success') {
    if (checkoutMeta.planId || billingTransactionId) {
      await completeSubscriptionCheckoutPayment({
        businessId,
        planId,
        billingCycle,
        billingTransactionId,
        providerPaymentId: verified.providerPaymentId,
        amount,
        gatewayResponse: verified.rawPayload,
      });
      notes = 'Subscription checkout completed';
    } else {
      const { id } = await recordBillingTransaction({
        businessId,
        subscriptionId: sub?.id,
        planId,
        amount,
        billingCycle,
        paymentMethod: 'razorpay',
        paymentReference: verified.providerPaymentId || null,
        status: 'completed',
        description: 'Razorpay webhook payment',
        gatewayResponse: verified.rawPayload,
      });
      billingTxId = id;
      if (legacyMeta.planId) {
        await query(
          `UPDATE business_subscriptions
           SET plan_id = $2, status = 'active', billing_cycle = $3, updated_at = NOW()
           WHERE business_id = $1`,
          [businessId, legacyMeta.planId, billingCycle],
        );
      }
      clearSubscriptionCache(businessId);
      notes = 'Payment completed (legacy webhook path)';
    }
  } else if (verified.status === 'failed') {
    if (billingTransactionId) {
      await updateBillingTransactionStatus(
        billingTransactionId,
        'failed',
        verified.rawPayload,
      );
      billingTxId = billingTransactionId;
    } else {
      const { id } = await recordBillingTransaction({
        businessId,
        subscriptionId: sub?.id,
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

  const eventStatus =
    verified.status === 'success' ? 'processed' : verified.status === 'failed' ? 'failed' : 'pending';
  await query(
    `UPDATE platform_billing_webhook_events
     SET status = $2, business_id = $3, billing_transaction_id = $4, processing_notes = $5
     WHERE provider = 'razorpay' AND idempotency_key = $1`,
    [idemKey, eventStatus, businessId, billingTxId, notes],
  );

  return { ok: true };
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
