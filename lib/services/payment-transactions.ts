/**
 * Payment transactions — persistence helpers for gateway/UPI-collect/VA flows.
 * Backed by payment_transactions + sales_orders.payment_status / payment_method.
 */

import { query, queryOne } from '@/lib/db';

export type PaymentTransactionMethod = 'upi_collect' | 'virtual_account';

export type PaymentTransactionStatus =
  | 'pending'
  | 'success'
  | 'failed'
  | 'requires_review';

/** Aggregate payment state on sales_orders (`partial` legacy; prefer `partial_paid`) */
export type SalesOrderPaymentStatus =
  | 'unpaid'
  | 'pending'
  | 'partial'
  | 'partial_paid'
  | 'paid'
  | 'failed';

export type PaymentTransactionRow = {
  id: string;
  business_id: string;
  order_id: string;
  provider: string;
  provider_payment_id: string | null;
  method: PaymentTransactionMethod;
  amount: string;
  currency: string;
  status: PaymentTransactionStatus;
  utr: string | null;
  payer_name: string | null;
  raw_payload: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
};

export type CreatePaymentTransactionInput = {
  businessId: string;
  orderId: string;
  provider: string;
  providerPaymentId?: string | null;
  method: PaymentTransactionMethod;
  amount: number;
  currency?: string;
  status?: PaymentTransactionStatus;
  utr?: string | null;
  payerName?: string | null;
  rawPayload?: Record<string, unknown> | null;
  /** When true (default), sets sales_orders.payment_status / payment_method on insert */
  syncSalesOrder?: boolean;
};

export type UpdatePaymentTransactionStatusInput = {
  status: PaymentTransactionStatus;
  utr?: string | null;
  payerName?: string | null;
  /** Merged into existing raw_payload (shallow) */
  rawPayloadPatch?: Record<string, unknown> | null;
  providerPaymentId?: string | null;
  /** Actual captured amount from PSP (partial settlement updates this column for SUM aggregation) */
  capturedAmount?: number | null;
  /** When true (default), recomputes sales_orders.payment_status (and method from latest success) */
  syncSalesOrder?: boolean;
};

/** Tolerance for rupee comparisons (partial sums, remaining balance). */
export { PAYMENT_AMOUNT_EPS } from '@/lib/payment-constants';
import { PAYMENT_AMOUNT_EPS } from '@/lib/payment-constants';

const EPS = PAYMENT_AMOUNT_EPS;

function parseMoney(v: string | number): number {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Sum of successful captures for the order (same basis as settlement aggregation).
 */
export async function getSuccessfulPaymentsSumForOrder(
  businessId: string,
  orderId: string
): Promise<number> {
  const row = await queryOne<{ success_sum: string }>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0)::text AS success_sum
     FROM payment_transactions
     WHERE business_id = $1 AND order_id = $2`,
    [businessId, orderId]
  );
  return row ? parseMoney(row.success_sum) : 0;
}

/**
 * Remaining balance due (never negative). Uses same EPS as settlement.
 */
export function remainingOrderAmountAfterSuccessSum(
  grandTotal: number,
  successSum: number
): number {
  const r = grandTotal - successSum;
  if (!Number.isFinite(r)) return 0;
  return Math.max(0, r);
}

/**
 * Recompute sales_orders.payment_status and payment_method from SUM(success.amount).
 * Multiple partial captures are summed; `partial_paid` when 0 < sum < grand_total.
 */
export async function recomputeSalesOrderPaymentAggregate(
  businessId: string,
  orderId: string
): Promise<void> {
  const order = await queryOne<{ grand_total: string; payment_status: string | null }>(
    `SELECT grand_total::text AS grand_total, payment_status
     FROM sales_orders WHERE id = $1 AND business_id = $2`,
    [orderId, businessId]
  );
  if (!order) return;

  const grandTotal = parseMoney(order.grand_total);

  const agg = await queryOne<{ success_sum: string; pending_cnt: string; failed_only: string }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'success' THEN amount ELSE 0 END), 0)::text AS success_sum,
       COUNT(*) FILTER (WHERE status IN ('pending', 'requires_review'))::text AS pending_cnt,
       (COUNT(*) FILTER (WHERE status = 'failed') > 0
         AND COUNT(*) FILTER (WHERE status IN ('success', 'pending', 'requires_review')) = 0)::text AS failed_only
     FROM payment_transactions
     WHERE business_id = $1 AND order_id = $2`,
    [businessId, orderId]
  );

  const paidSum = agg ? parseMoney(agg.success_sum) : 0;
  const pendingCnt = agg ? parseInt(agg.pending_cnt, 10) || 0 : 0;
  const failedOnly = Boolean(agg?.failed_only);

  const latestSuccessMethod = await queryOne<{ method: string }>(
    `SELECT method FROM payment_transactions
     WHERE business_id = $1 AND order_id = $2 AND status = 'success'
     ORDER BY updated_at DESC NULLS LAST, created_at DESC
     LIMIT 1`,
    [businessId, orderId]
  );

  let paymentStatus: SalesOrderPaymentStatus;
  if (paidSum >= grandTotal - PAYMENT_AMOUNT_EPS && grandTotal > 0) {
    paymentStatus = 'paid';
  } else if (paidSum > PAYMENT_AMOUNT_EPS && paidSum < grandTotal - PAYMENT_AMOUNT_EPS) {
    paymentStatus = 'partial_paid';
  } else if (pendingCnt > 0) {
    paymentStatus = 'pending';
  } else if (failedOnly && paidSum <= EPS) {
    paymentStatus = 'failed';
  } else {
    paymentStatus = 'unpaid';
  }

  console.log(
    '[payment-sync] settlement',
    JSON.stringify({
      business_id: businessId,
      order_id: orderId,
      grand_total: grandTotal,
      total_paid_success_sum: paidSum,
      pending_gateway_tx_count: pendingCnt,
      previous_payment_status: order.payment_status,
      decision: paymentStatus,
    })
  );

  /**
   * WhatsApp pending-orders UI historically keyed off `payment_screenshot_url` / OCR.
   * When the customer pays via a PSP link, webhooks set `payment_status` only — sync proof
   * metadata so the dashboard shows "paid online" without a screenshot.
   */
  await query(
    `UPDATE sales_orders
     SET payment_status = $3::varchar,
         payment_method = COALESCE($4::varchar, payment_method),
         ocr_status = CASE
           WHEN whatsapp_conversation_id IS NOT NULL
             AND $3::varchar = 'paid'
           THEN 'verified'
           ELSE ocr_status
         END,
         ocr_data = CASE
           WHEN whatsapp_conversation_id IS NOT NULL
             AND $3::varchar = 'paid'
           THEN COALESCE(ocr_data, '{}'::jsonb)
             || jsonb_build_object(
               'verification_source', 'psp_webhook',
               'whatsapp_order_confirmed', true,
               'payment_confirmed_via', 'gateway_settlement'
             )
           ELSE ocr_data
         END,
         notes = CASE
           WHEN whatsapp_conversation_id IS NOT NULL
             AND $3::varchar = 'paid'
             AND (notes IS NULL OR trim(notes) = '')
           THEN 'Payment confirmed via payment provider (webhook)'
           ELSE notes
         END,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [
      orderId,
      businessId,
      paymentStatus,
      latestSuccessMethod?.method ?? null,
    ]
  );
}

async function syncSalesOrderPaymentAggregate(
  businessId: string,
  orderId: string
): Promise<void> {
  await recomputeSalesOrderPaymentAggregate(businessId, orderId);
}

/**
 * Insert a payment_transactions row and optionally mark the sales order as collecting payment.
 */
export async function createPaymentTransaction(
  input: CreatePaymentTransactionInput
): Promise<PaymentTransactionRow> {
  const {
    businessId,
    orderId,
    provider,
    providerPaymentId = null,
    method,
    amount,
    currency = 'INR',
    status = 'pending',
    utr = null,
    payerName = null,
    rawPayload = null,
    syncSalesOrder = true,
  } = input;

  const row = await queryOne<PaymentTransactionRow>(
    `INSERT INTO payment_transactions (
       business_id, order_id, provider, provider_payment_id, method,
       amount, currency, status, utr, payer_name, raw_payload
     ) VALUES (
       $1, $2, $3, $4, $5,
       $6, $7, $8, $9, $10, COALESCE($11::jsonb, '{}'::jsonb)
     )
     RETURNING
       id, business_id, order_id, provider, provider_payment_id, method,
       amount::text, currency, status, utr, payer_name,
       raw_payload, created_at, updated_at`,
    [
      businessId,
      orderId,
      provider,
      providerPaymentId,
      method,
      amount,
      currency,
      status,
      utr,
      payerName,
      rawPayload ? JSON.stringify(rawPayload) : null,
    ]
  );

  if (!row) {
    throw new Error('createPaymentTransaction: insert returned no row');
  }

  if (syncSalesOrder) {
    await syncSalesOrderPaymentAggregate(businessId, orderId);
  }

  return row;
}

/**
 * Update status (and optional fields) on a payment transaction by id.
 */
export async function updatePaymentTransactionStatus(
  businessId: string,
  transactionId: string,
  input: UpdatePaymentTransactionStatusInput
): Promise<PaymentTransactionRow | null> {
  const {
    status,
    utr,
    payerName,
    rawPayloadPatch,
    providerPaymentId,
    capturedAmount,
    syncSalesOrder = true,
  } = input;

  const existing = await queryOne<{ order_id: string; raw_payload: Record<string, unknown> }>(
    `SELECT order_id, raw_payload FROM payment_transactions WHERE id = $1 AND business_id = $2`,
    [transactionId, businessId]
  );
  if (!existing) return null;

  const mergedPayload =
    rawPayloadPatch && Object.keys(rawPayloadPatch).length > 0
      ? JSON.stringify({
          ...(existing.raw_payload || {}),
          ...rawPayloadPatch,
        })
      : null;

  const row = await queryOne<PaymentTransactionRow>(
    `UPDATE payment_transactions SET
       status = $3,
       utr = COALESCE($4, utr),
       payer_name = COALESCE($5, payer_name),
       provider_payment_id = COALESCE($6, provider_payment_id),
       amount = COALESCE($8::decimal, amount),
       raw_payload = CASE WHEN $7::text IS NULL THEN raw_payload ELSE $7::jsonb END,
       updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2
     RETURNING
       id, business_id, order_id, provider, provider_payment_id, method,
       amount::text, currency, status, utr, payer_name,
       raw_payload, created_at, updated_at`,
    [
      transactionId,
      businessId,
      status,
      utr !== undefined ? utr : null,
      payerName !== undefined ? payerName : null,
      providerPaymentId !== undefined ? providerPaymentId : null,
      mergedPayload,
      capturedAmount ?? null,
    ]
  );

  if (syncSalesOrder && row) {
    await syncSalesOrderPaymentAggregate(businessId, existing.order_id);
  }

  return row;
}

/**
 * After a webhook-validated successful payment, persist human-visible reference on the order.
 * Prefer UTR; fallback to provider payment id. Does not change payment_status (sync handles that).
 */
export async function setSalesOrderPaymentReferenceFromGatewaySuccess(
  businessId: string,
  orderId: string,
  options: {
    utr?: string | null;
    providerPaymentId?: string | null;
    /** e.g. upi_collect or provider id */
    methodLabel: string;
  }
): Promise<void> {
  const ref =
    options.utr?.trim() ||
    options.providerPaymentId?.trim() ||
    null;
  if (!ref) return;

  await query(
    `UPDATE sales_orders
     SET payment_reference = $3,
         payment_method = COALESCE($4::varchar, payment_method),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2`,
    [orderId, businessId, ref, options.methodLabel]
  );
}

/**
 * Single pending UPI collect session per order — used to avoid duplicate PSP calls / rows.
 */
export async function getPendingUpiCollectTransactionForOrder(
  businessId: string,
  orderId: string
): Promise<PaymentTransactionRow | null> {
  return queryOne<PaymentTransactionRow>(
    `SELECT
       id, business_id, order_id, provider, provider_payment_id, method,
       amount::text, currency, status, utr, payer_name,
       raw_payload, created_at, updated_at
     FROM payment_transactions
     WHERE business_id = $1
       AND order_id = $2
       AND method = 'upi_collect'
       AND status = 'pending'
     ORDER BY created_at DESC
     LIMIT 1`,
    [businessId, orderId]
  );
}

/**
 * If a pending UPI collect row exists but its amount no longer matches the
 * required remaining balance (e.g. after a partial success elsewhere), mark it
 * failed so a new collect can be created for the correct amount.
 */
export async function failStaleUpiCollectIfAmountMismatch(
  businessId: string,
  orderId: string,
  requiredRemainingAmount: number
): Promise<void> {
  const pending = await getPendingUpiCollectTransactionForOrder(
    businessId,
    orderId
  );
  if (!pending) return;

  const rowAmt = parseMoney(pending.amount);
  if (Math.abs(rowAmt - requiredRemainingAmount) <= PAYMENT_AMOUNT_EPS) {
    return;
  }

  const prev = (pending.raw_payload || {}) as Record<string, unknown>;
  const merged = {
    ...prev,
    superseded_at: new Date().toISOString(),
    superseded_reason: 'collect_amount_stale',
    previous_row_amount: rowAmt,
    required_remaining_amount: requiredRemainingAmount,
  };

  await query(
    `UPDATE payment_transactions
     SET status = 'failed',
         raw_payload = $3::jsonb,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND business_id = $2 AND status = 'pending'`,
    [pending.id, businessId, JSON.stringify(merged)]
  );

  await syncSalesOrderPaymentAggregate(businessId, orderId);
}
