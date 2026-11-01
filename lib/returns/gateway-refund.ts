import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { round2 } from '@/lib/accounting/voucher-posting';
import { listCashBankAccounts } from '@/lib/accounting/contra';
import { CreditNoteRefundError, refundCreditNote, refundableOnCreditNote } from '@/lib/credit-notes/refund';
import { getBusinessPaymentProviderConfig } from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';
import { easebuzzRefundRequester, razorpayRefundRequester } from '@/lib/store/store-refund';
import { recordReturnEvent } from './events';
import { lockReturn, ReturnError } from './service';

/**
 * Refund a received return to the card / UPI the customer paid the store order with (Razorpay or
 * Easebuzz), in part or in full, and post it against the return's credit note.
 *
 *   claim   (own transaction, committed)  -> return_gateway_refunds row `pending`, key = row id
 *   gateway (no transaction)              -> refund asked for with that key, amount in paise
 *   apply   (transaction)                 -> processed: credit-note refund (mode `gateway`) to the bank
 *                                            account the payment settled in; pending: wait for the
 *                                            Razorpay notice or checkPendingReturnRefunds; failed: kept
 *                                            with its reason, a retry makes a new attempt
 *
 * Locks are always taken return -> store order -> refund row, so the claim, a webhook and the
 * pending check serialise per order and two clicks cannot both claim room beyond the cap.
 * Order cancellations use store_payment_refunds (lib/store/store-refund.ts), never this table.
 */

export type GatewayRequester = (args: {
  providerPaymentId: string;
  amountPaise: number;
  idempotencyKey: string;
}) => Promise<{ providerRefundId: string; status: 'processed' | 'pending' }>;

type Db = Pick<PoolClient, 'query'>;
type Provider = 'razorpay' | 'easebuzz';

export type OriginalRefundRoom = {
  allowed: boolean;
  max: number;
  provider: Provider | null;
  reason: string | null;
};

function today(): string {
  // Business dates are Indian calendar days.
  return new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
}

function inr(n: number): string {
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Older orders have no provider saved and were Razorpay; anything else is not a gateway we refund through. */
function onlineProvider(value: string | null): Provider | null {
  if (value === 'easebuzz') return 'easebuzz';
  if (value === 'razorpay' || value == null) return 'razorpay';
  return null;
}

/**
 * How much of this return can go back to the original payment: the smaller of what is left on the
 * credit note (less this return's refund already on its way) and what is left of the online payment
 * after cancellation refunds and other return refunds (pending or processed).
 */
export async function originalRefundRoom(client: Db, businessId: string, returnId: string): Promise<OriginalRefundRoom> {
  const r = await client.query<{
    status: string;
    credit_note_id: string | null;
    store_order_id: string | null;
    provider_payment_id: string | null;
    receipt_payment_id: string | null;
    payment_provider: string | null;
    grand_total: string | null;
  }>(
    `SELECT r.status, r.credit_note_id, r.store_order_id,
            o.provider_payment_id, o.receipt_payment_id, o.payment_provider, o.grand_total::text
       FROM order_returns r
       LEFT JOIN store_orders o ON o.id = r.store_order_id AND o.business_id = r.business_id
      WHERE r.id = $1 AND r.business_id = $2`,
    [returnId, businessId],
  );
  const row = r.rows[0];
  const no = (reason: string, provider: Provider | null = null): OriginalRefundRoom => ({ allowed: false, max: 0, provider, reason });
  if (!row) return no('Return not found');
  const provider = row.provider_payment_id ? onlineProvider(row.payment_provider) : null;
  if (!row.store_order_id || !row.provider_payment_id || !row.receipt_payment_id || !provider) {
    return no('This order was not paid online');
  }
  if (row.status !== 'received') {
    return no(row.status === 'closed' ? 'This return is already settled' : 'Receive the goods before refunding', provider);
  }
  if (!row.credit_note_id) return no('This return has no credit note', provider);

  const note = await refundableOnCreditNote(client as PoolClient, businessId, row.credit_note_id);
  const sums = await client.query<{ this_pending: string; order_refunds: string; cancel_refunds: string }>(
    `SELECT
       COALESCE(SUM(g.amount) FILTER (WHERE g.order_return_id = $3 AND g.status = 'pending'), 0)::text AS this_pending,
       COALESCE(SUM(g.amount) FILTER (WHERE g.status IN ('pending', 'processed')), 0)::text AS order_refunds,
       (SELECT COALESCE(SUM(s.amount), 0) FROM store_payment_refunds s
         WHERE s.order_id = $1 AND s.business_id = $2 AND s.status <> 'failed')::text AS cancel_refunds
       FROM return_gateway_refunds g
      WHERE g.store_order_id = $1 AND g.business_id = $2`,
    [row.store_order_id, businessId, returnId],
  );
  const s = sums.rows[0];
  const onNote = round2((note?.refundable ?? 0) - Number(s.this_pending));
  const online = round2((Number(row.grand_total) || 0) - Number(s.cancel_refunds) - Number(s.order_refunds));
  const max = Math.max(0, round2(Math.min(onNote, online)));
  if (max <= 0.004) return no('Nothing is left to refund to the original payment', provider);
  return { allowed: true, max, provider, reason: null };
}

type Claim = {
  rowId: string;
  idempotencyKey: string;
  amount: number;
  provider: Provider;
  providerPaymentId: string;
};

/** Amount from the screen: number, numeric string, or null / empty for the most that can go back. */
function parseAmount(raw: number | string | null | undefined): number | null {
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) return null;
  const n = typeof raw === 'number' ? raw : Number(raw.trim());
  if (!Number.isFinite(n) || round2(n) <= 0) {
    throw new ReturnError(400, 'INVALID_AMOUNT', 'Refund amount must be greater than zero');
  }
  return round2(n);
}

async function claimGatewayRefund(input: {
  businessId: string;
  returnId: string;
  userId: string;
  amount?: number | string | null;
}): Promise<Claim> {
  const wanted = parseAmount(input.amount);
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await lockReturn(client, input.businessId, input.returnId);
    const user = await client.query(`SELECT 1 FROM users WHERE id = $1 AND business_id = $2`, [input.userId, input.businessId]);
    if (user.rows.length === 0) throw new ReturnError(403, 'ACTOR_MISMATCH', 'This user does not belong to the business');

    const link = await client.query<{ store_order_id: string | null }>(
      `SELECT store_order_id FROM order_returns WHERE id = $1 AND business_id = $2`,
      [input.returnId, input.businessId],
    );
    const storeOrderId = link.rows[0]?.store_order_id ?? null;
    if (storeOrderId) {
      // Serialises every return refund of this order, so the online cap is read once per claim.
      await client.query(`SELECT 1 FROM store_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`, [storeOrderId, input.businessId]);
    }

    // A click while an attempt is open repeats that attempt: same key and amount, so the gateway refunds once.
    const open = await client.query<{ id: string; idempotency_key: string; amount: string; provider: Provider; provider_payment_id: string }>(
      `SELECT id, idempotency_key, amount::text, provider, provider_payment_id
         FROM return_gateway_refunds
        WHERE order_return_id = $1 AND business_id = $2 AND status = 'pending'
        FOR UPDATE`,
      [input.returnId, input.businessId],
    );
    if (open.rows[0]) {
      const o = open.rows[0];
      await client.query('COMMIT');
      return { rowId: o.id, idempotencyKey: o.idempotency_key, amount: Number(o.amount), provider: o.provider, providerPaymentId: o.provider_payment_id };
    }

    const room = await originalRefundRoom(client, input.businessId, input.returnId);
    if (!room.allowed || !room.provider) {
      throw new ReturnError(409, 'CANNOT_REFUND_ORIGINAL', room.reason ?? 'This return cannot be refunded to the original payment');
    }
    const amount = wanted ?? room.max;
    if (amount > room.max + 0.005) {
      throw new ReturnError(400, 'EXCEEDS_MAX', `Only ₹${inr(room.max)} can go back to the original payment`);
    }

    const order = await client.query<{ provider_payment_id: string; credit_note_id: string }>(
      `SELECT o.provider_payment_id, r.credit_note_id
         FROM order_returns r JOIN store_orders o ON o.id = r.store_order_id AND o.business_id = r.business_id
        WHERE r.id = $1 AND r.business_id = $2`,
      [input.returnId, input.businessId],
    );
    const rowId = randomUUID();
    await client.query(
      `INSERT INTO return_gateway_refunds
         (id, business_id, order_return_id, store_order_id, credit_note_id, provider, provider_payment_id,
          idempotency_key, amount, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$10,$8,'pending',$9)`,
      [
        rowId,
        input.businessId,
        input.returnId,
        storeOrderId,
        order.rows[0].credit_note_id,
        room.provider,
        order.rows[0].provider_payment_id,
        amount,
        input.userId,
        rowId,
      ],
    );
    await client.query('COMMIT');
    return { rowId, idempotencyKey: rowId, amount, provider: room.provider, providerPaymentId: order.rows[0].provider_payment_id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Staff asked for the money to go back to the original payment. `amount` null = the most that can.
 * Validation errors throw `ReturnError`; once the attempt is claimed, a gateway error comes back as
 * `{ status: 'failed', error }` with the attempt marked failed.
 */
export async function refundReturnToOriginalPayment(input: {
  businessId: string;
  returnId: string;
  userId: string;
  amount?: number | string | null;
  requestRefund?: GatewayRequester;
}): Promise<{ status: 'processed' | 'pending' | 'failed'; amount: number; providerRefundId: string | null; error?: string }> {
  const claim = await claimGatewayRefund(input);
  let result: { providerRefundId: string; status: 'processed' | 'pending' };
  try {
    const requestRefund =
      input.requestRefund ??
      (claim.provider === 'easebuzz'
        ? await easebuzzRefundRequester(input.businessId)
        : await razorpayRefundRequester(input.businessId));
    result = await requestRefund({
      providerPaymentId: claim.providerPaymentId,
      amountPaise: Math.round(claim.amount * 100),
      idempotencyKey: claim.idempotencyKey,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'The refund could not be sent';
    const status = await applyReturnGatewayRefundResult({
      businessId: input.businessId,
      refundRowId: claim.rowId,
      providerRefundId: null,
      providerStatus: 'failed',
      failureReason: error,
      actor: 'staff',
      actorUserId: input.userId,
    });
    // A notice may have confirmed the attempt meanwhile; only a still-open attempt is reported failed.
    if (status === 'failed') return { status: 'failed', amount: claim.amount, providerRefundId: null, error };
    return { status, amount: claim.amount, providerRefundId: null };
  }
  const status = await applyReturnGatewayRefundResult({
    businessId: input.businessId,
    refundRowId: claim.rowId,
    providerRefundId: result.providerRefundId,
    providerStatus: result.status,
    actor: 'staff',
    actorUserId: input.userId,
  });
  return { status, amount: claim.amount, providerRefundId: result.providerRefundId };
}

/** The bank account the online payment settled in, else the first bank account. */
async function settlementAccount(client: PoolClient, businessId: string, storeOrderId: string | null): Promise<string | null> {
  if (storeOrderId) {
    const s = await client.query<{ settlement_account_id: string | null }>(
      `SELECT p.settlement_account_id
         FROM store_orders o
         JOIN payments p ON p.id = o.receipt_payment_id AND p.business_id = o.business_id
        WHERE o.id = $1 AND o.business_id = $2`,
      [storeOrderId, businessId],
    );
    if (s.rows[0]?.settlement_account_id) return s.rows[0].settlement_account_id;
  }
  const accounts = await listCashBankAccounts(client, businessId);
  return accounts.find((a) => a.kind === 'bank')?.id ?? null;
}

/**
 * Records what the gateway said about one attempt. Idempotent: a processed attempt stays processed
 * and is posted once; a failed attempt stays failed.
 */
export async function applyReturnGatewayRefundResult(input: {
  businessId: string;
  refundRowId: string;
  providerRefundId: string | null;
  providerStatus: 'processed' | 'pending' | 'failed';
  failureReason?: string | null;
  actor: 'staff' | 'webhook' | 'system';
  actorUserId?: string | null;
}): Promise<'pending' | 'processed' | 'failed'> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const found = await client.query<{ order_return_id: string; store_order_id: string | null }>(
      `SELECT order_return_id, store_order_id FROM return_gateway_refunds WHERE id = $1 AND business_id = $2`,
      [input.refundRowId, input.businessId],
    );
    if (!found.rows[0]) throw new ReturnError(404, 'REFUND_NOT_FOUND', 'Refund not found');
    const { order_return_id: returnId, store_order_id: storeOrderId } = found.rows[0];
    const ret = await lockReturn(client, input.businessId, returnId);
    if (storeOrderId) {
      await client.query(`SELECT 1 FROM store_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`, [storeOrderId, input.businessId]);
    }
    const locked = await client.query<{
      status: 'pending' | 'processed' | 'failed';
      provider_refund_id: string | null;
      amount: string;
      credit_note_id: string | null;
      created_by: string | null;
    }>(
      `SELECT status, provider_refund_id, amount::text, credit_note_id, created_by
         FROM return_gateway_refunds WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [input.refundRowId, input.businessId],
    );
    const row = locked.rows[0];
    if (row.status !== 'pending') {
      await client.query('COMMIT');
      return row.status;
    }
    if (row.provider_refund_id && input.providerRefundId && row.provider_refund_id !== input.providerRefundId) {
      throw new ReturnError(409, 'REFUND_CONFLICT', 'This refund attempt already has a different gateway refund');
    }
    const refundId = input.providerRefundId ?? row.provider_refund_id;
    const amount = Number(row.amount);
    const event = { businessId: input.businessId, returnId, actorType: input.actor, actorUserId: input.actorUserId ?? null };

    if (input.providerStatus === 'pending') {
      await client.query(
        `UPDATE return_gateway_refunds SET provider_refund_id = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
        [input.refundRowId, input.businessId, refundId],
      );
      // Said once, when the gateway first takes the refund.
      if (!row.provider_refund_id && refundId) {
        await recordReturnEvent(client, { ...event, kind: 'refund_pending', note: `₹${inr(amount)} on its way to the original payment` });
      }
      await client.query('COMMIT');
      return 'pending';
    }

    if (input.providerStatus === 'failed') {
      const reason = input.failureReason?.trim() || 'The gateway declined this refund';
      await client.query(
        `UPDATE return_gateway_refunds
            SET status = 'failed', failure_reason = $3, provider_refund_id = $4, updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [input.refundRowId, input.businessId, reason, refundId],
      );
      await recordReturnEvent(client, { ...event, kind: 'refund_failed', note: reason });
      await client.query('COMMIT');
      return 'failed';
    }

    if (!row.credit_note_id) throw new ReturnError(409, 'NO_CREDIT_NOTE', 'This return has no credit note');
    const accountId = await settlementAccount(client, input.businessId, storeOrderId);
    let paid: Awaited<ReturnType<typeof refundCreditNote>>;
    try {
      paid = await refundCreditNote(client, {
        businessId: input.businessId,
        userId: (row.created_by ?? input.actorUserId ?? null) as string,
        creditNoteId: row.credit_note_id,
        amount,
        mode: 'gateway',
        paymentAccountId: accountId,
        date: today(),
        reference: refundId,
        orderReturnId: returnId,
      });
    } catch (e) {
      if (e instanceof CreditNoteRefundError) throw new ReturnError(e.status, e.code, e.message);
      throw e;
    }
    await client.query(
      `UPDATE return_gateway_refunds
          SET status = 'processed', provider_refund_id = $3, credit_note_refund_id = $4, failure_reason = NULL, updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [input.refundRowId, input.businessId, refundId, paid.id],
    );
    await client.query(
      `UPDATE order_returns
          SET refund_method = 'original_payment',
              refunded_amount = refunded_amount + $3,
              status = CASE WHEN $4::boolean THEN 'closed' ELSE status END,
              closed_at = CASE WHEN $4::boolean THEN NOW() ELSE closed_at END,
              updated_at = NOW()
        WHERE id = $1 AND business_id = $2`,
      [ret.id, input.businessId, paid.amount, paid.fullyRefunded],
    );
    if (storeOrderId) {
      // The sale stays paid until return refunds reach what was paid online.
      await client.query(
        `UPDATE store_orders o
            SET payment_status = 'refunded', updated_at = CURRENT_TIMESTAMP
          WHERE o.id = $1 AND o.business_id = $2 AND o.payment_status = 'paid'
            AND (SELECT COALESCE(SUM(g.amount), 0) FROM return_gateway_refunds g
                  WHERE g.store_order_id = o.id AND g.business_id = o.business_id AND g.status = 'processed') >= o.grand_total`,
        [storeOrderId, input.businessId],
      );
    }
    await recordReturnEvent(client, {
      ...event,
      kind: 'refunded',
      note: `₹${inr(paid.amount)} back to the original payment${refundId ? ` (${refundId})` : ''}`,
    });
    await client.query('COMMIT');
    return 'processed';
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * The open attempt a gateway refund notice is about, inside the store order whose notice was verified:
 * by gateway refund id, else (the notice can arrive before the id is saved) the order's pending attempt
 * with no id yet and the same amount in paise. Null = not a return refund.
 */
export async function matchReturnRefundNotice(input: {
  businessId: string;
  storeOrderId: string;
  providerRefundId: string;
  amountInr: number | null;
}): Promise<string | null> {
  const pool = getPool();
  const byId = await pool.query<{ id: string }>(
    `SELECT id FROM return_gateway_refunds
      WHERE business_id = $1 AND store_order_id = $2 AND provider_refund_id = $3
      ORDER BY created_at LIMIT 1`,
    [input.businessId, input.storeOrderId, input.providerRefundId],
  );
  if (byId.rows[0]) return byId.rows[0].id;
  if (input.amountInr == null || !Number.isFinite(input.amountInr)) return null;
  const byAmount = await pool.query<{ id: string }>(
    `SELECT id FROM return_gateway_refunds
      WHERE business_id = $1 AND store_order_id = $2 AND status = 'pending' AND provider_refund_id IS NULL
        AND ROUND(amount * 100) = $3
      ORDER BY created_at LIMIT 1`,
    [input.businessId, input.storeOrderId, Math.round(input.amountInr * 100)],
  );
  return byAmount.rows[0]?.id ?? null;
}

type PendingRow = {
  id: string;
  business_id: string;
  provider: Provider;
  provider_payment_id: string;
  provider_refund_id: string | null;
  idempotency_key: string;
};

/** Default status lookup: Razorpay by refund id, Easebuzz by our merchant refund id (the key). */
async function gatewayStatus(row: PendingRow): Promise<'processed' | 'pending' | 'failed' | null> {
  if (row.provider === 'easebuzz') {
    const cfg = await getBusinessPaymentProviderConfig(row.business_id, 'easebuzz');
    if (!cfg) return null;
    const found = await new EasebuzzPaymentProvider(cfg).fetchRefundStatus(row.provider_payment_id, row.idempotency_key);
    return found?.status ?? null;
  }
  if (!row.provider_refund_id) return null;
  const cfg = await getBusinessPaymentProviderConfig(row.business_id, 'razorpay');
  if (!cfg) return null;
  const found = await new RazorpayPaymentProvider(cfg).fetchRefund({
    providerPaymentId: row.provider_payment_id,
    providerRefundId: row.provider_refund_id,
  });
  return found.status;
}

/** Cron and *Check now*: asks the gateway about attempts still pending after `olderThanMinutes` (10). */
export async function checkPendingReturnRefunds(opts?: {
  olderThanMinutes?: number;
  fetchStatus?: (row: {
    business_id: string;
    provider: Provider;
    provider_payment_id: string;
    provider_refund_id: string | null;
    idempotency_key: string;
  }) => Promise<'processed' | 'pending' | 'failed' | null>;
}): Promise<{ checked: number; processed: number; failed: number }> {
  const minutes = opts?.olderThanMinutes ?? 10;
  const fetchStatus = opts?.fetchStatus ?? gatewayStatus;
  const rows = await getPool().query<PendingRow>(
    `SELECT id, business_id, provider, provider_payment_id, provider_refund_id, idempotency_key
       FROM return_gateway_refunds
      WHERE status = 'pending' AND provider_payment_id IS NOT NULL
        AND created_at <= NOW() - make_interval(mins => $1::int)
      ORDER BY created_at
      LIMIT 200`,
    [minutes],
  );
  const out = { checked: 0, processed: 0, failed: 0 };
  for (const row of rows.rows) {
    out.checked += 1;
    try {
      const status = await fetchStatus(row);
      if (status !== 'processed' && status !== 'failed') continue;
      const applied = await applyReturnGatewayRefundResult({
        businessId: row.business_id,
        refundRowId: row.id,
        providerRefundId: row.provider_refund_id,
        providerStatus: status,
        failureReason: status === 'failed' ? 'The gateway declined this refund' : null,
        actor: 'system',
      });
      if (applied === 'processed') out.processed += 1;
      if (applied === 'failed') out.failed += 1;
    } catch (e) {
      console.error('[return-refunds] check failed', row.id, e instanceof Error ? e.message : e);
    }
  }
  return out;
}
