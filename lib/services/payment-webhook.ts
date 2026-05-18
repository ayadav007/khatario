/**
 * PSP webhook processing: strong idempotency, transaction matching, amount/currency
 * validation, payment_transactions + sales_orders updates.
 */

import { createHash } from 'crypto';
import { queryOne } from '@/lib/db';
import type { VerifyWebhookResult } from '@/lib/payments/types';
import {
  getSuccessfulPaymentsSumForOrder,
  PAYMENT_AMOUNT_EPS,
  remainingOrderAmountAfterSuccessSum,
  setSalesOrderPaymentReferenceFromGatewaySuccess,
  updatePaymentTransactionStatus,
  type PaymentTransactionMethod,
  type PaymentTransactionStatus,
} from '@/lib/services/payment-transactions';

/** Max difference allowed between PSP-reported amount and order grand_total (rupees). */
export const WEBHOOK_AMOUNT_TOLERANCE =
  Number.parseFloat(process.env.PAYMENT_WEBHOOK_AMOUNT_TOLERANCE || '') || 1;

export function webhookRawBodyIdempotencyKey(rawBody: string): string {
  return createHash('sha256').update(rawBody, 'utf8').digest('hex');
}

/**
 * Idempotency: `provider_payment_id` + mapped PSP status (scoped by business + provider).
 * Same payment event + same outcome dedupes; raw-body fallback when provider_payment_id absent.
 */
export function computeWebhookProcessingKey(
  businessId: string,
  provider: string,
  verified: VerifyWebhookResult,
  mappedStatus: PaymentTransactionStatus,
  rawBody: string
): string {
  const pid = verified.providerPaymentId?.trim();
  if (pid) {
    return createHash('sha256')
      .update(`v2|${businessId}|${provider.toLowerCase()}|${pid}|${mappedStatus}`, 'utf8')
      .digest('hex');
  }
  return webhookRawBodyIdempotencyKey(rawBody);
}

/**
 * @returns true if this idempotency key is new (claim succeeded), false if duplicate replay.
 */
export async function tryClaimWebhookEvent(
  businessId: string,
  provider: string,
  idempotencyKey: string
): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO payment_webhook_events (business_id, provider, idempotency_key)
     VALUES ($1, $2, $3)
     ON CONFLICT (business_id, provider, idempotency_key) DO NOTHING
     RETURNING id`,
    [businessId, provider.toLowerCase(), idempotencyKey]
  );
  return !!row;
}

function mapWebhookToTxStatus(v: VerifyWebhookResult): PaymentTransactionStatus | null {
  const s = v.status;
  if (s === 'success' || s === 'failed' || s === 'pending') {
    return s;
  }
  return null;
}

function parseMoney(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/** PayU webhook amounts may be numbers or numeric strings; normalize to INR rupees (2 dp). */
function normalizePayuAmountInr(verified: VerifyWebhookResult): number | undefined {
  const raw = verified.rawPayload as Record<string, unknown> | undefined;
  const candidates: unknown[] = [
    verified.amount,
    raw?.amount,
    raw?.net_amount_debit,
    raw?.amt,
  ];
  for (const c of candidates) {
    if (c == null) continue;
    const n =
      typeof c === 'number'
        ? c
        : parseFloat(String(c).replace(/,/g, '').trim());
    if (Number.isFinite(n)) {
      return Math.round(n * 100) / 100;
    }
  }
  return undefined;
}

function isProbablyUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s.trim()
  );
}

/**
 * Resolve payment_transactions row in priority order:
 * 1) provider_payment_id (column) — e.g. PayU `mihpayid`, Razorpay `pay_*`
 * 2) provider_order_id — matches `raw_payload->>'provider_order_id'` (e.g. PayU `txnid`, Razorpay `plink_*`)
 * 3) orderReference — Khatario sales order id (`udf1`, notes; `order_id` / `khatario_order_id`)
 */
export async function findPaymentTransactionForWebhook(args: {
  businessId: string;
  provider: string;
  verified: VerifyWebhookResult;
}): Promise<{
  id: string;
  status: PaymentTransactionStatus;
  order_id: string;
  method: PaymentTransactionMethod;
} | null> {
  const { businessId, provider, verified } = args;
  const pid = verified.providerPaymentId?.trim() || null;
  const providerOrderId = verified.providerOrderId?.trim() || null;
  const orderRef = verified.orderReference?.trim() || null;

  const baseLog = {
    provider,
    provider_payment_id: pid,
    provider_order_id: providerOrderId,
    order_reference: orderRef,
    business_id: businessId,
  };

  if (pid) {
    const byPid = await queryOne<{
      id: string;
      status: PaymentTransactionStatus;
      order_id: string;
      method: PaymentTransactionMethod;
    }>(
      `SELECT id, status, order_id, method
       FROM payment_transactions
       WHERE business_id = $1
         AND LOWER(provider) = LOWER($2)
         AND provider_payment_id IS NOT NULL
         AND provider_payment_id = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [businessId, provider, pid]
    );
    if (byPid) {
      console.log(
        '[payment-webhook] transaction_match',
        JSON.stringify({
          ...baseLog,
          match_path: 'provider_payment_id',
          transaction_id: byPid.id,
        })
      );
      return byPid;
    }
  }

  if (providerOrderId) {
    const byProviderOrderId = await queryOne<{
      id: string;
      status: PaymentTransactionStatus;
      order_id: string;
      method: PaymentTransactionMethod;
    }>(
      `SELECT id, status, order_id, method
       FROM payment_transactions
       WHERE business_id = $1
         AND LOWER(provider) = LOWER($2)
         AND (raw_payload->>'provider_order_id') = $3
       ORDER BY created_at DESC
       LIMIT 1`,
      [businessId, provider, providerOrderId]
    );
    if (byProviderOrderId) {
      console.log(
        '[payment-webhook] transaction_match',
        JSON.stringify({
          ...baseLog,
          match_path: 'provider_order_id',
          transaction_id: byProviderOrderId.id,
        })
      );
      return byProviderOrderId;
    }
  }

  if (orderRef) {
    if (isProbablyUuid(orderRef)) {
      const byOrderRefUuid = await queryOne<{
        id: string;
        status: PaymentTransactionStatus;
        order_id: string;
        method: PaymentTransactionMethod;
      }>(
        `SELECT id, status, order_id, method
         FROM payment_transactions
         WHERE business_id = $1
           AND LOWER(provider) = LOWER($2)
           AND (
             order_id = $3::uuid
             OR (raw_payload->>'khatario_order_id') = $3
           )
         ORDER BY created_at DESC
         LIMIT 1`,
        [businessId, provider, orderRef]
      );
      if (byOrderRefUuid) {
        console.log(
          '[payment-webhook] transaction_match',
          JSON.stringify({
            ...baseLog,
            match_path: 'order_reference',
            match_detail: 'order_id_or_khatario_payload',
            transaction_id: byOrderRefUuid.id,
          })
        );
        return byOrderRefUuid;
      }
    } else {
      const byKhatarioPayload = await queryOne<{
        id: string;
        status: PaymentTransactionStatus;
        order_id: string;
        method: PaymentTransactionMethod;
      }>(
        `SELECT id, status, order_id, method
         FROM payment_transactions
         WHERE business_id = $1
           AND LOWER(provider) = LOWER($2)
           AND (raw_payload->>'khatario_order_id') = $3
         ORDER BY created_at DESC
         LIMIT 1`,
        [businessId, provider, orderRef]
      );
      if (byKhatarioPayload) {
        console.log(
          '[payment-webhook] transaction_match',
          JSON.stringify({
            ...baseLog,
            match_path: 'order_reference',
            match_detail: 'khatario_order_id_payload_only',
            transaction_id: byKhatarioPayload.id,
          })
        );
        return byKhatarioPayload;
      }
    }
  }

  console.error(
    '[payment-webhook] transaction_match_failed',
    JSON.stringify({
      ...baseLog,
      error: 'no_payment_transaction_matched',
    })
  );
  return null;
}

export type ApplyWebhookResult = {
  ok: boolean;
  /** HTTP status code hint for the route handler */
  httpStatus?: number;
  duplicate?: boolean;
  skipped?: boolean;
  transaction_id?: string;
  message?: string;
};

/**
 * After signature verification: idempotent claim, match transaction, validate amounts,
 * update payment_transactions + sync sales_orders; set payment_reference on verified success.
 */
export async function applyVerifiedPaymentWebhook(args: {
  businessId: string;
  provider: string;
  verified: VerifyWebhookResult;
  rawBody: string;
}): Promise<ApplyWebhookResult> {
  const { businessId, provider, verified, rawBody } = args;

  const mapped = mapWebhookToTxStatus(verified);
  if (!mapped) {
    return {
      ok: false,
      httpStatus: 422,
      message: 'no_payment_status_in_payload',
    };
  }

  const tx = await findPaymentTransactionForWebhook({
    businessId,
    provider,
    verified,
  });

  if (!tx) {
    return {
      ok: false,
      httpStatus: 404,
      message: 'no_matching_transaction',
    };
  }

  console.log('[payment-webhook] event', {
    provider,
    business_id: businessId,
    transaction_id: tx.id,
    order_id: tx.order_id,
    mapped_status: mapped,
    provider_payment_id: verified.providerPaymentId,
    provider_order_id: verified.providerOrderId,
    order_reference: verified.orderReference,
    amount: verified.amount,
    currency: verified.currency,
    webhook_status: verified.status,
  });

  const pidCheck = verified.providerPaymentId?.trim();
  if (mapped === 'success' && pidCheck) {
    const dupOther = await queryOne<{ id: string }>(
      `SELECT id FROM payment_transactions
       WHERE business_id = $1 AND LOWER(provider) = LOWER($2)
         AND provider_payment_id = $3 AND status = 'success' AND id <> $4::uuid
       LIMIT 1`,
      [businessId, provider, pidCheck, tx.id]
    );
    if (dupOther) {
      console.warn(
        '[payment-webhook] idempotent_block_duplicate_payment_id',
        JSON.stringify({
          business_id: businessId,
          provider,
          provider_payment_id: pidCheck,
          existing_transaction_id: dupOther.id,
          current_transaction_id: tx.id,
        })
      );
      return {
        ok: false,
        httpStatus: 409,
        message: 'provider_payment_id_already_applied',
      };
    }
  }

  if (tx.status === 'success' && mapped === 'success') {
    return {
      ok: true,
      httpStatus: 200,
      skipped: true,
      transaction_id: tx.id,
      message: 'already_success',
    };
  }

  if (tx.status === 'success' && mapped === 'pending') {
    return {
      ok: true,
      httpStatus: 200,
      skipped: true,
      transaction_id: tx.id,
      message: 'ignore_pending_after_success',
    };
  }

  /**
   * While a tx is in requires_review, allow PSP to resend success webhooks (possibly with
   * corrected amounts) without hitting the payment-id composite dedupe — only raw replays dedupe.
   * Pending→success still uses composite key to prevent double-settlement of the same event.
   */
  const skipCompositeDedupe = tx.status === 'requires_review' && mapped === 'success';
  const idempotencyKey = skipCompositeDedupe
    ? webhookRawBodyIdempotencyKey(rawBody)
    : computeWebhookProcessingKey(businessId, provider, verified, mapped, rawBody);

  const claimed = await tryClaimWebhookEvent(businessId, provider, idempotencyKey);
  if (!claimed) {
    return {
      ok: true,
      httpStatus: 200,
      duplicate: true,
      message: 'duplicate_payload_or_payment_event',
    };
  }

  let effectiveStatus: PaymentTransactionStatus = mapped;
  /** Settled capture amount for this row (partial or full); updates `payment_transactions.amount` for SUM aggregation. */
  let capturedAmount: number | undefined;
  const rawPayloadPatch: Record<string, unknown> = {
    last_webhook: verified.rawPayload ?? {},
    last_webhook_at: new Date().toISOString(),
  };

  if (mapped === 'success') {
    const order = await queryOne<{ grand_total: string }>(
      `SELECT grand_total::text AS grand_total
       FROM sales_orders
       WHERE id = $1 AND business_id = $2`,
      [tx.order_id, businessId]
    );

    if (!order) {
      console.error('[payment-webhook] order_missing', {
        business_id: businessId,
        order_id: tx.order_id,
        transaction_id: tx.id,
      });
      return {
        ok: false,
        httpStatus: 500,
        message: 'order_not_found_for_transaction',
      };
    }

    const expected = parseMoney(order.grand_total);
    const currency = verified.currency?.toUpperCase?.() || 'INR';
    const currencyOk = currency === 'INR';
    const isPayu = provider.toLowerCase() === 'payu';

    const amtInr: number | undefined = isPayu
      ? normalizePayuAmountInr(verified)
      : verified.amount != null && Number.isFinite(verified.amount)
        ? verified.amount
        : undefined;

    // Strict validation: webhook amount must match remaining balance (within EPS),
    // otherwise requires_review and does not contribute to order paid aggregation.
    const paidSumSuccess = await getSuccessfulPaymentsSumForOrder(
      businessId,
      tx.order_id
    );
    const orderRemainingInr = remainingOrderAmountAfterSuccessSum(
      expected,
      paidSumSuccess
    );

    if (amtInr == null || !Number.isFinite(amtInr)) {
      effectiveStatus = 'requires_review';
      rawPayloadPatch.webhook_validation = {
        reason: 'missing_amount',
        expected_grand_total: expected,
      };
      console.warn('[payment-webhook] validation_failed', {
        reason: 'missing_amount',
        transaction_id: tx.id,
        order_id: tx.order_id,
        provider,
      });
    } else if (!currencyOk) {
      effectiveStatus = 'requires_review';
      rawPayloadPatch.webhook_validation = {
        reason: 'currency_mismatch',
        expected: 'INR',
        received: verified.currency,
      };
      console.warn('[payment-webhook] validation_failed', {
        reason: 'currency_mismatch',
        transaction_id: tx.id,
        order_id: tx.order_id,
        currency: verified.currency,
      });
    } else if (Math.abs(amtInr - orderRemainingInr) > PAYMENT_AMOUNT_EPS) {
      effectiveStatus = 'requires_review';
      rawPayloadPatch.webhook_validation = {
        reason: 'amount_remaining_mismatch',
        webhook_amount_inr: amtInr,
        order_remaining_inr: orderRemainingInr,
        grand_total_inr: expected,
        success_sum_inr_excluding_this_tx: paidSumSuccess,
        eps: PAYMENT_AMOUNT_EPS,
      };
      console.warn(
        '[payment-webhook] validation_failed',
        JSON.stringify({
          reason: 'amount_remaining_mismatch',
          transaction_id: tx.id,
          order_id: tx.order_id,
          webhook_amount_inr: amtInr,
          order_remaining_inr: orderRemainingInr,
          grand_total_inr: expected,
          success_sum_inr_excluding_this_tx: paidSumSuccess,
          eps: PAYMENT_AMOUNT_EPS,
        })
      );
    } else {
      effectiveStatus = 'success';
      capturedAmount = amtInr;
      rawPayloadPatch.webhook_validation = {
        strict_remaining_match: true,
        captured_amount: amtInr,
        order_remaining_inr: orderRemainingInr,
        success_sum_inr_excluding_this_tx: paidSumSuccess,
        eps: PAYMENT_AMOUNT_EPS,
      };
    }
  }

  await updatePaymentTransactionStatus(businessId, tx.id, {
    status: effectiveStatus,
    utr: verified.utr ?? undefined,
    payerName: verified.payerName ?? undefined,
    providerPaymentId: verified.providerPaymentId ?? undefined,
    capturedAmount,
    rawPayloadPatch,
    syncSalesOrder: true,
  });

  if (effectiveStatus === 'success') {
    await setSalesOrderPaymentReferenceFromGatewaySuccess(businessId, tx.order_id, {
      utr: verified.utr ?? null,
      providerPaymentId: verified.providerPaymentId ?? null,
      methodLabel: tx.method === 'upi_collect' ? 'upi_collect' : provider,
    });
  }

  return {
    ok: true,
    httpStatus: 200,
    transaction_id: tx.id,
    message:
      effectiveStatus === 'requires_review' && mapped === 'success'
        ? 'success_downgraded_to_requires_review'
        : 'processed',
  };
}
