import type { PoolClient } from 'pg';
import { hashReplayPayload, type OfflineReplayLogRow } from '@/lib/offline-sync/types';
import {
  findReplayLog,
  insertReplayLogPending,
  lockReplayLogRow,
  markReplayCompleted,
} from '@/lib/offline-sync/replay-log-repository';
import { activeLedgerLineSql, reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { recomputeInvoiceBalance } from '@/lib/invoices/invoice-balance';
import { recomputePurchaseBalance } from '@/lib/purchases/purchase-balance';
import { cancelTdsTransactions } from '@/lib/purchases/cancel-purchase';

/**
 * Whole reversal of a posted payment (Phase 4.4).
 *
 * The payment row and its voucher are kept. The voucher's lines get exact mirrors (linked in
 * ledger_entry_reversals) dated on the reversal date; the payment is marked reversed with a
 * payment_reversals record; the party balance gets back `amount + tds`; an active invoice or bill
 * gets its paid and TDS totals reduced and its balance recomputed. A payment against a cancelled
 * invoice only loses the customer credit it left behind. Undeposited supplier TDS rows are
 * cancelled. Payments without their own voucher, store-linked payments, and anything whose
 * posting or totals do not match the payment are refused, never partially reversed.
 */

export const PAYMENT_REVERSE_PERMISSION = { module: 'payment_reversals', action: 'create' } as const;
export const PAYMENT_REVERSAL_ACTION = 'payments.reverse';
const REASON_MAX_LENGTH = 500;
const EPS = 0.005;

export type PaymentReversalErrorCode =
  | 'PAYMENT_NOT_FOUND'
  | 'PAYMENT_DELETED'
  | 'PAYMENT_ALREADY_REVERSED'
  | 'PAYMENT_STORE_LINKED'
  | 'PAYMENT_HAS_NO_VOUCHER'
  | 'PAYMENT_POSTING_ALREADY_REVERSED'
  | 'PAYMENT_VOUCHER_MISMATCH'
  | 'PAYMENT_DOCUMENT_NOT_FOUND'
  | 'PAYMENT_DOCUMENT_MISMATCH'
  | 'PAYMENT_DOCUMENT_STATE_UNSUPPORTED'
  | 'PAYMENT_DOCUMENT_TOTALS_INCONSISTENT'
  | 'PAYMENT_TDS_DEPOSITED'
  | 'PAYMENT_TDS_SEPARATELY_POSTED';

export class PaymentReversalError extends Error {
  constructor(
    readonly status: number,
    readonly code: PaymentReversalErrorCode,
    message: string
  ) {
    super(message);
    this.name = 'PaymentReversalError';
  }

  toBody(): { error: string; code: PaymentReversalErrorCode } {
    return { error: this.message, code: this.code };
  }
}

const refuse = (status: number, code: PaymentReversalErrorCode, message: string) =>
  new PaymentReversalError(status, code, message);

/** Trimmed reason, or null when missing/blank. Longer reasons are cut to the stored limit. */
export function parseReversalReason(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, REASON_MAX_LENGTH) : null;
}

type Queryable = Pick<PoolClient, 'query'>;

type PaymentRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  type: 'receivable' | 'payable';
  customer_id: string | null;
  supplier_id: string | null;
  reference_type: string | null;
  reference_id: string | null;
  amount: string;
  tds_amount: string | null;
  status: string;
  deleted_at: Date | null;
};

export type PaymentDocumentEffect = 'document_reopened' | 'cancelled_invoice_credit' | 'on_account';

export type PaymentReversalPlan = {
  payment: PaymentRow;
  amount: number;
  tds: number;
  lineCount: number;
  document: { kind: 'invoice' | 'purchase'; id: string } | null;
  effect: PaymentDocumentEffect;
  tdsTransactionIds: string[];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Decides whether the payment can be reversed and how. With `lock`, every row the reversal will
 * change is locked FOR UPDATE on the caller's transaction, so the plan stays true until COMMIT.
 */
export async function assessPaymentReversal(
  q: Queryable,
  businessId: string,
  paymentId: string,
  opts: { lock: boolean }
): Promise<PaymentReversalPlan> {
  const forUpdate = opts.lock ? 'FOR UPDATE' : '';
  const payment = (
    await q.query<PaymentRow>(
      `SELECT id, business_id, branch_id, type, customer_id, supplier_id, reference_type, reference_id,
              amount, tds_amount, status, deleted_at
         FROM payments WHERE id = $1 AND business_id = $2 ${forUpdate}`,
      [paymentId, businessId]
    )
  ).rows[0];
  if (!payment) throw refuse(404, 'PAYMENT_NOT_FOUND', 'Payment not found');
  if (payment.deleted_at) {
    throw refuse(409, 'PAYMENT_DELETED', 'This payment has been deleted and cannot be reversed.');
  }
  if (payment.status === 'reversed') {
    throw refuse(409, 'PAYMENT_ALREADY_REVERSED', 'This payment has already been reversed.');
  }

  const store = await q.query(
    `SELECT 1 FROM store_orders WHERE business_id = $1 AND receipt_payment_id = $2
     UNION ALL
     SELECT 1 FROM store_payment_refunds WHERE business_id = $1 AND payment_id = $2
     LIMIT 1`,
    [businessId, paymentId]
  );
  if (store.rows.length > 0) {
    throw refuse(
      409,
      'PAYMENT_STORE_LINKED',
      'This payment belongs to an online-store order. Refund or cancel it from the store order instead.'
    );
  }

  const amount = round2(Number(payment.amount) || 0);
  const tds = round2(Number(payment.tds_amount) || 0);
  const posting = (
    await q.query<{ total: number; linked: number; active: number; dr: string; cr: string }>(
      `SELECT COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE NOT (${activeLedgerLineSql('l')}))::int AS linked,
              COUNT(*) FILTER (WHERE ${activeLedgerLineSql('l')})::int AS active,
              COALESCE(SUM(l.debit) FILTER (WHERE ${activeLedgerLineSql('l')}), 0) AS dr,
              COALESCE(SUM(l.credit) FILTER (WHERE ${activeLedgerLineSql('l')}), 0) AS cr
         FROM ledger_entry_lines l
        WHERE l.business_id = $1 AND l.voucher_type = 'payment' AND l.voucher_id = $2`,
      [businessId, paymentId]
    )
  ).rows[0];
  if (posting.total === 0) {
    throw refuse(
      409,
      'PAYMENT_HAS_NO_VOUCHER',
      payment.reference_type === 'purchase'
        ? 'This payment was posted inside its purchase bill and has no separate payment voucher. Correct it through the bill (purchase return or cancellation) instead.'
        : payment.reference_type === 'invoice'
          ? 'This payment was posted inside its invoice (cash sale) and has no separate payment voucher. Correct it through the invoice (credit note or cancellation) instead.'
          : 'This payment has no payment voucher to reverse.'
    );
  }
  if (posting.linked > 0) {
    throw refuse(
      409,
      'PAYMENT_POSTING_ALREADY_REVERSED',
      'This payment voucher has already been reversed by another correction and cannot be reversed again.'
    );
  }
  const settles = round2(amount + tds);
  const party = payment.type === 'receivable' ? payment.customer_id : payment.supplier_id;
  if (
    !party ||
    Math.abs(Number(posting.dr) - settles) > EPS ||
    Math.abs(Number(posting.cr) - settles) > EPS
  ) {
    throw refuse(
      409,
      'PAYMENT_VOUCHER_MISMATCH',
      'The posted payment voucher does not match the payment amount, so it cannot be reversed automatically.'
    );
  }

  let document: PaymentReversalPlan['document'] = null;
  let effect: PaymentDocumentEffect = 'on_account';
  if (payment.reference_type || payment.reference_id) {
    if (payment.reference_type === 'invoice' && payment.reference_id && payment.type === 'receivable') {
      const inv = (
        await q.query<{ status: string; customer_id: string | null; paid_amount: string; tds_received: string; deleted_at: Date | null }>(
          `SELECT status, customer_id, paid_amount, COALESCE(tds_received, 0) AS tds_received, deleted_at
             FROM invoices WHERE id = $1 AND business_id = $2 ${forUpdate}`,
          [payment.reference_id, businessId]
        )
      ).rows[0];
      if (!inv) throw refuse(409, 'PAYMENT_DOCUMENT_NOT_FOUND', 'The invoice this payment settles was not found.');
      if (inv.customer_id !== payment.customer_id) {
        throw refuse(409, 'PAYMENT_DOCUMENT_MISMATCH', 'The payment customer does not match its invoice.');
      }
      if (inv.status === 'cancelled') {
        effect = 'cancelled_invoice_credit';
      } else if (inv.status === 'final' && !inv.deleted_at) {
        if (Number(inv.paid_amount) + EPS < amount || Number(inv.tds_received) + EPS < tds) {
          throw refuse(
            409,
            'PAYMENT_DOCUMENT_TOTALS_INCONSISTENT',
            'The invoice paid or TDS total is lower than this payment, so it cannot be reversed automatically.'
          );
        }
        effect = 'document_reopened';
      } else {
        throw refuse(409, 'PAYMENT_DOCUMENT_STATE_UNSUPPORTED', `A payment against a ${inv.status} invoice cannot be reversed.`);
      }
      document = { kind: 'invoice', id: payment.reference_id };
    } else if (payment.reference_type === 'purchase' && payment.reference_id && payment.type === 'payable') {
      const pur = (
        await q.query<{ status: string; supplier_id: string | null; paid_amount: string; tds_deducted: string; deleted_at: Date | null }>(
          `SELECT status, supplier_id, paid_amount, COALESCE(tds_deducted, 0) AS tds_deducted, deleted_at
             FROM purchases WHERE id = $1 AND business_id = $2 ${forUpdate}`,
          [payment.reference_id, businessId]
        )
      ).rows[0];
      if (!pur) throw refuse(409, 'PAYMENT_DOCUMENT_NOT_FOUND', 'The purchase bill this payment settles was not found.');
      if (pur.supplier_id !== payment.supplier_id) {
        throw refuse(409, 'PAYMENT_DOCUMENT_MISMATCH', 'The payment supplier does not match its purchase bill.');
      }
      if (pur.status !== 'final' || pur.deleted_at) {
        throw refuse(409, 'PAYMENT_DOCUMENT_STATE_UNSUPPORTED', `A payment against a ${pur.status} purchase bill cannot be reversed.`);
      }
      if (Number(pur.paid_amount) + EPS < amount || Number(pur.tds_deducted) + EPS < tds) {
        throw refuse(
          409,
          'PAYMENT_DOCUMENT_TOTALS_INCONSISTENT',
          'The bill paid or TDS total is lower than this payment, so it cannot be reversed automatically.'
        );
      }
      effect = 'document_reopened';
      document = { kind: 'purchase', id: payment.reference_id };
    } else {
      throw refuse(409, 'PAYMENT_DOCUMENT_STATE_UNSUPPORTED', 'This payment reference cannot be reversed.');
    }
  }

  const tdsRows = (
    await q.query<{ id: string; is_deposited: boolean }>(
      `SELECT id, COALESCE(is_deposited, false) AS is_deposited
         FROM tds_transactions
        WHERE business_id = $1 AND payment_id = $2 AND status = 'active'
        ORDER BY id ${forUpdate}`,
      [businessId, paymentId]
    )
  ).rows;
  if (tdsRows.some((t) => t.is_deposited)) {
    throw refuse(
      409,
      'PAYMENT_TDS_DEPOSITED',
      'TDS deducted on this payment has already been deposited, so the payment cannot be reversed.'
    );
  }
  const tdsTransactionIds = tdsRows.map((t) => t.id);
  if (tdsTransactionIds.length > 0) {
    const separate = await q.query(
      `SELECT 1 FROM ledger_entry_lines l
        WHERE l.business_id = $1 AND l.voucher_type = 'tds' AND l.voucher_id = ANY($2::uuid[])
          AND ${activeLedgerLineSql('l')}
        LIMIT 1`,
      [businessId, tdsTransactionIds]
    );
    if (separate.rows.length > 0) {
      throw refuse(
        409,
        'PAYMENT_TDS_SEPARATELY_POSTED',
        'TDS on this payment was posted as a separate TDS entry. Reverse that TDS deduction first.'
      );
    }
  }

  return { payment, amount, tds, lineCount: posting.active, document, effect, tdsTransactionIds };
}

export type PaymentReversalRecord = Record<string, unknown> & { id: string; payment_id: string };

const REVERSAL_COLUMNS = `id, business_id, payment_id, reversal_date::text AS reversal_date, reason, amount, tds_amount,
  reversed_line_count, document_effect, cancelled_tds_transaction_ids, created_by, created_at`;

/** Applies a plan produced by `assessPaymentReversal(..., { lock: true })` on the same transaction. */
export async function executePaymentReversal(
  client: PoolClient,
  plan: PaymentReversalPlan,
  ctx: { businessId: string; actorId: string; reason: string; reversalDate: string }
): Promise<{ reversal: PaymentReversalRecord; payment: Record<string, unknown> }> {
  const { payment, amount, tds } = plan;
  const settles = round2(amount + tds);

  const reversedLines = await reverseVoucherLedgerEntries(client, {
    businessId: ctx.businessId,
    voucherType: 'payment',
    voucherId: payment.id,
    reason: `Payment reversed: ${ctx.reason}`,
    entryDate: ctx.reversalDate,
    actorId: ctx.actorId,
  });
  if (reversedLines !== plan.lineCount) {
    throw new Error(`Payment ${payment.id}: reversed ${reversedLines} of ${plan.lineCount} voucher lines`);
  }

  if (plan.effect === 'document_reopened' && plan.document?.kind === 'invoice') {
    await client.query(
      `UPDATE invoices
          SET paid_amount = COALESCE(paid_amount, 0) - $1, tds_received = COALESCE(tds_received, 0) - $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND business_id = $4`,
      [amount, tds, plan.document.id, ctx.businessId]
    );
    await recomputeInvoiceBalance(client, plan.document.id, ctx.businessId);
  } else if (plan.effect === 'document_reopened' && plan.document?.kind === 'purchase') {
    await client.query(
      `UPDATE purchases
          SET paid_amount = COALESCE(paid_amount, 0) - $1, tds_deducted = COALESCE(tds_deducted, 0) - $2,
              updated_at = CURRENT_TIMESTAMP
        WHERE id = $3 AND business_id = $4`,
      [amount, tds, plan.document.id, ctx.businessId]
    );
    await recomputePurchaseBalance(client, plan.document.id, ctx.businessId);
  }

  const partySql =
    payment.type === 'receivable'
      ? `UPDATE customers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`
      : `UPDATE suppliers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
          WHERE id = $2 AND business_id = $3`;
  const partyId = payment.type === 'receivable' ? payment.customer_id : payment.supplier_id;
  const partyRes = await client.query(partySql, [settles, partyId, ctx.businessId]);
  if (partyRes.rowCount !== 1) {
    throw new Error(`Payment ${payment.id}: party ${partyId} not found in business`);
  }

  await cancelTdsTransactions(client, {
    businessId: ctx.businessId,
    ids: plan.tdsTransactionIds,
    userId: ctx.actorId,
    reason: `Payment reversed: ${ctx.reason}`,
  });

  const reversal = (
    await client.query<PaymentReversalRecord>(
      `INSERT INTO payment_reversals (
         business_id, payment_id, reversal_date, reason, amount, tds_amount, reversed_line_count,
         document_effect, cancelled_tds_transaction_ids, created_by
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::uuid[], $10)
       RETURNING ${REVERSAL_COLUMNS}`,
      [
        ctx.businessId,
        payment.id,
        ctx.reversalDate,
        ctx.reason,
        amount,
        tds,
        reversedLines,
        plan.effect,
        plan.tdsTransactionIds,
        ctx.actorId,
      ]
    )
  ).rows[0];

  const updated = await client.query(
    `UPDATE payments
        SET status = 'reversed', reversed_at = CURRENT_TIMESTAMP, reversed_by = $3,
            reversal_reason = $4, reversal_id = $5
      WHERE id = $1 AND business_id = $2 AND status = 'active'
      RETURNING *`,
    [payment.id, ctx.businessId, ctx.actorId, ctx.reason, reversal.id]
  );
  if (updated.rowCount !== 1) {
    throw new Error(`Payment ${payment.id}: not active when marking reversed`);
  }
  return { reversal, payment: updated.rows[0] };
}

/** Current calendar date on the database clock, the same clock the period-lock trigger uses. */
export async function currentReversalDate(q: Queryable): Promise<string> {
  const res = await q.query<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
  return res.rows[0].d;
}

// --- Idempotency (offline_replay_log under the `payments.reverse:` namespace) ---------------

export function scopedReversalIdempotencyKey(key: string): string {
  return `${PAYMENT_REVERSAL_ACTION}:${key}`;
}

/** The reason is part of the request identity but is hashed only, like payment notes. */
export function reversalRequestFingerprint(paymentId: string, reason: string): {
  hash: string;
  storedPayload: Record<string, unknown>;
} {
  const storedPayload = { payment_id: paymentId };
  return { hash: hashReplayPayload({ ...storedPayload, reason }), storedPayload };
}

export type ReversalIdempotencyOutcome =
  | { kind: 'replay'; reversal: PaymentReversalRecord; payment: Record<string, unknown> }
  | { kind: 'conflict' }
  | { kind: 'unavailable' };

type ReversalReplayContext = { businessId: string; scopedKey: string; hash: string; paymentId: string };

async function resolveReversalRecord(
  q: Queryable,
  row: OfflineReplayLogRow,
  ctx: ReversalReplayContext
): Promise<ReversalIdempotencyOutcome> {
  if (
    row.business_id !== ctx.businessId ||
    row.idempotency_key !== ctx.scopedKey ||
    !row.idempotency_key.startsWith(`${PAYMENT_REVERSAL_ACTION}:`) ||
    row.action_type !== PAYMENT_REVERSAL_ACTION
  ) {
    return { kind: 'unavailable' };
  }
  if (row.request_hash !== ctx.hash) return { kind: 'conflict' };
  if (row.status !== 'completed' || row.entity_type !== 'payment_reversal' || !row.entity_id) {
    return { kind: 'unavailable' };
  }
  if (row.response_payload?.reversal_id !== row.entity_id || row.request_payload?.payment_id !== ctx.paymentId) {
    return { kind: 'unavailable' };
  }
  const reversal = (
    await q.query<PaymentReversalRecord>(
      `SELECT ${REVERSAL_COLUMNS} FROM payment_reversals
        WHERE id = $1 AND business_id = $2 AND payment_id = $3`,
      [row.entity_id, ctx.businessId, ctx.paymentId]
    )
  ).rows[0];
  if (!reversal) return { kind: 'unavailable' };
  const payment = (
    await q.query(
      `SELECT * FROM payments WHERE id = $1 AND business_id = $2 AND status = 'reversed' AND reversal_id = $3`,
      [ctx.paymentId, ctx.businessId, reversal.id]
    )
  ).rows[0];
  if (!payment) return { kind: 'unavailable' };
  return { kind: 'replay', reversal, payment };
}

/** Read-only lookup before any checks that depend on current data (period locks, payment state). */
export async function findReversalIdempotencyOutcome(
  q: Queryable,
  ctx: ReversalReplayContext
): Promise<ReversalIdempotencyOutcome | null> {
  const row = await findReplayLog(ctx.businessId, ctx.scopedKey);
  return row ? resolveReversalRecord(q, row, ctx) : null;
}

/** Claims the key inside the reversal transaction; a concurrent claim waits on the unique index. */
export async function claimReversalIdempotencyKey(
  client: PoolClient,
  input: ReversalReplayContext & { userId: string; storedPayload: Record<string, unknown> }
): Promise<{ claimed: true; rowId: string } | { claimed: false; outcome: ReversalIdempotencyOutcome }> {
  const inserted = await insertReplayLogPending(client, {
    businessId: input.businessId,
    idempotencyKey: input.scopedKey,
    actionType: PAYMENT_REVERSAL_ACTION,
    requestHash: input.hash,
    requestPayload: input.storedPayload,
    userId: input.userId,
  });
  if (inserted) return { claimed: true, rowId: inserted.id };
  const existing = await lockReplayLogRow(client, input.businessId, input.scopedKey);
  if (!existing) return { claimed: false, outcome: { kind: 'unavailable' } };
  return { claimed: false, outcome: await resolveReversalRecord(client, existing, input) };
}

export async function completeReversalIdempotencyKey(
  client: PoolClient,
  rowId: string,
  reversal: PaymentReversalRecord
): Promise<void> {
  await markReplayCompleted(
    client,
    rowId,
    { reversal_id: reversal.id, payment_id: reversal.payment_id },
    { type: 'payment_reversal', id: reversal.id }
  );
}
