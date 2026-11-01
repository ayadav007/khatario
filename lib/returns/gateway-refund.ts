import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { getPool } from '@/lib/db';
import { round2 } from '@/lib/accounting/voucher-posting';
import { listCashBankAccounts } from '@/lib/accounting/contra';
import { CreditNoteRefundError, refundCreditNote, refundableOnCreditNote } from '@/lib/credit-notes/refund';
import { getBusinessPaymentProviderConfig } from '@/lib/payments/business-provider-config';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { EasebuzzPaymentProvider, easebuzzMerchantRefundId } from '@/lib/payments/providers/easebuzz-payment-provider';
import { GatewayRefundError } from '@/lib/payments/gateway-refund-error';
import { easebuzzRefundRequester, razorpayRefundRequester, StoreRefundError } from '@/lib/store/store-refund';
import { recordReturnEvent } from './events';
import { notifyReturnCustomer } from './notify';
import { lockReturn, ReturnError } from './service';

/**
 * Refund a received return to the card / UPI the customer paid the store order with (Razorpay or
 * Easebuzz), in part or in full, and post it against the return's credit note.
 *
 *   claim   (own transaction, committed)  -> return_gateway_refunds row `pending`, key = row id
 *   gateway (no transaction)              -> refund asked for with that key, amount in paise
 *   apply   (transaction)                 -> processed: credit-note refund (mode `gateway`) to the bank
 *                                            account the payment settled in; pending: wait for the
 *                                            Razorpay notice or checkPendingReturnRefunds; failed (a
 *                                            definite refusal only): kept with its reason, a retry
 *                                            makes a new attempt
 *
 * An unclear gateway error (network, timeout, 5xx) leaves the attempt `pending` with the message as a
 * note: the refund may exist, so staff retry, Check now and the cron repeat the same key and amount.
 * An Easebuzz send that is refused is looked up by its key before it may fail (Easebuzz has no
 * idempotency header, so the refusal may be of a duplicate of a refund it already took).
 *
 * Locks are always taken return -> store order -> refund row -> credit note, so the claim, a webhook
 * and the pending check serialise per order and two clicks cannot both claim room beyond the cap. The
 * claim locks the credit note before reading its room, as applying customer credit to a bill does, so
 * the same credit is never both spent on a bill and refunded.
 * Order cancellations use store_payment_refunds (lib/store/store-refund.ts), never this table.
 */

export type GatewayRequester = (args: {
  providerPaymentId: string;
  amountPaise: number;
  idempotencyKey: string;
}) => Promise<{ providerRefundId: string; status: 'processed' | 'pending' }>;

type Db = Pick<PoolClient, 'query'>;
type Provider = 'razorpay' | 'easebuzz';

/** Where the gateway says an attempt has got to; null = it has no such refund. Throws when it cannot answer. */
export type StatusLookup = (row: {
  business_id: string;
  provider: Provider;
  provider_payment_id: string;
  provider_refund_id: string | null;
  idempotency_key: string;
}) => Promise<'processed' | 'pending' | 'failed' | null>;

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
  // The note's refundable already leaves out refunds on their way (they hold their amount on the note).
  const onNote = round2(note?.refundable ?? 0);
  const online = await onlineLeft(client, businessId, row.store_order_id, row.grand_total);
  const max = Math.max(0, round2(Math.min(onNote, online)));
  if (max <= 0.004) return no('Nothing is left to refund to the original payment', provider);
  return { allowed: true, max, provider, reason: null };
}

/** What is left of the order's online payment after cancellation refunds and return refunds (pending or processed). */
async function onlineLeft(client: Db, businessId: string, storeOrderId: string, grandTotal: string | null): Promise<number> {
  const sums = await client.query<{ order_refunds: string; cancel_refunds: string }>(
    `SELECT
       COALESCE(SUM(g.amount) FILTER (WHERE g.status IN ('pending', 'processed')), 0)::text AS order_refunds,
       (SELECT COALESCE(SUM(s.amount), 0) FROM store_payment_refunds s
         WHERE s.order_id = $1 AND s.business_id = $2 AND s.status <> 'failed')::text AS cancel_refunds
       FROM return_gateway_refunds g
      WHERE g.store_order_id = $1 AND g.business_id = $2`,
    [storeOrderId, businessId],
  );
  const s = sums.rows[0];
  return round2((Number(grandTotal) || 0) - Number(s.cancel_refunds) - Number(s.order_refunds));
}

export type OriginalRefundOffer = {
  /** The order was paid online through a gateway we refund through, with a captured payment and its receipt. */
  eligible: boolean;
  /** Roughly how much could go back: the return's value (or, once received, the room) capped by the online payment left. */
  estimatedMax: number | null;
  provider: Provider | null;
};

/**
 * Whether *Back to original payment* can be offered for this return whatever its status, so the
 * receive step can preselect it (spec section 2, step 4). `room` is originalRefundRoom's answer.
 */
export async function originalRefundOffer(
  client: Db,
  businessId: string,
  returnId: string,
  room: OriginalRefundRoom,
): Promise<OriginalRefundOffer> {
  const r = await client.query<{
    status: string;
    store_order_id: string | null;
    provider_payment_id: string | null;
    receipt_payment_id: string | null;
    payment_provider: string | null;
    grand_total: string | null;
    value: string;
  }>(
    `SELECT r.status, r.store_order_id, o.provider_payment_id, o.receipt_payment_id, o.payment_provider, o.grand_total::text,
            (SELECT COALESCE(SUM(i.quantity * i.unit_price * (1 + i.tax_rate / 100)), 0)
               FROM order_return_items i WHERE i.return_id = r.id)::text AS value
       FROM order_returns r
       LEFT JOIN store_orders o ON o.id = r.store_order_id AND o.business_id = r.business_id
      WHERE r.id = $1 AND r.business_id = $2`,
    [returnId, businessId],
  );
  const row = r.rows[0];
  const provider = row?.provider_payment_id ? onlineProvider(row.payment_provider) : null;
  if (!row || !row.store_order_id || !row.provider_payment_id || !row.receipt_payment_id || !provider) {
    return { eligible: false, estimatedMax: null, provider: null };
  }
  if (row.status === 'received') return { eligible: true, estimatedMax: room.max, provider };
  if (row.status !== 'requested' && row.status !== 'approved') return { eligible: true, estimatedMax: null, provider };
  const online = await onlineLeft(client, businessId, row.store_order_id, row.grand_total);
  return { eligible: true, estimatedMax: Math.max(0, round2(Math.min(Number(row.value) || 0, online))), provider };
}

type Claim = {
  /** False when an open attempt was reused: an earlier send may already have reached the gateway. */
  fresh: boolean;
  /** The reused attempt is one Easebuzz refused (see refusedNote): it is looked up, never sent again. */
  refused: { note: string; aged: boolean } | null;
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
    const open = await client.query<{
      id: string;
      idempotency_key: string;
      amount: string;
      provider: Provider;
      provider_payment_id: string;
      provider_refund_id: string | null;
      failure_reason: string | null;
      refusal_aged: boolean;
    }>(
      `SELECT id, idempotency_key, amount::text, provider, provider_payment_id, provider_refund_id, failure_reason,
              updated_at <= NOW() - make_interval(mins => $3::int) AS refusal_aged
         FROM return_gateway_refunds
        WHERE order_return_id = $1 AND business_id = $2 AND status = 'pending'
        FOR UPDATE`,
      [input.returnId, input.businessId, REFUSAL_WAIT_MINUTES],
    );
    if (open.rows[0]) {
      const o = open.rows[0];
      await client.query('COMMIT');
      const note = refusedNote(o);
      return {
        fresh: false,
        refused: note ? { note, aged: o.refusal_aged } : null,
        rowId: o.id,
        idempotencyKey: o.idempotency_key,
        amount: Number(o.amount),
        provider: o.provider,
        providerPaymentId: o.provider_payment_id,
      };
    }

    const noteLink = await client.query<{ credit_note_id: string | null }>(
      `SELECT credit_note_id FROM order_returns WHERE id = $1 AND business_id = $2`,
      [input.returnId, input.businessId],
    );
    const noteId = noteLink.rows[0]?.credit_note_id ?? null;
    if (noteId) {
      // Spending customer credit on a bill locks the customer's notes, then reads what is left; so does this.
      await client.query(`SELECT 1 FROM credit_notes WHERE id = $1 AND business_id = $2 FOR UPDATE`, [noteId, input.businessId]);
    }

    const room = await originalRefundRoom(client, input.businessId, input.returnId);
    if (!room.allowed || !room.provider) {
      throw new ReturnError(409, 'CANNOT_REFUND_ORIGINAL', room.reason ?? 'This return cannot be refunded to the original payment');
    }
    const amount = wanted ?? room.max;
    if (amount > room.max + 0.005) {
      throw new ReturnError(400, 'EXCEEDS_MAX', `Only ₹${inr(room.max)} can go back to the original payment`);
    }

    // Posting needs the account the money leaves from: refuse now, before any money leaves.
    if (!(await usableSettlementAccount(client, input.businessId, storeOrderId))) {
      throw new ReturnError(
        409,
        'NO_SETTLEMENT_ACCOUNT',
        'There is no active bank account to post this refund from. Add or reactivate a bank account, or pay back another way.',
      );
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
    return { fresh: true, refused: null, rowId, idempotencyKey: rowId, amount, provider: room.provider, providerPaymentId: order.rows[0].provider_payment_id };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Only a definite refusal (Razorpay 4xx, Easebuzz reporting the refund failed) means no refund exists.
 * Anything else (network error, timeout, 5xx) may have created it, so the attempt stays open and is
 * repeated with the same idempotency key.
 */
export function isDefiniteRefusal(e: unknown): boolean {
  if (e instanceof GatewayRefundError) return e.definite;
  if (e instanceof StoreRefundError) return e.code === 'REFUND_FAILED';
  return false;
}

type SendResult = { status: 'processed' | 'pending' | 'failed'; providerRefundId: string | null; error?: string };

const REPEAT_REFUSED = 'The gateway refused a repeat send; the earlier refund is being checked';
const REFUSED_UNCHECKED = 'The gateway refused this refund but could not say whether it already has it; it is being checked';
const EASEBUZZ_REFUSED = 'Easebuzz refused this refund';
/** How long a refused Easebuzz attempt waits for Easebuzz's refund list to catch up before it can fail. */
const REFUSAL_WAIT_MINUTES = 30;

/**
 * An Easebuzz attempt with no refund id whose last send Easebuzz refused carries one of the notes
 * above; the row's updated_at is when (nothing else writes it while it waits). Null = not one.
 */
function refusedNote(row: { provider: Provider; provider_refund_id: string | null; failure_reason: string | null }): string | null {
  if (row.provider !== 'easebuzz' || row.provider_refund_id) return null;
  return row.failure_reason === REPEAT_REFUSED || row.failure_reason === REFUSED_UNCHECKED ? row.failure_reason : null;
}

type Applied = { status: 'pending' | 'processed' | 'failed'; error?: string; providerRefundId?: string | null };

/** What a send comes to: the attempt's status and stored refund id, and an error unless it was processed. */
function sendResult(applied: Applied, fallbackError?: string): SendResult {
  const providerRefundId = applied.providerRefundId ?? null;
  const error = applied.status === 'processed' ? undefined : applied.error ?? fallbackError;
  return error ? { status: applied.status, providerRefundId, error } : { status: applied.status, providerRefundId };
}

/** Asks the gateway for one open attempt (with its own key and amount) and applies the answer. */
async function sendAttempt(
  attempt: {
    businessId: string;
    rowId: string;
    provider: Provider;
    providerPaymentId: string;
    amount: number;
    idempotencyKey: string;
    fresh: boolean;
  },
  getRequester: () => Promise<GatewayRequester>,
  lookup: StatusLookup,
  actor: 'staff' | 'system',
  actorUserId: string | null,
): Promise<SendResult> {
  const apply = async (providerRefundId: string | null, providerStatus: 'processed' | 'pending' | 'failed', failureReason: string | null = null) =>
    (await applyDetailed(providerRefundId, providerStatus, failureReason)).status;
  const applyDetailed = (providerRefundId: string | null, providerStatus: 'processed' | 'pending' | 'failed', failureReason: string | null = null) =>
    applyResult({
      businessId: attempt.businessId,
      refundRowId: attempt.rowId,
      providerRefundId,
      providerStatus,
      failureReason,
      actor,
      actorUserId,
    });

  let requestRefund: GatewayRequester;
  try {
    requestRefund = await getRequester();
  } catch (e) {
    // Nothing was sent this time (e.g. online payment not configured). A fresh attempt has never reached
    // the gateway, so it fails; a repeated one may have, so it stays open.
    const error = e instanceof Error ? e.message : 'The refund could not be sent';
    const status = await apply(null, attempt.fresh ? 'failed' : 'pending', error);
    return status === 'processed' ? { status, providerRefundId: null } : { status, providerRefundId: null, error };
  }

  let result: { providerRefundId: string; status: 'processed' | 'pending' };
  try {
    result = await requestRefund({
      providerPaymentId: attempt.providerPaymentId,
      amountPaise: Math.round(attempt.amount * 100),
      idempotencyKey: attempt.idempotencyKey,
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : 'The refund could not be sent';
    if (isDefiniteRefusal(e) && attempt.provider === 'easebuzz') {
      return recheckRefusedEasebuzz(attempt, lookup, error, applyDetailed);
    }
    // Unclear: kept pending with the message as a note; the retry, Check now or the cron repeats the key.
    // A notice may have confirmed the attempt meanwhile; then there is no error to show.
    return sendResult(await applyDetailed(null, isDefiniteRefusal(e) ? 'failed' : 'pending', error), error);
  }
  // Posting can fail after the gateway refunded: the attempt stays pending and the reason comes back.
  const applied = await applyDetailed(result.providerRefundId, result.status);
  return applied.error
    ? { status: applied.status, providerRefundId: result.providerRefundId, error: applied.error }
    : { status: applied.status, providerRefundId: result.providerRefundId };
}

/**
 * Easebuzz has no idempotency header, so a send it turns down (a duplicate merchant refund id, say) may
 * be the copy of a refund it already took: from an earlier send whose answer was lost, a Try again
 * racing the cron, or (for a first send) a double-click whose repeat reached it first. Only its own
 * record of our key decides: a refund there is applied, a failed one fails the attempt, and a lookup
 * that cannot answer keeps it pending. No refund under the key fails a first send (the refusal was
 * about it) but keeps a repeat pending, since an earlier send may still be on its way into the list.
 */
async function recheckRefusedEasebuzz(
  attempt: { businessId: string; provider: Provider; providerPaymentId: string; idempotencyKey: string; fresh: boolean },
  lookup: StatusLookup,
  error: string,
  applyDetailed: (
    providerRefundId: string | null,
    providerStatus: 'processed' | 'pending' | 'failed',
    failureReason?: string | null,
  ) => Promise<Applied>,
): Promise<SendResult> {
  let found: 'processed' | 'pending' | 'failed' | null = null;
  let unclear = false;
  try {
    found = await lookup({
      business_id: attempt.businessId,
      provider: attempt.provider,
      provider_payment_id: attempt.providerPaymentId,
      provider_refund_id: null,
      idempotency_key: attempt.idempotencyKey,
    });
  } catch {
    unclear = true;
  }
  // Easebuzz knows a refund by our merchant refund id, which is the key.
  const refundId = easebuzzMerchantRefundId(attempt.idempotencyKey);
  if (found === 'failed' || (found === null && !unclear && attempt.fresh)) {
    return sendResult(await applyDetailed(found === 'failed' ? refundId : null, 'failed', error), error);
  }
  if (found) return sendResult(await applyDetailed(refundId, found));
  // From here the attempt counts as refused (refusedNote): it is looked up, never sent again.
  const note = attempt.fresh ? REFUSED_UNCHECKED : REPEAT_REFUSED;
  return sendResult(await applyDetailed(null, 'pending', note), note);
}

/**
 * An Easebuzz attempt with no refund id that Easebuzz refused is never sent again (that would only be
 * refused again, every run, while the credit stays held). It is looked up by its key instead: a refund
 * there is applied; none, once REFUSAL_WAIT_MINUTES have passed since the refusal (time for the list
 * to catch up), fails it and frees the credit; a lookup that cannot answer changes nothing.
 */
async function settleRefusedEasebuzz(
  attempt: { businessId: string; rowId: string; provider: Provider; providerPaymentId: string; idempotencyKey: string },
  refused: { note: string; aged: boolean },
  lookup: StatusLookup,
  actor: 'staff' | 'system',
  actorUserId: string | null,
): Promise<SendResult> {
  let found: 'processed' | 'pending' | 'failed' | null;
  try {
    found = await lookup({
      business_id: attempt.businessId,
      provider: attempt.provider,
      provider_payment_id: attempt.providerPaymentId,
      provider_refund_id: null,
      idempotency_key: attempt.idempotencyKey,
    });
  } catch {
    return { status: 'pending', providerRefundId: null, error: refused.note };
  }
  if (!found && !refused.aged) return { status: 'pending', providerRefundId: null, error: refused.note };
  const reason = found === 'failed' ? 'The gateway declined this refund' : found ? null : EASEBUZZ_REFUSED;
  const applied = await applyResult({
    businessId: attempt.businessId,
    refundRowId: attempt.rowId,
    providerRefundId: found ? easebuzzMerchantRefundId(attempt.idempotencyKey) : null,
    providerStatus: found ?? 'failed',
    failureReason: reason,
    actor,
    actorUserId,
  });
  return sendResult(applied, reason ?? undefined);
}

function defaultRequester(provider: Provider, businessId: string): () => Promise<GatewayRequester> {
  return () => (provider === 'easebuzz' ? easebuzzRefundRequester(businessId) : razorpayRefundRequester(businessId));
}

/**
 * Staff asked for the money to go back to the original payment. `amount` null = the most that can.
 * Validation errors throw `ReturnError`. Once the attempt is claimed, a definite gateway refusal comes
 * back as `{ status: 'failed', error }`; an unclear error as `{ status: 'pending', error }` with the
 * attempt kept open under the same key.
 */
export async function refundReturnToOriginalPayment(input: {
  businessId: string;
  returnId: string;
  userId: string;
  amount?: number | string | null;
  requestRefund?: GatewayRequester;
  fetchStatus?: StatusLookup;
}): Promise<{ status: 'processed' | 'pending' | 'failed'; amount: number; providerRefundId: string | null; error?: string }> {
  const claim = await claimGatewayRefund(input);
  const lookup = input.fetchStatus ?? gatewayStatus;
  if (claim.refused) {
    const settled = await settleRefusedEasebuzz(
      { businessId: input.businessId, rowId: claim.rowId, provider: claim.provider, providerPaymentId: claim.providerPaymentId, idempotencyKey: claim.idempotencyKey },
      claim.refused,
      lookup,
      'staff',
      input.userId,
    );
    return { ...settled, amount: claim.amount };
  }
  const given = input.requestRefund;
  const sent = await sendAttempt(
    {
      businessId: input.businessId,
      rowId: claim.rowId,
      provider: claim.provider,
      providerPaymentId: claim.providerPaymentId,
      amount: claim.amount,
      idempotencyKey: claim.idempotencyKey,
      fresh: claim.fresh,
    },
    given ? async () => given : defaultRequester(claim.provider, input.businessId),
    lookup,
    'staff',
    input.userId,
  );
  return { ...sent, amount: claim.amount };
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

/** The account posting would use, when it can take a gateway refund (an active bank or gateway clearing account). */
async function usableSettlementAccount(client: PoolClient, businessId: string, storeOrderId: string | null): Promise<string | null> {
  const id = await settlementAccount(client, businessId, storeOrderId);
  if (!id) return null;
  const { listSettlementAccounts } = await import('@/lib/accounting/settlement-accounts-db');
  return (await listSettlementAccounts(businessId)).some((a) => a.id === id) ? id : null;
}

/**
 * Who a refund is posted as: the staff member who sent it, else the one acting now, else (a notice or
 * the cron after that user was removed) the business owner, else the business's first user.
 */
async function postingUser(client: PoolClient, businessId: string, ...candidates: (string | null | undefined)[]): Promise<string> {
  for (const id of candidates) {
    if (!id) continue;
    const found = await client.query(`SELECT 1 FROM users WHERE id = $1 AND business_id = $2`, [id, businessId]);
    if (found.rows.length > 0) return id;
  }
  const fallback = await client.query<{ id: string }>(
    `SELECT id FROM users WHERE business_id = $1 ORDER BY is_primary_admin DESC NULLS LAST, created_at LIMIT 1`,
    [businessId],
  );
  if (!fallback.rows[0]) throw new ReturnError(409, 'NO_USER', 'This business has no user to post the refund as');
  return fallback.rows[0].id;
}

type ApplyInput = {
  businessId: string;
  refundRowId: string;
  providerRefundId: string | null;
  providerStatus: 'processed' | 'pending' | 'failed';
  failureReason?: string | null;
  actor: 'staff' | 'webhook' | 'system';
  actorUserId?: string | null;
};

/**
 * Records what the gateway said about one attempt. Idempotent: a processed attempt stays processed
 * and is posted once; a failed attempt stays failed. An attempt that has a gateway refund id fails
 * only on an answer about that refund id (a notice or a status check), never on a send refused
 * without one, so the hold on the credit note is not released while the refund may exist. When the
 * gateway has refunded but the books cannot post it (locked period, closed account...), the attempt stays pending with its refund id
 * and a note, so later checks look it up instead of sending it again.
 */
export async function applyReturnGatewayRefundResult(input: ApplyInput): Promise<'pending' | 'processed' | 'failed'> {
  return (await applyResult(input)).status;
}

/**
 * Applies the gateway's answer, then (after commit) tells the customer when this call is the one that
 * settled the money. Staff sends, Razorpay notices and the pending check all come through here, so the
 * *refunded* message goes once whichever of them completes the refund.
 */
async function applyResult(
  input: ApplyInput,
): Promise<{ status: 'pending' | 'processed' | 'failed'; error?: string; providerRefundId?: string | null }> {
  const { settledReturnId, ...out } = await applyResultInTx(input);
  if (settledReturnId) await notifyReturnCustomer(input.businessId, settledReturnId, 'refunded');
  return out;
}

async function applyResultInTx(
  input: ApplyInput,
): Promise<{ status: 'pending' | 'processed' | 'failed'; error?: string; settledReturnId?: string; providerRefundId?: string | null }> {
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
      if (row.status === 'failed' && input.providerRefundId && input.providerStatus !== 'failed') {
        // The gateway has (or is making) a refund for an attempt we let go: staff must look at it.
        console.error('[return refund] gateway refund on a failed attempt', input.refundRowId, input.providerRefundId, input.providerStatus);
      }
      await client.query('COMMIT');
      return { status: row.status, providerRefundId: row.provider_refund_id };
    }
    if (row.provider_refund_id && input.providerRefundId && row.provider_refund_id !== input.providerRefundId) {
      throw new ReturnError(409, 'REFUND_CONFLICT', 'This refund attempt already has a different gateway refund');
    }
    const refundId = input.providerRefundId ?? row.provider_refund_id;
    const amount = Number(row.amount);
    const event = { businessId: input.businessId, returnId, actorType: input.actor, actorUserId: input.actorUserId ?? null };

    if (input.providerStatus === 'pending') {
      // failure_reason here is only a note on an unclear error; the attempt is still open.
      await client.query(
        `UPDATE return_gateway_refunds SET provider_refund_id = $3, failure_reason = $4, updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [input.refundRowId, input.businessId, refundId, input.failureReason?.trim() || null],
      );
      // Said once, when the gateway first takes the refund.
      if (!row.provider_refund_id && refundId) {
        await recordReturnEvent(client, { ...event, kind: 'refund_pending', note: `₹${inr(amount)} on its way to the original payment` });
      }
      await client.query('COMMIT');
      return { status: 'pending', providerRefundId: refundId };
    }

    if (input.providerStatus === 'failed' && row.provider_refund_id && !input.providerRefundId) {
      // A refusal that does not name the refund (a repeat send turned down) says nothing about the refund
      // the gateway already took: it stays open, holding its amount, until checked by its refund id.
      await client.query(
        `UPDATE return_gateway_refunds SET failure_reason = $3, updated_at = NOW() WHERE id = $1 AND business_id = $2`,
        [input.refundRowId, input.businessId, REPEAT_REFUSED],
      );
      await client.query('COMMIT');
      return { status: 'pending', error: REPEAT_REFUSED, providerRefundId: row.provider_refund_id };
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
      return { status: 'failed', providerRefundId: refundId };
    }

    // The money has left at the gateway. If posting fails, keep the refund id and say why.
    await client.query('SAVEPOINT post_gateway_refund');
    try {
      await postProcessedRefund(client, input, { ...row, returnId, storeOrderId, refundId, amount, event, retId: ret.id });
    } catch (e) {
      await client.query('ROLLBACK TO SAVEPOINT post_gateway_refund');
      const message = e instanceof Error ? e.message : String(e);
      const error = `Refunded at the gateway; posting failed: ${message}`;
      console.error('[return-refunds] posting failed', input.refundRowId, message);
      await client.query(
        `UPDATE return_gateway_refunds SET provider_refund_id = $3, failure_reason = $4, updated_at = NOW()
          WHERE id = $1 AND business_id = $2`,
        [input.refundRowId, input.businessId, refundId, error],
      );
      await client.query('COMMIT');
      return { status: 'pending', error, providerRefundId: refundId };
    }
    await client.query('COMMIT');
    return { status: 'processed', settledReturnId: returnId, providerRefundId: refundId };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Posts a processed gateway refund against the credit note and closes what it settles. Caller's transaction. */
async function postProcessedRefund(
  client: PoolClient,
  input: ApplyInput,
  row: {
    credit_note_id: string | null;
    created_by: string | null;
    returnId: string;
    storeOrderId: string | null;
    refundId: string | null;
    amount: number;
    retId: string;
    event: { businessId: string; returnId: string; actorType: ApplyInput['actor']; actorUserId: string | null };
  },
): Promise<void> {
  const { returnId, storeOrderId, refundId, amount, event } = row;
  {
    if (!row.credit_note_id) throw new ReturnError(409, 'NO_CREDIT_NOTE', 'This return has no credit note');
    const accountId = await settlementAccount(client, input.businessId, storeOrderId);
    let paid: Awaited<ReturnType<typeof refundCreditNote>>;
    try {
      paid = await refundCreditNote(client, {
        businessId: input.businessId,
        userId: await postingUser(client, input.businessId, row.created_by, input.actorUserId),
        creditNoteId: row.credit_note_id,
        amount,
        mode: 'gateway',
        paymentAccountId: accountId,
        date: today(),
        reference: refundId,
        orderReturnId: returnId,
        gatewayRefundId: input.refundRowId,
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
      [row.retId, input.businessId, paid.amount, paid.fullyRefunded],
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
  }
}

/**
 * The open attempt a gateway refund notice is about, inside the store order whose notice was verified:
 * by gateway refund id, else (the notice can arrive before the id is saved) the order's pending attempt
 * with no id yet and the same amount in paise. The amount match is used only when exactly one attempt
 * fits and the refund id is not already another attempt's or a cancellation refund's, so an unrelated
 * refund of the same amount never completes the wrong attempt. Null = not a return refund.
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
  const known = await pool.query(
    `SELECT 1 FROM return_gateway_refunds WHERE business_id = $1 AND provider_refund_id = $2
     UNION ALL
     SELECT 1 FROM store_payment_refunds WHERE business_id = $1 AND provider_refund_id = $2
     LIMIT 1`,
    [input.businessId, input.providerRefundId],
  );
  if (known.rows.length > 0) return null;
  const byAmount = await pool.query<{ id: string }>(
    `SELECT id FROM return_gateway_refunds
      WHERE business_id = $1 AND store_order_id = $2 AND status = 'pending' AND provider_refund_id IS NULL
        AND ROUND(amount * 100) = $3
      LIMIT 2`,
    [input.businessId, input.storeOrderId, Math.round(input.amountInr * 100)],
  );
  return byAmount.rows.length === 1 ? byAmount.rows[0].id : null;
}

type PendingRow = {
  id: string;
  business_id: string;
  provider: Provider;
  provider_payment_id: string;
  provider_refund_id: string | null;
  idempotency_key: string;
  amount: string;
  failure_reason: string | null;
  /** Last written at least REFUSAL_WAIT_MINUTES ago (for a refused Easebuzz attempt: refused that long ago). */
  refusal_aged: boolean;
};

/** Default status lookup: Razorpay by refund id, Easebuzz by our merchant refund id (the key). */
async function gatewayStatus(row: Parameters<StatusLookup>[0]): Promise<'processed' | 'pending' | 'failed' | null> {
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

/**
 * Cron and *Check now*: asks the gateway about attempts still pending after `olderThanMinutes` (10).
 * *Check now* passes the session business and its return to look at that return's attempt only.
 */
export async function checkPendingReturnRefunds(opts?: {
  olderThanMinutes?: number;
  businessId?: string;
  returnId?: string;
  fetchStatus?: StatusLookup;
  /**
   * Re-sends an attempt that never got a refund id (Razorpay always; Easebuzz when it has no refund
   * under our key); defaults to the business's gateway keys.
   */
  resubmit?: GatewayRequester;
}): Promise<{ checked: number; processed: number; failed: number }> {
  const minutes = opts?.olderThanMinutes ?? 10;
  const fetchStatus = opts?.fetchStatus ?? gatewayStatus;
  const rows = await getPool().query<PendingRow>(
    `SELECT id, business_id, provider, provider_payment_id, provider_refund_id, idempotency_key, amount::text,
            failure_reason, updated_at <= NOW() - make_interval(mins => $4::int) AS refusal_aged
       FROM return_gateway_refunds
      WHERE status = 'pending' AND provider_payment_id IS NOT NULL
        AND created_at <= NOW() - make_interval(mins => $1::int)
        AND ($2::uuid IS NULL OR business_id = $2::uuid)
        AND ($3::uuid IS NULL OR order_return_id = $3::uuid)
      ORDER BY created_at
      LIMIT 200`,
    [minutes, opts?.businessId ?? null, opts?.returnId ?? null, REFUSAL_WAIT_MINUTES],
  );
  const out = { checked: 0, processed: 0, failed: 0 };
  const resend = async (row: PendingRow) => {
    const given = opts?.resubmit;
    const sent = await sendAttempt(
      {
        businessId: row.business_id,
        rowId: row.id,
        provider: row.provider,
        providerPaymentId: row.provider_payment_id,
        amount: Number(row.amount),
        idempotencyKey: row.idempotency_key,
        fresh: false,
      },
      given ? async () => given : defaultRequester(row.provider, row.business_id),
      fetchStatus,
      'system',
      null,
    );
    if (sent.status === 'processed') out.processed += 1;
    if (sent.status === 'failed') out.failed += 1;
  };
  for (const row of rows.rows) {
    out.checked += 1;
    try {
      const refused = refusedNote(row);
      if (refused) {
        // Easebuzz refused its last send: looked up, never sent again (settleRefusedEasebuzz).
        const settled = await settleRefusedEasebuzz(
          { businessId: row.business_id, rowId: row.id, provider: row.provider, providerPaymentId: row.provider_payment_id, idempotencyKey: row.idempotency_key },
          { note: refused, aged: row.refusal_aged },
          fetchStatus,
          'system',
          null,
        );
        if (settled.status === 'processed') out.processed += 1;
        if (settled.status === 'failed') out.failed += 1;
        continue;
      }
      if (row.provider === 'razorpay' && !row.provider_refund_id) {
        // The first send never answered: Razorpay returns the same refund for the same key and amount,
        // so sending it again cannot refund twice.
        await resend(row);
        continue;
      }
      const status = await fetchStatus(row);
      if (status == null && row.provider === 'easebuzz' && !row.provider_refund_id) {
        // Easebuzz has no refund under our key and never refused this attempt, so the first send never
        // reached it (a lookup that could not answer throws instead). The Easebuzz requester looks the key
        // up again before sending.
        await resend(row);
        continue;
      }
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
