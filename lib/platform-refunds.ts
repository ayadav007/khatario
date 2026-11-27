/**
 * Refunds of Khatario's own subscription payments (billing_transactions), end to end.
 *
 * A refund is a billing_transactions row of type 'refund' (see migration 480): `pending` while the
 * gateway has not confirmed it, `completed` once it has, `failed` when the gateway refused it. The
 * payment it refunds stays `completed` until the refunds against it add up to everything that can be
 * refunded (its paid amount minus any upgrade credit taken from it), then becomes `refunded`.
 *
 * Order of work for `refundPlatformPayment`:
 *   1. one transaction: lock the payment row FOR UPDATE, validate, reserve the amount by inserting the
 *      `pending` refund row, commit;
 *   2. call the gateway outside any transaction, with an idempotency key made from the refund row id;
 *   3. a second transaction records the result: on success mark the row, mark the payment, apply the
 *      plan rule and cancel partner commission; on a definite refusal mark the row `failed` and change
 *      nothing else. A timeout or unknown error leaves the row `pending`; a retry with the same
 *      request (or the gateway's `refund.processed` / `refund.failed` webhook) settles it, and the
 *      same key means the gateway never refunds twice.
 *
 * Lock order everywhere: checkout/payment row -> (refund row) -> module lock -> other payment rows
 * (read, not locked, so two refunds on different payments of one module cannot deadlock).
 * Amounts are integer paise inside this file; the public request and result use rupees.
 */

import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool, query, queryOne } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { moveModuleSubscriptionToFree } from '@/lib/subscription/module-plan-lifecycle';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { refundableAmountPaise } from '@/lib/subscription/upgrade-credit';
import { isTaxedMode, issueInvoiceNumber } from '@/lib/platform-tax';
import { GRACE_DAYS } from '@/lib/subscription/effective-plan';
import { escapeHtml } from '@/lib/platform-receipt';
import { assertBillingTransactionTransition } from '@/lib/platform-billing-transaction-state';
import { GatewayRefundError } from '@/lib/payments/gateway-refund-error';
import { getBusinessPlatformRecipient, sendPlatformEmail } from '@/lib/platform-email';
import { getPlatformEasebuzzProvider, getPlatformRazorpayProvider } from '@/lib/platform-subscription-checkout';
import type { PlatformModule } from '@/lib/platform-modules';

export type RefundRequest = {
  businessId: string;
  transactionId: string;
  adminId: string;
  /** Rupees. Omitted = everything that can still be refunded. */
  amount?: number;
  /** What happens to the plan. Needed only for the refund that brings the payment to fully refunded; a partial refund never changes the plan. */
  endPlan?: 'now' | 'period_end';
  notes?: string;
  /** Optional caller key: a repeat with the same key returns the same refund instead of making a new one. */
  idempotencyKey?: string;
};

export type RefundResult = {
  refundTransactionId: string;
  status: 'processed' | 'pending';
  /** Rupees refunded so far on the payment (completed refunds only). */
  refundedTotal: number;
  fullyRefunded: boolean;
  /** Plain-English account of what happened to the customer's money and plan. */
  message?: string;
};

export type RefundErrorCode =
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'NOT_REFUNDABLE'
  | 'REFUND_EXCEEDS_PAYMENT'
  | 'GATEWAY_REFUSED';

export class PlatformRefundError extends Error {
  constructor(
    public readonly code: RefundErrorCode,
    message: string,
    public readonly httpStatus: number,
  ) {
    super(message);
    this.name = 'PlatformRefundError';
  }
}

const GATEWAY_METHODS = new Set(['razorpay', 'easebuzz']);
/** Payment methods recorded without a gateway call. An allow-list: a null or unexpected method fails closed. */
const MANUAL_METHODS = new Set(['manual']);
/** A claimed gateway attempt that never finished is taken over after this long. */
const CLAIM_STALE_MINUTES = 5;
const MIN_REFUND_PAISE = 100;

type PaymentRow = {
  id: string;
  business_id: string;
  type: string;
  status: string;
  payment_method: string | null;
  payment_reference: string | null;
  total_amount: string;
  currency: string | null;
  plan_id: string | null;
  billing_cycle: string | null;
  module_key: string | null;
  coupon_id: string | null;
  period_start: string | null;
  period_end: string | null;
  gateway_response: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  tax_amount: string | null;
  cgst_amount: string | null;
  sgst_amount: string | null;
  igst_amount: string | null;
  gst_rate: string | null;
  gst_mode: string | null;
  taxable_amount: string | null;
};

type RefundRow = PaymentRow & { amount: string };

const PAYMENT_COLUMNS = `id::text AS id, business_id::text AS business_id, type, status, payment_method, payment_reference,
  total_amount::text AS total_amount, currency, plan_id, billing_cycle, module_key, coupon_id::text AS coupon_id,
  period_start::text AS period_start, period_end::text AS period_end, gateway_response, metadata,
  tax_amount::text AS tax_amount, cgst_amount::text AS cgst_amount, sgst_amount::text AS sgst_amount,
  igst_amount::text AS igst_amount, gst_rate::text AS gst_rate, gst_mode,
  taxable_amount::text AS taxable_amount`;

const toPaise = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);
const rupees = (paise: number) => paise / 100;
const rupeesText = (paise: number) => (paise / 100).toFixed(2);
const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/** Key sent to the gateway; derived from the refund row id so every retry of one refund sends the same key. */
export function gatewayRefundKey(refundRowId: string): string {
  return `khrf_${refundRowId.replace(/-/g, '')}`;
}

async function refundTotals(client: Pick<PoolClient, 'query'>, paymentId: string) {
  const r = await client.query<{ completed: string; pending: string }>(
    `SELECT COALESCE(SUM(CASE WHEN status = 'completed' THEN round(total_amount * 100) END), 0)::bigint AS completed,
            COALESCE(SUM(CASE WHEN status = 'pending' THEN round(total_amount * 100) END), 0)::bigint AS pending
     FROM billing_transactions
     WHERE type = 'refund' AND metadata->>'refund_of' = $1`,
    [paymentId],
  );
  return { completed: Number(r.rows[0]?.completed ?? 0), pending: Number(r.rows[0]?.pending ?? 0) };
}

/** Keeps the payment row's metadata.refunded_paise = refunds done + refunds in progress (upgrade credit reads it). */
async function syncRefundedPaise(client: Pick<PoolClient, 'query'>, payment: PaymentRow) {
  const t = await refundTotals(client, payment.id);
  await client.query(
    `UPDATE billing_transactions
     SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('refunded_paise', $2::bigint),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [payment.id, t.completed + t.pending],
  );
  return t;
}

/**
 * The tax inside a refund of `paise`, head by head (CGST, SGST, IGST), as a credit note shows it. For each head
 * the refund takes round-down(cumulative refunded x payment's head / amount paid) minus what earlier refunds
 * (pending or completed) already took of that head; the refund that reaches the full amount paid takes the exact
 * remainder. So after refunds in any number of parts every head sums exactly to the invoice's figure. The taxable
 * part is what is left of the refund. Null for a payment with no tax recorded (tax-free).
 */
async function refundTaxShare(client: Pick<PoolClient, 'query'>, payment: PaymentRow, paise: number) {
  const paidPaise = toPaise(payment.total_amount);
  if (toPaise(payment.tax_amount) <= 0 || paidPaise <= 0) return null;
  const done = await refundTotals(client, payment.id);
  const cumAfter = done.completed + done.pending + paise;
  const prior = (
    await client.query<{ cgst: string; sgst: string; igst: string }>(
      `SELECT COALESCE(SUM(round(cgst_amount * 100)), 0)::text AS cgst, COALESCE(SUM(round(sgst_amount * 100)), 0)::text AS sgst,
              COALESCE(SUM(round(igst_amount * 100)), 0)::text AS igst
       FROM billing_transactions
       WHERE type = 'refund' AND metadata->>'refund_of' = $1 AND status <> 'failed'`,
      [payment.id],
    )
  ).rows[0];
  const head = (total: number, before: number) => {
    const upTo = cumAfter >= paidPaise ? total : Math.floor((cumAfter * total) / paidPaise);
    return Math.min(Math.max(0, upTo - before), Math.max(0, total - before));
  };
  const cgstPaise = head(toPaise(payment.cgst_amount), Number(prior.cgst));
  const sgstPaise = head(toPaise(payment.sgst_amount), Number(prior.sgst));
  const igstPaise = head(toPaise(payment.igst_amount), Number(prior.igst));
  const taxPaise = cgstPaise + sgstPaise + igstPaise;
  return {
    taxPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    meta: {
      mode: payment.gst_mode,
      rate: Number(payment.gst_rate ?? 0),
      taxable: rupees(paise - taxPaise),
      tax: rupees(taxPaise),
      cgst: rupees(cgstPaise),
      sgst: rupees(sgstPaise),
      igst: rupees(igstPaise),
    },
  };
}

async function insertRefundRow(
  client: Pick<PoolClient, 'query'>,
  payment: PaymentRow,
  p: { id: string; paise: number; reference: string | null; metadata: Record<string, unknown> },
) {
  const tax = await refundTaxShare(client, payment, p.paise);
  await client.query(
    `INSERT INTO billing_transactions
       (id, business_id, type, status, amount, currency, plan_id, billing_cycle, payment_method, payment_reference,
        discount_amount, tax_amount, total_amount, description, metadata, module_key,
        taxable_amount, cgst_amount, sgst_amount, igst_amount, gst_rate, gst_mode)
     VALUES ($1, $2, 'refund', 'pending', $3, $4, $5, $6, $7, $8, 0, $12, $3, $9, $10::jsonb, $11,
             $13, $14, $15, $16, $17, $18)`,
    [
      p.id,
      payment.business_id,
      rupeesText(p.paise),
      payment.currency || 'INR',
      payment.plan_id,
      payment.billing_cycle,
      payment.payment_method,
      p.reference,
      `Refund of payment ${payment.id}`,
      JSON.stringify({
        refund_of: payment.id,
        refund_paise: p.paise,
        ...p.metadata,
        // Who sold to whom, copied from the payment, plus this refund's own share of the tax.
        ...(payment.metadata?.tax || tax ? { tax: { ...((payment.metadata?.tax as object | undefined) ?? {}), ...(tax?.meta ?? {}) } } : {}),
      }),
      payment.module_key,
      tax ? rupeesText(tax.taxPaise) : '0',
      tax ? rupeesText(p.paise - tax.taxPaise) : null,
      tax ? rupeesText(tax.cgstPaise) : null,
      tax ? rupeesText(tax.sgstPaise) : null,
      tax ? rupeesText(tax.igstPaise) : null,
      tax ? payment.gst_rate : null,
      tax ? payment.gst_mode : null,
    ],
  );
}

async function loadPaymentForUpdate(client: PoolClient, id: string): Promise<PaymentRow | null> {
  return (
    (await client.query<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM billing_transactions WHERE id = $1 FOR UPDATE`, [id]))
      .rows[0] ?? null
  );
}

async function withClient<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

/** What a gateway payment id / Easebuzz id for this payment is, or why the payment cannot be refunded at the gateway. */
function gatewayPaymentId(payment: PaymentRow): string {
  if (payment.payment_method === 'razorpay') {
    const ref = payment.payment_reference ?? '';
    if (!/^pay_[A-Za-z0-9_-]+$/.test(ref)) {
      throw new PlatformRefundError(
        'NOT_REFUNDABLE',
        'This payment has no Razorpay payment id on record, so it cannot be refunded from here. Refund it in the Razorpay dashboard; the refund will then be recorded here by webhook.',
        409,
      );
    }
    return ref;
  }
  const webhook = (payment.gateway_response?.webhook ?? null) as Record<string, unknown> | null;
  const easeId = (typeof webhook?.easepayid === 'string' && webhook.easepayid) || '';
  if (!easeId) {
    throw new PlatformRefundError(
      'NOT_REFUNDABLE',
      'This payment has no Easebuzz transaction id on record, so it cannot be refunded from here. Refund it in the Easebuzz dashboard.',
      409,
    );
  }
  return easeId;
}

function validateAmount(requested: number | undefined, remainingPaise: number): number {
  if (requested === undefined || requested === null) return remainingPaise;
  const raw = Number(requested) * 100;
  const paise = Math.round(raw);
  if (!Number.isFinite(raw) || paise <= 0 || Math.abs(raw - paise) > 1e-6) {
    throw new PlatformRefundError('INVALID_REQUEST', 'Enter a refund amount in rupees and paise, greater than zero.', 400);
  }
  if (paise > remainingPaise) {
    throw new PlatformRefundError(
      'REFUND_EXCEEDS_PAYMENT',
      `The most that can still be refunded on this payment is ${inr(remainingPaise)}.`,
      422,
    );
  }
  if (paise < MIN_REFUND_PAISE && paise !== remainingPaise) {
    throw new PlatformRefundError('INVALID_REQUEST', 'The smallest refund is ₹1, unless it is everything that is left.', 400);
  }
  return paise;
}

type Prepared = { refundId: string; paymentId: string; businessId: string };

/** Transaction 1: lock the payment, validate, reserve the amount with a pending refund row (or find the one to resume). */
async function prepareRefund(req: RefundRequest): Promise<Prepared> {
  if (req.endPlan !== undefined && req.endPlan !== 'now' && req.endPlan !== 'period_end') {
    throw new PlatformRefundError('INVALID_REQUEST', 'Choose whether the plan ends now or at the end of the paid period.', 400);
  }
  const key = req.idempotencyKey?.trim() || null;
  if (key && key.length > 120) throw new PlatformRefundError('INVALID_REQUEST', 'The idempotency key is too long.', 400);
  return withClient(async (client) => {
    const payment = await loadPaymentForUpdate(client, req.transactionId);
    if (!payment || payment.business_id !== req.businessId) {
      throw new PlatformRefundError('NOT_FOUND', 'Payment not found.', 404);
    }
    if (payment.type !== 'payment') {
      throw new PlatformRefundError('NOT_REFUNDABLE', 'Only a payment can be refunded.', 409);
    }
    if (!GATEWAY_METHODS.has(payment.payment_method ?? '') && !MANUAL_METHODS.has(payment.payment_method ?? '')) {
      throw new PlatformRefundError(
        'NOT_REFUNDABLE',
        `A payment made by "${payment.payment_method ?? 'unknown method'}" cannot be refunded from here.`,
        409,
      );
    }

    const refundable = refundableAmountPaise(payment);
    const totals = await refundTotals(client, payment.id);

    // A repeat of a request (same caller key, or the same amount while one is pending) resumes the refund
    // already on file instead of making a second one.
    const wantPaise = req.amount === undefined ? refundable - totals.completed : Math.round(Number(req.amount) * 100);
    const existing = (
      await client.query<{ id: string; status: string; total_amount: string; idem: string | null }>(
        `SELECT id::text AS id, status, total_amount::text AS total_amount, metadata->>'idempotency_key' AS idem
         FROM billing_transactions
         WHERE type = 'refund' AND metadata->>'refund_of' = $1
           AND (status = 'pending' OR ($2::text IS NOT NULL AND metadata->>'idempotency_key' = $2))
         ORDER BY (metadata->>'idempotency_key' = $2::text) DESC NULLS LAST, created_at
         LIMIT 1`,
        [payment.id, key],
      )
    ).rows[0];
    if (existing) {
      if ((key !== null && existing.idem === key) || toPaise(existing.total_amount) === wantPaise) {
        return { refundId: existing.id, paymentId: payment.id, businessId: payment.business_id };
      }
      if (existing.status === 'pending') {
        throw new PlatformRefundError(
          'NOT_REFUNDABLE',
          `A refund of ${inr(toPaise(existing.total_amount))} on this payment is still being processed. Wait for it to finish, or repeat that same refund.`,
          409,
        );
      }
    }

    if (payment.status === 'refunded') {
      throw new PlatformRefundError('NOT_REFUNDABLE', 'This payment has already been refunded in full.', 409);
    }
    if (payment.status !== 'completed') {
      throw new PlatformRefundError('NOT_REFUNDABLE', `Only a completed payment can be refunded (this one is ${payment.status}).`, 409);
    }
    const remaining = refundable - totals.completed - totals.pending;
    if (refundable <= 0) {
      throw new PlatformRefundError(
        'NOT_REFUNDABLE',
        'Nothing was paid in cash on this payment (it was covered by a coupon or by upgrade credit), so there is no money to refund.',
        409,
      );
    }
    if (remaining <= 0) {
      throw new PlatformRefundError('NOT_REFUNDABLE', 'Everything that can be refunded on this payment has already been refunded.', 409);
    }
    if (GATEWAY_METHODS.has(payment.payment_method ?? '')) gatewayPaymentId(payment);
    const paise = validateAmount(req.amount, remaining);

    // Only the refund that brings the payment to fully refunded can change the plan, so only it needs the choice.
    const isFinal = totals.completed + totals.pending + paise >= refundable;
    if (isFinal && !req.endPlan) {
      throw new PlatformRefundError(
        'INVALID_REQUEST',
        'This refund returns everything that can be refunded on the payment. Choose whether the plan ends now or at the end of the paid period.',
        400,
      );
    }

    const refundId = randomUUID();
    await insertRefundRow(client, payment, {
      id: refundId,
      paise,
      reference: null,
      metadata: {
        end_plan: isFinal ? req.endPlan : null,
        requested_by_admin: req.adminId,
        notes: req.notes?.trim() || null,
        gateway_idempotency_key: gatewayRefundKey(refundId),
        source: 'admin',
        ...(key ? { idempotency_key: key } : {}),
      },
    });
    await syncRefundedPaise(client, payment);
    return { refundId, paymentId: payment.id, businessId: payment.business_id };
  });
}

type RefundContext = { refund: RefundRow; payment: PaymentRow };

async function loadContext(refundId: string): Promise<RefundContext | null> {
  const refund = await queryOne<RefundRow>(
    `SELECT ${PAYMENT_COLUMNS}, amount::text AS amount FROM billing_transactions WHERE id = $1 AND type = 'refund'`,
    [refundId],
  );
  if (!refund) return null;
  const payment = await queryOne<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} FROM billing_transactions WHERE id = $1`,
    [String(refund.metadata?.refund_of ?? '')],
  );
  return payment ? { refund, payment } : null;
}

type PlanEffect = { effect: string; detail?: Record<string, unknown> };
type AfterCommit = {
  events: { type: string; details: Record<string, unknown> }[];
  clearCacheFor: string | null;
  deferred: (() => Promise<void>)[];
};

type PlanDecision =
  | { kind: 'none'; effect: string }
  | { kind: 'free'; detail?: Record<string, unknown> }
  | { kind: 'cancel'; endDate: string | null }
  | { kind: 'shorten'; len: number; clampTomorrow: boolean; oldEnd: string; newEnd: string; keptForOthers: boolean };

type Queryable = Pick<PoolClient, 'query'>;

/**
 * What a FULL refund of this payment does to the plan, read-only (the finalize step runs it under the module lock
 * and then applies it; the admin billing list runs it to say what each choice would do).
 *
 *  - Only a payment for the plan the module is on can touch it.
 *  - "Other payments" are completed, un-refunded subscription payments for the same product AND the module's current
 *    plan, whose unused time was not taken as upgrade credit (`credit_consumed_by`). An upgraded-from payment is not
 *    one of them.
 *  - The current payment is the one covering today, or the last one bought (its period reaches the module's end date,
 *    so it also covers a lapsed row in grace). 'now': nothing else with days left means the plan moves to Free today
 *    (no grace); a later renewal still paid for means the end date is shortened by this payment's period instead.
 *    'period_end': the plan is set to end with its period (a lapsed row in grace ends at the next nightly run).
 *  - A wholly future renewal: the end date is shortened by its period (both choices).
 *  - An older payment: 'now' shortens the end date by its period; 'period_end' changes nothing.
 *  - The end date is only ever moved earlier. A shortened date that would land on or before today with nothing else
 *    covering today moves the plan to Free instead; with another payment covering today it is held at tomorrow.
 */
async function decidePlanEffect(
  client: Queryable,
  payment: PaymentRow,
  moduleKey: PlatformModule | null,
  endPlan: 'now' | 'period_end',
): Promise<PlanDecision> {
  if (!moduleKey || !payment.plan_id) return { kind: 'none', effect: 'none_no_plan' };
  if (((payment.gateway_response?.checkout_type as string | undefined) ?? 'subscription') !== 'subscription') {
    return { kind: 'none', effect: 'none_not_a_plan_payment' };
  }
  const bms = (
    await client.query<{ plan_id: string; status: string; end_date: string | null; cancel_at_period_end: boolean | null }>(
      `SELECT plan_id, status, end_date::text AS end_date, cancel_at_period_end
       FROM business_module_subscriptions WHERE business_id = $1 AND module_key = $2`,
      [payment.business_id, moduleKey],
    )
  ).rows[0];
  if (!bms || bms.plan_id !== payment.plan_id || bms.status !== 'active') return { kind: 'none', effect: 'none_plan_changed' };

  const othersSql = `FROM billing_transactions o
                      WHERE o.business_id = p.business_id AND COALESCE(o.module_key, $2) = $2 AND o.id <> p.id
                        AND o.plan_id = p.plan_id AND o.type = 'payment' AND o.status = 'completed'
                        AND COALESCE(o.gateway_response->>'checkout_type', 'subscription') = 'subscription'
                        AND (o.metadata->>'credit_consumed_by') IS NULL`;
  const c = (
    await client.query<{
      has_period: boolean;
      covers_today: boolean;
      is_future: boolean;
      is_last: boolean;
      len: number | null;
      other_covers_today: boolean;
      other_has_days_left: boolean;
      other_any: boolean;
    }>(
      `SELECT (p.period_start IS NOT NULL AND p.period_end IS NOT NULL AND p.period_end > p.period_start) AS has_period,
              COALESCE(p.period_start <= CURRENT_DATE AND p.period_end > CURRENT_DATE, false) AS covers_today,
              COALESCE(p.period_start > CURRENT_DATE, false) AS is_future,
              COALESCE(p.period_end >= $3::date, false) AS is_last,
              (p.period_end - p.period_start) AS len,
              EXISTS (SELECT 1 ${othersSql} AND o.period_start <= CURRENT_DATE AND o.period_end > CURRENT_DATE) AS other_covers_today,
              EXISTS (SELECT 1 ${othersSql} AND o.period_end > CURRENT_DATE) AS other_has_days_left,
              EXISTS (SELECT 1 ${othersSql}) AS other_any
       FROM billing_transactions p WHERE p.id = $1`,
      [payment.id, moduleKey, bms.end_date],
    )
  ).rows[0];

  // A payment with no recorded period (legacy) is taken to be the current one only when it is the only payment.
  if (!c.has_period && c.other_any) return { kind: 'none', effect: 'none_no_period' };
  const isCurrent = c.covers_today || (c.is_last && !c.is_future) || !c.has_period;

  const shorten = async (kept: boolean): Promise<PlanDecision> => {
    if (!c.has_period || !bms.end_date) return { kind: 'none', effect: 'none_no_period' };
    const r = (
      await client.query<{ new_end: string; past: boolean }>(
        `SELECT LEAST($1::date, GREATEST($1::date - $2::int, CASE WHEN $3::boolean THEN CURRENT_DATE + 1 ELSE CURRENT_DATE END))::text AS new_end,
                (LEAST($1::date, GREATEST($1::date - $2::int, CASE WHEN $3::boolean THEN CURRENT_DATE + 1 ELSE CURRENT_DATE END)) <= CURRENT_DATE) AS past`,
        [bms.end_date, c.len, c.other_covers_today],
      )
    ).rows[0];
    if (r.past && !c.other_covers_today) return { kind: 'free', detail: { days: c.len, old_end_date: bms.end_date } };
    return { kind: 'shorten', len: c.len as number, clampTomorrow: c.other_covers_today, oldEnd: bms.end_date, newEnd: r.new_end, keptForOthers: kept };
  };

  if (isCurrent) {
    if (endPlan === 'now') {
      if (!c.other_has_days_left) return { kind: 'free' };
      return shorten(true);
    }
    return { kind: 'cancel', endDate: bms.end_date };
  }
  if (c.is_future) return shorten(false);
  return endPlan === 'now' ? shorten(false) : { kind: 'none', effect: 'none_older_payment' };
}

function decisionToEffect(d: PlanDecision): PlanEffect {
  switch (d.kind) {
    case 'none':
      return { effect: d.effect };
    case 'free':
      return { effect: 'ended_now', detail: d.detail };
    case 'cancel':
      return { effect: 'cancel_at_period_end', detail: { end_date: d.endDate } };
    case 'shorten':
      return {
        effect: 'end_date_shortened',
        detail: { days: d.len, old_end_date: d.oldEnd, new_end_date: d.newEnd, kept_for_other_payments: d.keptForOthers },
      };
  }
}

/**
 * Runs the plan rule for a refund that brought the payment to fully refunded; a partial refund never changes the plan.
 * Inside the finalize transaction, after the module lock is held.
 */
async function applyPlanEffect(
  client: PoolClient,
  payment: PaymentRow,
  moduleKey: PlatformModule | null,
  p: { endPlan: 'now' | 'period_end' | null; requiresFull: boolean; fullyRefunded: boolean },
  after: AfterCommit,
): Promise<PlanEffect> {
  if (!p.fullyRefunded) return { effect: p.requiresFull ? 'none_partial_gateway_refund' : 'none_partial_refund' };
  if (!p.endPlan) return { effect: 'none_no_choice' };
  const d = await decidePlanEffect(client, payment, moduleKey, p.endPlan);
  if (!moduleKey || !payment.plan_id) return decisionToEffect(d);
  if (d.kind === 'free') {
    // The existing move-to-Free path, on this transaction (module lock and payment row lock still held, nothing left
    // half done if the commit fails). Its event, cache and bundle steps run after the commit. No grace follows.
    const moved = await moveModuleSubscriptionToFree(payment.business_id, moduleKey, payment.plan_id, 'refunded', undefined, {
      client,
      afterCommit: (fn) => after.deferred.push(fn),
    });
    return moved ? decisionToEffect(d) : { effect: 'none_plan_changed' };
  }
  if (d.kind === 'shorten') {
    const r = await client.query<{ end_date: string }>(
      `UPDATE business_module_subscriptions
       SET end_date = LEAST(end_date, GREATEST(end_date - $3::int, CASE WHEN $4::boolean THEN CURRENT_DATE + 1 ELSE CURRENT_DATE END)),
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND module_key = $2 AND plan_id = $5 AND status = 'active' AND end_date IS NOT NULL
       RETURNING end_date::text AS end_date`,
      [payment.business_id, moduleKey, d.len, d.clampTomorrow, payment.plan_id],
    );
    if (!r.rows[0]) return { effect: 'none_plan_changed' };
    after.events.push({
      type: 'refund_end_date_shortened',
      details: { module_key: moduleKey, transaction_id: payment.id, days: d.len, old_end_date: d.oldEnd, new_end_date: r.rows[0].end_date },
    });
    after.clearCacheFor = payment.business_id;
    return decisionToEffect({ ...d, newEnd: r.rows[0].end_date });
  }
  if (d.kind === 'cancel') {
    await client.query(
      `UPDATE business_module_subscriptions
       SET cancel_at_period_end = true, cancelled_at = COALESCE(cancelled_at, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND module_key = $2 AND plan_id = $3 AND status = 'active'`,
      [payment.business_id, moduleKey, payment.plan_id],
    );
    after.events.push({
      type: 'refund_cancel_scheduled',
      details: { module_key: moduleKey, transaction_id: payment.id, scheduled_date: d.endDate },
    });
    after.clearCacheFor = payment.business_id;
  }
  return decisionToEffect(d);
}

/** For the admin billing list: what refunding this payment IN FULL would do to the plan under each choice, in words. */
export async function previewFullRefundPlanEffects(paymentId: string): Promise<{ now: string; period_end: string } | null> {
  const payment = await queryOne<PaymentRow>(`SELECT ${PAYMENT_COLUMNS} FROM billing_transactions WHERE id = $1`, [paymentId]);
  if (!payment || payment.type !== 'payment') return null;
  const moduleKey: PlatformModule | null = payment.plan_id
    ? ((payment.module_key as PlatformModule | null) ?? (await resolveModuleKeyForPlan(payment.plan_id)))
    : null;
  const pool = getPool() as unknown as Queryable;
  const say = async (endPlan: 'now' | 'period_end') => {
    const e = decisionToEffect(await decidePlanEffect(pool, payment, moduleKey, endPlan));
    return planSentence({ planEffect: e.effect, planDetail: e.detail ?? null }, endPlan, 'admin', true);
  };
  return { now: await say('now'), period_end: await say('period_end') };
}

export type SettledRefund = {
  refundTransactionId: string;
  paymentId: string;
  businessId: string;
  status: 'completed' | 'failed' | 'pending';
  /** True when this call changed the row (false for a repeat of an already settled refund). */
  changed: boolean;
  refundedPaise: number;
  fullyRefunded: boolean;
  planEffect: string | null;
  planDetail?: Record<string, unknown> | null;
  failureReason?: string;
};

/**
 * Transaction 2 (success): mark the refund `completed`, mark the payment `refunded` when nothing more can be
 * refunded, apply the plan rule, flag coupon use, then (after commit) cancel partner commission.
 * Idempotent: a refund that is no longer `pending` is returned as it stands.
 */
export async function completePlatformRefund(refundId: string, providerRefundId: string | null): Promise<SettledRefund> {
  const ctx0 = await loadContext(refundId);
  if (!ctx0) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
  const moduleKey: PlatformModule | null = ctx0.payment.plan_id
    ? ((ctx0.payment.module_key as PlatformModule | null) ?? (await resolveModuleKeyForPlan(ctx0.payment.plan_id)))
    : null;
  const after: AfterCommit = { events: [], clearCacheFor: null, deferred: [] };

  const out = await withClient(async (client): Promise<SettledRefund> => {
    const payment = await loadPaymentForUpdate(client, ctx0.payment.id);
    if (!payment) throw new PlatformRefundError('NOT_FOUND', 'Payment not found.', 404);
    const refund = (
      await client.query<RefundRow>(
        `SELECT ${PAYMENT_COLUMNS}, amount::text AS amount FROM billing_transactions WHERE id = $1 AND type = 'refund' FOR UPDATE`,
        [refundId],
      )
    ).rows[0];
    if (!refund) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
    const refundable = refundableAmountPaise(payment);
    const base = {
      refundTransactionId: refund.id,
      paymentId: payment.id,
      businessId: payment.business_id,
    };
    if (refund.status !== 'pending') {
      const t = await refundTotals(client, payment.id);
      return {
        ...base,
        status: refund.status === 'completed' ? 'completed' : 'failed',
        changed: false,
        refundedPaise: t.completed,
        fullyRefunded: t.completed >= refundable && refundable > 0,
        planEffect: (refund.metadata?.plan_effect as string | undefined) ?? null,
        planDetail: (refund.metadata?.plan_effect_detail as Record<string, unknown> | null | undefined) ?? null,
      };
    }

    if (moduleKey) {
      await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`module_plan_change:${payment.business_id}:${moduleKey}`]);
    }

    assertBillingTransactionTransition('pending', 'completed');
    await client.query(
      `UPDATE billing_transactions
       SET status = 'completed',
           payment_reference = COALESCE($2, payment_reference),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'`,
      [refund.id, providerRefundId],
    );
    const totals = await syncRefundedPaise(client, payment);
    const fullyRefunded = refundable > 0 && totals.completed >= refundable;
    const reasons: string[] = [];
    if (totals.completed > refundable) reasons.push('refund_exceeds_refundable_amount');

    if (fullyRefunded && payment.status === 'completed') {
      assertBillingTransactionTransition('completed', 'refunded');
      await client.query(
        `UPDATE billing_transactions
         SET status = 'refunded',
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('refunded_at', CURRENT_TIMESTAMP::text),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'completed'`,
        [payment.id],
      );
    }

    // I3: when a payment that was bought with upgrade credit is fully refunded, the sources it consumed are released
    // (under the module lock, sources locked in id order after it), so what was taken from them can be refunded or
    // used as credit again where the normal source rules allow. A history entry stays on each source.
    let creditReleased: { id: string; paise: number }[] = [];
    if (fullyRefunded) {
      const srcs = (
        await client.query<{ id: string; used: string | null }>(
          `SELECT id::text AS id, metadata->>'credit_used_paise' AS used
           FROM billing_transactions
           WHERE business_id = $1 AND metadata->>'credit_consumed_by' = $2
           ORDER BY id FOR UPDATE`,
          [payment.business_id, payment.id],
        )
      ).rows;
      for (const src of srcs) {
        await client.query(
          `UPDATE billing_transactions
           SET metadata = (metadata - 'credit_consumed_by' - 'credit_used_paise')
                          || jsonb_build_object('credit_released_by', $2::text, 'credit_released_paise', COALESCE($3::bigint, 0),
                                                'credit_released_at', CURRENT_TIMESTAMP::text),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $1 AND metadata->>'credit_consumed_by' = $2`,
          [src.id, payment.id, src.used],
        );
        creditReleased.push({ id: src.id, paise: Number(src.used ?? 0) });
      }
    }

    const planChoice = refund.metadata?.end_plan === 'now' ? 'now' : refund.metadata?.end_plan === 'period_end' ? 'period_end' : null;
    const effect = await applyPlanEffect(
      client,
      payment,
      moduleKey,
      { endPlan: planChoice, requiresFull: refund.metadata?.end_plan_requires_full === true, fullyRefunded },
      after,
    );

    // Coupon: the redemption stays on record (never deleted). Flag it for a person to decide.
    let couponFlag: Record<string, unknown> | null = null;
    if (fullyRefunded && payment.coupon_id) {
      const red = (
        await client.query(
          `SELECT id::text AS id, coupon_id::text AS coupon_id, discount_amount::text AS discount_amount
           FROM coupon_redemptions WHERE billing_transaction_id = $1 LIMIT 1`,
          [payment.id],
        )
      ).rows[0];
      couponFlag = red ?? { coupon_id: payment.coupon_id, redemption_id: null };
      reasons.push('coupon_redemption_kept');
    }
    if (refund.metadata?.source === 'gateway_dashboard') reasons.push('refund_made_in_gateway_dashboard');
    if (effect.effect === 'none_partial_gateway_refund') reasons.push('partial_gateway_refund_plan_unchanged');

    await client.query(
      `UPDATE billing_transactions
       SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [
        refund.id,
        JSON.stringify({
          plan_effect: effect.effect,
          plan_effect_detail: effect.detail ?? null,
          fully_refunded: fullyRefunded,
          coupon_redemption: couponFlag,
          ...(creditReleased.length ? { credit_released: creditReleased } : {}),
          ...(reasons.length ? { needs_review: true, review_reasons: reasons } : {}),
        }),
      ],
    );
    // A credit-note number, only for a refund of a payment that carried GST (the mode stored on the rows).
    // Last statement before the commit: the counter row is the last lock taken. The payment's own prefix is
    // used, so the credit note reads like the invoice it undoes. A plain refund receipt has no number.
    if (isTaxedMode(refund.gst_mode ?? payment.gst_mode)) {
      await issueInvoiceNumber(
        client,
        refund.id,
        (payment.metadata?.tax as { invoice_prefix?: string } | undefined)?.invoice_prefix,
        'credit_note',
      );
    }
    return {
      ...base,
      status: 'completed',
      changed: true,
      refundedPaise: totals.completed,
      fullyRefunded,
      planEffect: effect.effect,
      planDetail: effect.detail ?? null,
    };
  });

  if (!out.changed) return out;
  if (after.clearCacheFor) {
    clearSubscriptionCache(after.clearCacheFor);
    clearModuleSubscriptionCache(after.clearCacheFor);
  }
  for (const fn of after.deferred) {
    await fn().catch((e) => console.error('[platform-refunds] follow-up step failed', e));
  }
  for (const ev of after.events) {
    await logSubscriptionEvent(out.businessId, ev.type, ev.details).catch((e) =>
      console.error('[platform-refunds] could not log', ev.type, e),
    );
  }
  await notifyRefundCompleted(out, toPaise(ctx0.refund.total_amount), ctx0.refund.metadata?.end_plan === 'now' ? 'now' : 'period_end');
  if (out.fullyRefunded) {
    try {
      const { cancelPartnerCommissionForRefund } = await import('@/lib/partners/commission');
      await cancelPartnerCommissionForRefund({ billingTransactionId: out.paymentId, reason: 'billing_transaction_refunded' });
    } catch (err) {
      console.error('[platform-refunds] partner commission cancel failed', err);
      await query(
        `UPDATE billing_transactions
         SET metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('needs_review', true,
                             'review_reasons', COALESCE(metadata->'review_reasons', '[]'::jsonb) || '"partner_commission_not_cancelled"'::jsonb)
         WHERE id = $1`,
        [out.refundTransactionId],
      ).catch(() => undefined);
    }
  }
  return out;
}

/** Transaction 2 (refusal): the refund row becomes `failed`; the payment and the plan are untouched. */
export async function failPlatformRefund(refundId: string, reason: string): Promise<SettledRefund> {
  const ctx0 = await loadContext(refundId);
  if (!ctx0) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
  return withClient(async (client): Promise<SettledRefund> => {
    const payment = await loadPaymentForUpdate(client, ctx0.payment.id);
    if (!payment) throw new PlatformRefundError('NOT_FOUND', 'Payment not found.', 404);
    const refund = (
      await client.query<RefundRow>(
        `SELECT ${PAYMENT_COLUMNS}, amount::text AS amount FROM billing_transactions WHERE id = $1 AND type = 'refund' FOR UPDATE`,
        [refundId],
      )
    ).rows[0];
    if (!refund) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
    const refundable = refundableAmountPaise(payment);
    let changed = false;
    if (refund.status === 'pending') {
      assertBillingTransactionTransition('pending', 'failed');
      await client.query(
        `UPDATE billing_transactions
         SET status = 'failed',
             metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', $2::text),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $1 AND status = 'pending'`,
        [refund.id, reason.slice(0, 500)],
      );
      changed = true;
    } else if (refund.status === 'completed') {
      // The gateway now says a refund we recorded as done failed: the money may not have gone back. A person must look.
      await client.query(
        `UPDATE billing_transactions
         SET metadata = COALESCE(metadata, '{}'::jsonb)
                        || jsonb_build_object('needs_review', true, 'gateway_failure', $2::text,
                             'review_reasons', COALESCE(metadata->'review_reasons', '[]'::jsonb) || '"gateway_reported_failure_after_completion"'::jsonb)
         WHERE id = $1`,
        [refund.id, reason.slice(0, 500)],
      );
    }
    const t = await syncRefundedPaise(client, payment);
    return {
      refundTransactionId: refund.id,
      paymentId: payment.id,
      businessId: payment.business_id,
      status: refund.status === 'pending' ? 'failed' : refund.status === 'completed' ? 'completed' : 'failed',
      changed,
      refundedPaise: t.completed,
      fullyRefunded: refundable > 0 && t.completed >= refundable,
      planEffect: null,
      failureReason: reason,
    };
  });
}

type GatewayAnswer = { providerRefundId: string; status: 'processed' | 'pending' | 'failed' };
type GatewayLookup = { kind: 'found'; answer: GatewayAnswer } | { kind: 'none' };

function gatewayKeyOf(refund: RefundRow): string {
  return String(refund.metadata?.gateway_idempotency_key ?? gatewayRefundKey(refund.id));
}

/**
 * Asks the gateway whether it already has this refund. `none` only when the gateway answered and has no such
 * refund; it throws when it cannot answer (never read as "no refund"). Easebuzz: by our merchant_refund_id.
 * Razorpay: by the refund id when we hold it, else by listing the payment's refunds and matching our amount
 * (skipping refunds already recorded on other rows).
 */
async function lookupGatewayRefund(ctx: RefundContext): Promise<GatewayLookup> {
  const { refund, payment } = ctx;
  if (payment.payment_method === 'razorpay') {
    const provider = await getPlatformRazorpayProvider();
    if (!provider) throw new Error('Razorpay is not set up');
    const providerPaymentId = gatewayPaymentId(payment);
    if (refund.payment_reference) {
      const r = await provider.fetchRefund({ providerPaymentId, providerRefundId: refund.payment_reference });
      return { kind: 'found', answer: { providerRefundId: refund.payment_reference, status: r.status } };
    }
    const taken = new Set(
      (
        await query<{ payment_reference: string }>(
          `SELECT payment_reference FROM billing_transactions
           WHERE type = 'refund' AND metadata->>'refund_of' = $1 AND id <> $2 AND payment_reference IS NOT NULL`,
          [payment.id, refund.id],
        )
      ).rows.map((r) => r.payment_reference),
    );
    const paise = toPaise(refund.total_amount);
    const mine = (await provider.fetchPaymentRefunds(providerPaymentId)).filter((r) => r.amountPaise === paise && !taken.has(r.id));
    const pick = mine.find((r) => r.status !== 'failed') ?? mine[0];
    return pick ? { kind: 'found', answer: { providerRefundId: pick.id, status: pick.status } } : { kind: 'none' };
  }
  const provider = await getPlatformEasebuzzProvider();
  if (!provider) throw new Error('Easebuzz is not set up');
  const found = await provider.fetchRefundStatus(gatewayPaymentId(payment), gatewayKeyOf(refund));
  return found ? { kind: 'found', answer: { providerRefundId: found.providerRefundId, status: found.status } } : { kind: 'none' };
}

/**
 * Raises the refund at the gateway. Razorpay: the same X-Refund-Idempotency key on every call makes Razorpay return the
 * refund it already made, but only inside Razorpay's idempotency retention window (limited; see the Razorpay docs), so a
 * retry of an attempt that was already made always looks the payment's refunds up first (see runClaimed) instead of
 * relying on the key alone. Easebuzz has no such header: our merchant_refund_id is the guard, and a duplicate-id
 * refusal means "already exists".
 */
async function sendRefundToGateway(ctx: RefundContext): Promise<GatewayAnswer> {
  const { refund, payment } = ctx;
  const key = gatewayKeyOf(refund);
  const paise = toPaise(refund.total_amount);
  if (payment.payment_method === 'razorpay') {
    const provider = await getPlatformRazorpayProvider();
    if (!provider) throw new GatewayRefundError('Razorpay is not set up on this platform, so no refund was sent.', null, true);
    return provider.refundCapturedPayment({ providerPaymentId: gatewayPaymentId(payment), amountPaise: paise, idempotencyKey: key });
  }
  const provider = await getPlatformEasebuzzProvider();
  if (!provider) throw new GatewayRefundError('Easebuzz is not set up on this platform, so no refund was sent.', null, true);
  return provider.refundPayment({ easebuzzId: gatewayPaymentId(payment), amountPaise: paise, merchantRefundId: key });
}

/**
 * Atomically claims the right to talk to the gateway about this refund. Only the caller that gets `claimed: true`
 * may call the gateway; everyone else reports the current state. `wasAttempted` is true when an earlier claim existed
 * (so a request may already have reached the gateway). A claim that was never released (a crash) is taken over after
 * CLAIM_STALE_MINUTES.
 */
async function claimGatewayAttempt(refundId: string): Promise<{ claimed: boolean; wasAttempted: boolean }> {
  return withClient(async (client) => {
    const r = (
      await client.query<{ status: string; attempted: boolean; busy: boolean }>(
        `SELECT status,
                (metadata->>'gateway_requested') IS NOT NULL AS attempted,
                COALESCE((metadata->>'gateway_in_flight_since')::timestamptz > CURRENT_TIMESTAMP - make_interval(mins => $2), false) AS busy
         FROM billing_transactions WHERE id = $1 AND type = 'refund' FOR UPDATE`,
        [refundId, CLAIM_STALE_MINUTES],
      )
    ).rows[0];
    if (!r || r.status !== 'pending' || r.busy) return { claimed: false, wasAttempted: !!r?.attempted };
    await client.query(
      `UPDATE billing_transactions
       SET metadata = COALESCE(metadata, '{}'::jsonb)
                      || jsonb_build_object('gateway_requested', true, 'gateway_in_flight_since', CURRENT_TIMESTAMP::text),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending'`,
      [refundId],
    );
    return { claimed: true, wasAttempted: r.attempted };
  });
}

async function releaseGatewayClaim(refundId: string) {
  await query(
    `UPDATE billing_transactions SET metadata = metadata - 'gateway_in_flight_since', updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND metadata ? 'gateway_in_flight_since'`,
    [refundId],
  ).catch((e) => console.error('[platform-refunds] could not release gateway claim', e));
}

function resultOf(s: SettledRefund, status: 'processed' | 'pending', message: string): RefundResult {
  return {
    refundTransactionId: s.refundTransactionId,
    status,
    refundedTotal: rupees(s.refundedPaise),
    fullyRefunded: s.fullyRefunded,
    message,
  };
}

/** What happened (or, with `preview`, would happen) to the plan, in words. `who` picks "their"/"your". */
function planSentence(
  s: Pick<SettledRefund, 'planEffect' | 'planDetail'>,
  endPlan: string,
  who: 'admin' | 'customer',
  preview = false,
): string {
  const their = who === 'admin' ? 'Their' : 'Your';
  const d = (s.planDetail ?? {}) as Record<string, unknown>;
  switch (s.planEffect) {
    case 'ended_now':
      if (preview) return 'The customer moves to the free plan today, with no grace period, and loses paid features straight away.';
      return who === 'admin'
        ? 'Their plan has ended today and they are now on the free plan, with no grace period.'
        : 'Your plan has ended today and you are now on the free plan.';
    case 'cancel_at_period_end':
      if (preview) {
        return d.end_date
          ? `The customer keeps their plan until ${d.end_date} and it is not renewed after that.`
          : 'The customer keeps their plan until the end of the period they paid for and it is not renewed after that.';
      }
      return `${their} plan stays until ${d.end_date ? `its end date, ${d.end_date}` : 'the end of the paid period'} and then ends.`;
    case 'end_date_shortened': {
      const grace = ` The usual ${GRACE_DAYS} days of grace then apply.`;
      if (preview) {
        return d.kept_for_other_payments
          ? `The plan cannot end today because a later renewal payment is not refunded. The refunded payment's ${d.days} days are taken off the end instead: the plan will end on ${d.new_end_date}.${grace}`
          : `The refunded payment's ${d.days} days are taken off the end of the paid period: the plan will end on ${d.new_end_date}.${grace}`;
      }
      return d.kept_for_other_payments
        ? `The plan did not end today because a later renewal payment was not refunded. The refunded payment's ${d.days} days were taken off the end instead: the plan now ends on ${d.new_end_date}.${grace}`
        : `The refunded payment's ${d.days} days were taken off the end of the paid period: the plan now ends on ${d.new_end_date}.${grace}`;
    }
    case 'none_partial_refund':
      return who === 'admin' ? 'Partial refund. The plan is unchanged.' : 'Your plan is unchanged.';
    case 'none_partial_gateway_refund':
      return `${their} plan was not changed (only part of the payment was refunded).`;
    case 'none_no_period':
      return `${their} plan was not changed: this payment has no recorded period and other payments exist, so Khatario could not tell which days it paid for.`;
    case 'none_older_payment':
      return `${their} plan is not changed: this payment covered a period that has already passed.`;
    case 'none_plan_changed':
      return `${their} plan was not changed because this payment is not for the plan the customer is on now.`;
    default:
      return endPlan === 'now'
        ? `${their} plan was not changed because this payment does not cover the current plan.`
        : `${their} plan was not changed.`;
  }
}

function successMessage(s: SettledRefund, paise: number, endPlan: string): string {
  return `${inr(paise)} has been refunded to the customer. ${planSentence(s, endPlan, 'admin')}`;
}

/** Email and in-app (subscription event, shown in billing history) notice of a completed refund. Never throws. */
async function notifyRefundCompleted(s: SettledRefund, paise: number, endPlan: string): Promise<void> {
  try {
    const row = await queryOne<{ plan_name: string | null; paid_on: string | null }>(
      `SELECT sp.display_name AS plan_name, to_char(p.created_at, 'DD Mon YYYY') AS paid_on
       FROM billing_transactions p LEFT JOIN subscription_plans sp ON sp.id = p.plan_id WHERE p.id = $1`,
      [s.paymentId],
    );
    const text = `We have refunded ${inr(paise)} for your ${row?.plan_name ?? 'Khatario'} payment${row?.paid_on ? ` of ${row.paid_on}` : ''}. ${planSentence(s, endPlan, 'customer')}`;
    await logSubscriptionEvent(s.businessId, 'refund_completed', {
      transaction_id: s.refundTransactionId,
      payment_id: s.paymentId,
      amount: rupees(paise),
      message: text,
    });
    const recipient = await getBusinessPlatformRecipient(s.businessId);
    if (recipient?.email) {
      await sendPlatformEmail({
        to: recipient.email,
        subject: 'Your Khatario refund',
        html: `<p>${escapeHtml(text)}</p>`,
        text,
        templateKey: 'subscription_lifecycle',
        businessId: s.businessId,
        metadata: { refund_id: s.refundTransactionId },
      });
    }
  } catch (err) {
    console.error('[platform-refunds] refund notice failed', err);
  }
}

/** Reads the refund row as it is now, so a result is never staler than the database (a webhook may have settled it). */
async function stateResult(refundId: string, pendingMessage: string): Promise<RefundResult> {
  const ctx = await loadContext(refundId);
  if (!ctx) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
  const paise = toPaise(ctx.refund.total_amount);
  const endPlan = String(ctx.refund.metadata?.end_plan ?? 'period_end');
  if (ctx.refund.status === 'completed') {
    const s = await completePlatformRefund(refundId, null);
    return resultOf(s, 'processed', successMessage(s, paise, endPlan));
  }
  if (ctx.refund.status === 'failed') {
    throw new PlatformRefundError(
      'GATEWAY_REFUSED',
      `${String(ctx.refund.metadata?.failure_reason ?? 'The payment gateway refused this refund.')} No money was returned and the plan was not changed.`,
      502,
    );
  }
  const t = await refundTotals(getPool() as unknown as Pick<PoolClient, 'query'>, ctx.payment.id);
  return {
    refundTransactionId: refundId,
    status: 'pending',
    refundedTotal: rupees(t.completed),
    fullyRefunded: false,
    message: pendingMessage,
  };
}

const MSG_IN_PROGRESS =
  'A refund for this payment is already in progress, so nothing new was sent. Check again in a moment; the customer\'s plan changes once the gateway confirms it.';
const MSG_UNKNOWN =
  'The payment gateway did not give a clear answer, so the refund is still pending and the customer\'s plan has not been changed. Repeat the same refund to check again; it will not be refunded twice.';
const MSG_ACCEPTED =
  'The payment gateway has accepted the refund and will return the money shortly. The customer\'s plan changes once the gateway confirms it.';

/** The gateway part, run only by the caller that holds the claim. */
async function runClaimed(refundId: string, wasAttempted: boolean, lookupOnly: boolean): Promise<RefundResult> {
  const ctx = await loadContext(refundId); // fresh: a webhook may have adopted the row since
  if (!ctx) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
  if (ctx.refund.status !== 'pending') return stateResult(refundId, MSG_IN_PROGRESS);
  const paise = toPaise(ctx.refund.total_amount);
  const endPlan = String(ctx.refund.metadata?.end_plan ?? 'period_end');

  let answer: GatewayAnswer | null = null;
  let refusal: GatewayRefundError | null = null;
  try {
    // An attempt may already have reached the gateway: ask first, so a retry never raises a second refund.
    if (wasAttempted || ctx.refund.payment_reference) {
      const l = await lookupGatewayRefund(ctx);
      if (l.kind === 'found') answer = l.answer;
    }
    // The unattended nightly check only asks; raising a refund stays with an admin's click.
    if (!answer && lookupOnly) return stateResult(refundId, MSG_UNKNOWN);
    if (!answer) answer = await sendRefundToGateway(ctx);
  } catch (err) {
    if (err instanceof PlatformRefundError) throw err;
    if (err instanceof GatewayRefundError) refusal = err;
    else {
      console.error('[platform-refunds] gateway answer unknown, refund left pending', refundId, err instanceof Error ? err.message : err);
      return stateResult(refundId, MSG_UNKNOWN);
    }
  }

  if (!answer && refusal) {
    // An error reply is not proof that no refund exists (a duplicate refund id, an expired idempotency window):
    // ask the gateway. Only "no such refund" together with a definite refusal fails the row.
    let l: GatewayLookup;
    try {
      l = await lookupGatewayRefund(ctx);
    } catch (err) {
      console.error('[platform-refunds] refund status lookup failed, refund left pending', refundId, err instanceof Error ? err.message : err);
      return stateResult(refundId, MSG_UNKNOWN);
    }
    if (l.kind === 'found') answer = l.answer;
    else if (refusal.definite) {
      await failPlatformRefund(refundId, refusal.message);
      throw new PlatformRefundError(
        'GATEWAY_REFUSED',
        `${refusal.message}. No money was returned and the customer's plan was not changed.`,
        502,
      );
    } else {
      return stateResult(refundId, MSG_UNKNOWN);
    }
  }
  if (!answer) return stateResult(refundId, MSG_UNKNOWN);

  if (answer.status === 'failed') {
    await failPlatformRefund(refundId, 'The payment gateway could not complete this refund.');
    throw new PlatformRefundError(
      'GATEWAY_REFUSED',
      'The payment gateway could not complete this refund. No money was returned and the customer\'s plan was not changed.',
      502,
    );
  }
  if (answer.status === 'processed') {
    const s = await completePlatformRefund(refundId, answer.providerRefundId);
    return resultOf(s, 'processed', successMessage(s, paise, endPlan));
  }
  // Accepted but not settled yet: remember the gateway's refund id; the gateway's webhook or a later check settles it.
  await query(
    `UPDATE billing_transactions
     SET payment_reference = COALESCE(payment_reference, $2),
         metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('gateway_status', 'pending'),
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $1 AND status = 'pending'`,
    [refundId, answer.providerRefundId],
  );
  return stateResult(refundId, MSG_ACCEPTED);
}

/** Runs the gateway step for a pending refund row and records the outcome. Safe to call again for the same row. */
async function driveRefund(refundId: string, lookupOnly = false): Promise<RefundResult> {
  const ctx = await loadContext(refundId);
  if (!ctx) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
  const paise = toPaise(ctx.refund.total_amount);
  const endPlan = String(ctx.refund.metadata?.end_plan ?? 'period_end');
  const method = ctx.payment.payment_method ?? '';

  if (ctx.refund.status !== 'pending') return stateResult(refundId, MSG_IN_PROGRESS);

  if (!GATEWAY_METHODS.has(method)) {
    if (!MANUAL_METHODS.has(method)) {
      throw new PlatformRefundError('NOT_REFUNDABLE', `A payment made by "${method || 'unknown method'}" cannot be refunded from here.`, 409);
    }
    // A manual payment (bank transfer, cash): there is no gateway to call.
    const s = await completePlatformRefund(refundId, null);
    return resultOf(s, 'processed', `${successMessage(s, paise, endPlan)} No gateway was involved, so the money has to be returned outside Khatario.`);
  }

  // No credentials: nothing could be sent, so this is a plain refusal (checked before claiming).
  const configured = method === 'razorpay' ? await getPlatformRazorpayProvider() : await getPlatformEasebuzzProvider();
  if (!configured && !ctx.refund.metadata?.gateway_requested) {
    const why = `${method === 'razorpay' ? 'Razorpay' : 'Easebuzz'} is not set up on this platform, so no refund was sent`;
    await failPlatformRefund(refundId, why);
    throw new PlatformRefundError('GATEWAY_REFUSED', `${why}. No money was returned and the customer's plan was not changed.`, 502);
  }

  const claim = await claimGatewayAttempt(refundId);
  if (!claim.claimed) return stateResult(refundId, MSG_IN_PROGRESS);
  try {
    return await runClaimed(refundId, claim.wasAttempted, lookupOnly);
  } finally {
    await releaseGatewayClaim(refundId);
  }
}

/**
 * Admin action: abandon a refund that never reached the gateway (no attempt was ever claimed), for example after a crash
 * between reserving it and sending it. Frees the reserved amount. Refuses a refund the gateway may know about.
 */
export async function cancelUnsentPlatformRefund(refundId: string, adminId: string): Promise<{ refundTransactionId: string }> {
  const ctx0 = await loadContext(refundId);
  if (!ctx0) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
  await withClient(async (client) => {
    const payment = await loadPaymentForUpdate(client, ctx0.payment.id);
    const refund = (
      await client.query<RefundRow>(
        `SELECT ${PAYMENT_COLUMNS}, amount::text AS amount FROM billing_transactions WHERE id = $1 AND type = 'refund' FOR UPDATE`,
        [refundId],
      )
    ).rows[0];
    if (!payment || !refund) throw new PlatformRefundError('NOT_FOUND', 'Refund not found.', 404);
    if (refund.status !== 'pending') {
      throw new PlatformRefundError('NOT_REFUNDABLE', `This refund is already ${refund.status}, so it cannot be cancelled.`, 409);
    }
    if (refund.metadata?.gateway_requested || refund.payment_reference) {
      throw new PlatformRefundError(
        'NOT_REFUNDABLE',
        'This refund was already sent to the payment gateway, so it cannot be cancelled here. Repeat the same refund to check where it stands.',
        409,
      );
    }
    assertBillingTransactionTransition('pending', 'failed');
    await client.query(
      `UPDATE billing_transactions
       SET status = 'failed',
           metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('failure_reason', 'Cancelled by an admin before it was sent', 'cancelled_by_admin', $2::text),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND status = 'pending' AND (metadata->>'gateway_requested') IS NULL`,
      [refund.id, adminId],
    );
    await syncRefundedPaise(client, payment);
  });
  return { refundTransactionId: refundId };
}

/**
 * Nightly job step: refunds the gateway was asked for (an attempt was claimed) that are still `pending` after an hour are
 * checked with the gateway (Easebuzz has no webhook). Bounded batch. Never sends a refund that was never attempted.
 * Returns how many were settled (completed or failed).
 */
export async function settleStalePendingPlatformRefunds(limit = 20): Promise<number> {
  const rows = (
    await query<{ id: string }>(
      `SELECT id::text AS id FROM billing_transactions
       WHERE type = 'refund' AND status = 'pending'
         AND payment_method IN ('razorpay', 'easebuzz')
         AND (metadata->>'gateway_requested') IS NOT NULL
         AND created_at < CURRENT_TIMESTAMP - INTERVAL '1 hour'
       ORDER BY created_at
       LIMIT $1`,
      [Math.max(1, Math.min(100, Math.floor(limit)))],
    )
  ).rows;
  let settled = 0;
  for (const r of rows) {
    try {
      const res = await driveRefund(r.id, true);
      if (res.status === 'processed') settled++;
    } catch (err) {
      if (err instanceof PlatformRefundError && err.code === 'GATEWAY_REFUSED') settled++; // marked failed
      else console.error('[platform-refunds] nightly refund check failed', r.id, err instanceof Error ? err.message : err);
    }
  }
  return settled;
}

/**
 * Refund (all or part of) one subscription payment through its gateway and apply the plan choice.
 * Throws PlatformRefundError (NOT_REFUNDABLE, REFUND_EXCEEDS_PAYMENT, GATEWAY_REFUSED, ...). A timeout is not an
 * error: the result has status 'pending'.
 */
export async function refundPlatformPayment(req: RefundRequest): Promise<RefundResult> {
  const prepared = await prepareRefund(req);
  return driveRefund(prepared.refundId);
}

/** Re-checks a pending refund with the gateway (used by retries and the reconcile job). */
export async function settlePlatformRefund(refundId: string): Promise<RefundResult> {
  return driveRefund(refundId);
}

// ---------------------------------------------------------------------------------------------
// Gateway webhooks
// ---------------------------------------------------------------------------------------------

export type GatewayRefundNotice = {
  event: string;
  providerRefundId: string | null;
  providerPaymentId: string | null;
  amountInr: number | null;
};

export type RefundNoticeOutcome = {
  outcome: 'processed' | 'pending' | 'failed' | 'ignored';
  note: string;
  businessId: string | null;
  billingTransactionId: string | null;
};

/**
 * A Razorpay refund event on the platform account. Finds our refund row by the gateway refund id (or, for a
 * request whose reply was lost, adopts the one pending row with that payment and amount); a refund made in the
 * Razorpay dashboard gets a new row. Never activates or changes a plan except through the refund's own plan rule:
 * a dashboard refund leaves the plan until period end (only when it refunds the whole payment) and is flagged.
 */
export async function applyRazorpayRefundNotice(n: GatewayRefundNotice): Promise<RefundNoticeOutcome> {
  const ignored = (note: string, businessId: string | null = null): RefundNoticeOutcome => ({
    outcome: 'ignored', note, businessId, billingTransactionId: null,
  });
  if (!n.providerRefundId || !n.providerPaymentId) return ignored('Refund event without a refund id or payment id');
  if (n.event !== 'refund.created' && n.event !== 'refund.processed' && n.event !== 'refund.failed') {
    return ignored(`Refund event ${n.event} needs no action`);
  }

  const payment = await queryOne<PaymentRow>(
    `SELECT ${PAYMENT_COLUMNS} FROM billing_transactions
     WHERE type = 'payment' AND payment_method = 'razorpay' AND payment_reference = $1 AND status IN ('completed', 'refunded')
     LIMIT 1`,
    [n.providerPaymentId],
  );
  if (!payment) return ignored('The refunded payment is not a subscription payment on record');
  const base = { businessId: payment.business_id };

  let refundId = (
    await queryOne<{ id: string }>(
      `SELECT id::text AS id FROM billing_transactions
       WHERE type = 'refund' AND payment_method = 'razorpay' AND payment_reference = $1 AND status <> 'failed'
       ORDER BY created_at LIMIT 1`,
      [n.providerRefundId],
    )
  )?.id;

  if (!refundId) {
    refundId = await withClient(async (client) => {
      const locked = await loadPaymentForUpdate(client, payment.id);
      if (!locked) return undefined;
      const again = (
        await client.query<{ id: string }>(
          `SELECT id::text AS id FROM billing_transactions
           WHERE type = 'refund' AND payment_method = 'razorpay' AND payment_reference = $1 AND status <> 'failed' LIMIT 1`,
          [n.providerRefundId],
        )
      ).rows[0];
      if (again) return again.id;

      // Our own request whose reply never arrived: same payment, same amount, no gateway id yet.
      const paise = n.amountInr === null ? null : Math.round(n.amountInr * 100);
      if (paise !== null) {
        const mine = (
          await client.query<{ id: string }>(
            `SELECT id::text AS id FROM billing_transactions
             WHERE type = 'refund' AND status = 'pending' AND payment_reference IS NULL
               AND metadata->>'refund_of' = $1 AND round(total_amount * 100) = $2
             ORDER BY created_at LIMIT 1 FOR UPDATE`,
            [payment.id, paise],
          )
        ).rows[0];
        if (mine) {
          await client.query(
            `UPDATE billing_transactions SET payment_reference = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [mine.id, n.providerRefundId],
          );
          return mine.id;
        }
      }
      if (n.event === 'refund.failed') return undefined; // a failed refund nobody here asked for needs no record
      if (paise === null || paise <= 0) {
        throw new PlatformRefundError('INVALID_REQUEST', 'Refund event without an amount', 400);
      }

      // A refund started in the Razorpay dashboard: record it so the books match the gateway.
      const id = randomUUID();
      const refundable = refundableAmountPaise(locked);
      const totals = await refundTotals(client, payment.id);
      await insertRefundRow(client, locked, {
        id,
        paise,
        reference: n.providerRefundId,
        metadata: {
          end_plan: 'period_end',
          end_plan_requires_full: true,
          source: 'gateway_dashboard',
          gateway_idempotency_key: null,
          ...(totals.completed + totals.pending + paise > refundable ? { exceeds_refundable: true } : {}),
        },
      });
      await syncRefundedPaise(client, locked);
      return id;
    });
  }

  if (!refundId) return { outcome: 'ignored', note: 'Refund failed at the gateway; nothing recorded here', ...base, billingTransactionId: null };

  if (n.event === 'refund.processed') {
    const s = await completePlatformRefund(refundId, n.providerRefundId);
    return {
      outcome: 'processed',
      note: s.changed ? `Refund settled (plan effect: ${s.planEffect ?? 'none'})` : 'Refund was already settled',
      ...base,
      billingTransactionId: refundId,
    };
  }
  if (n.event === 'refund.failed') {
    const s = await failPlatformRefund(refundId, 'Razorpay could not complete this refund.');
    return {
      outcome: 'failed',
      note: s.changed ? 'Refund failed at the gateway; plan untouched' : 'Refund was not pending; flagged for review if it had completed',
      ...base,
      billingTransactionId: refundId,
    };
  }
  return { outcome: 'pending', note: 'Refund created at the gateway', ...base, billingTransactionId: refundId };
}
