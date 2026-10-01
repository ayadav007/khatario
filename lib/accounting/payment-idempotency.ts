import type { PoolClient } from 'pg';
import type { NextRequest } from 'next/server';
import { hashReplayPayload } from '@/lib/offline-sync/types';
import type { OfflineReplayLogRow } from '@/lib/offline-sync/types';
import {
  findReplayLog,
  insertReplayLogPending,
  lockReplayLogRow,
  markReplayCompleted,
} from '@/lib/offline-sync/replay-log-repository';

/**
 * Retry protection for POST /api/payments.
 *
 * Keys live in `offline_replay_log` (unique per business) under a `payments.create:` namespace so
 * they cannot collide with offline replay keys. A row is inserted inside the payment transaction
 * and marked completed just before COMMIT, so a rolled-back payment leaves no row and a committed
 * row always names a payment that exists. Requests without a key are not deduplicated.
 */
export const PAYMENT_IDEMPOTENCY_ACTION = 'payments.create';
export const PAYMENT_IDEMPOTENCY_HEADER = 'X-Idempotency-Key';
const PAYMENT_IDEMPOTENCY_ALT_HEADER = 'Idempotency-Key';
const KEY_MAX_LENGTH = 200;
const KEY_RE = /^[\x21-\x7e]+$/;

export const IDEMPOTENCY_KEY_INVALID = 'IDEMPOTENCY_KEY_INVALID';
export const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';

export type PaymentIdempotencyKeyResult =
  | { ok: true; key: string | null }
  | { ok: false; body: { error: string; code: typeof IDEMPOTENCY_KEY_INVALID } };

/** Reads the repo's `X-Idempotency-Key` header; the standard `Idempotency-Key` is accepted as an alias. */
export function readPaymentIdempotencyKey(request: NextRequest): PaymentIdempotencyKeyResult {
  const primary = request.headers.get(PAYMENT_IDEMPOTENCY_HEADER);
  const alias = request.headers.get(PAYMENT_IDEMPOTENCY_ALT_HEADER);
  if (primary === null && alias === null) return { ok: true, key: null };
  const a = primary?.trim() ?? null;
  const b = alias?.trim() ?? null;
  if (a !== null && b !== null && a !== b) {
    return {
      ok: false,
      body: {
        error: `${PAYMENT_IDEMPOTENCY_HEADER} and ${PAYMENT_IDEMPOTENCY_ALT_HEADER} must match when both are sent`,
        code: IDEMPOTENCY_KEY_INVALID,
      },
    };
  }
  const key = a ?? b ?? '';
  if (!key || key.length > KEY_MAX_LENGTH || !KEY_RE.test(key)) {
    return {
      ok: false,
      body: {
        error: `${PAYMENT_IDEMPOTENCY_HEADER} must be 1-${KEY_MAX_LENGTH} printable characters without spaces`,
        code: IDEMPOTENCY_KEY_INVALID,
      },
    };
  }
  return { ok: true, key };
}

export function scopedPaymentIdempotencyKey(key: string): string {
  return `${PAYMENT_IDEMPOTENCY_ACTION}:${key}`;
}

/** Fields that decide what gets posted. Notes are hashed but not stored in the log row. */
export type PaymentFingerprintInput = {
  type: 'receivable' | 'payable';
  referenceType: 'invoice' | 'purchase' | null;
  referenceId: string | null;
  customerId: string | null;
  supplierId: string | null;
  branchId: string | null;
  amount: number;
  tdsAmount: number;
  tdsSection: string | null;
  paymentMode: string;
  paymentDay: string | null;
  notes: string | null;
};

const cents = (n: number) => Math.round(n * 100) / 100;

export function paymentRequestFingerprint(input: PaymentFingerprintInput): {
  hash: string;
  storedPayload: Record<string, unknown>;
} {
  const storedPayload = {
    type: input.type,
    reference_type: input.referenceType,
    reference_id: input.referenceId,
    customer_id: input.customerId,
    supplier_id: input.supplierId,
    branch_id: input.branchId,
    amount: cents(input.amount),
    tds_amount: cents(input.tdsAmount),
    tds_section: input.tdsSection,
    payment_mode: input.paymentMode,
    payment_date: input.paymentDay,
  };
  const hash = hashReplayPayload({ ...storedPayload, notes: input.notes });
  return { hash, storedPayload };
}

export function idempotencyKeyReusedError(): { error: string; code: typeof IDEMPOTENCY_KEY_REUSED } {
  return {
    error: 'This idempotency key was already used for a different payment request.',
    code: IDEMPOTENCY_KEY_REUSED,
  };
}

export const IDEMPOTENCY_REPLAY_UNAVAILABLE = 'IDEMPOTENCY_REPLAY_UNAVAILABLE';

export function idempotencyReplayUnavailableError(): {
  error: string;
  code: typeof IDEMPOTENCY_REPLAY_UNAVAILABLE;
} {
  return {
    error: 'This idempotency key cannot be replayed. Use a new key to record a new payment.',
    code: IDEMPOTENCY_REPLAY_UNAVAILABLE,
  };
}

/**
 * `unavailable` covers every ownership, scope, or consistency failure. It carries no payment
 * data so a bad record can never leak another business's payment.
 */
export type PaymentIdempotencyOutcome =
  | { kind: 'replay'; payment: Record<string, unknown> }
  | { kind: 'conflict' }
  | { kind: 'unavailable' };

type Queryable = Pick<PoolClient, 'query'>;

type ReplayContext = { businessId: string; scopedKey: string; hash: string };

function checkRecord(row: OfflineReplayLogRow, ctx: ReplayContext): 'ok' | 'conflict' | 'unavailable' {
  if (
    row.business_id !== ctx.businessId ||
    row.idempotency_key !== ctx.scopedKey ||
    !row.idempotency_key.startsWith(`${PAYMENT_IDEMPOTENCY_ACTION}:`) ||
    row.action_type !== PAYMENT_IDEMPOTENCY_ACTION
  ) {
    return 'unavailable';
  }
  if (row.request_hash !== ctx.hash) return 'conflict';
  if (row.status !== 'completed' || row.entity_type !== 'payment' || !row.entity_id) return 'unavailable';
  const recorded = row.response_payload?.payment_id;
  if (recorded !== undefined && recorded !== row.entity_id) return 'unavailable';
  return 'ok';
}

const sameId = (stored: unknown, actual: unknown) => (stored ?? null) === (actual ?? null);

/** The payment must still be the one the stored request describes. */
function paymentMatchesRequest(payment: Record<string, any>, stored: Record<string, any>, day: string): boolean {
  if (payment.type !== stored.type) return false;
  if (!sameId(stored.reference_type, payment.reference_type)) return false;
  if (!sameId(stored.reference_id, payment.reference_id)) return false;
  if (stored.customer_id != null && stored.customer_id !== payment.customer_id) return false;
  if (stored.supplier_id != null && stored.supplier_id !== payment.supplier_id) return false;
  if (cents(Number(payment.amount)) !== stored.amount) return false;
  if (cents(Number(payment.tds_amount ?? 0)) !== stored.tds_amount) return false;
  if (!sameId(stored.tds_section, payment.tds_section)) return false;
  if (payment.payment_mode !== stored.payment_mode) return false;
  if (stored.payment_date != null && stored.payment_date !== day) return false;
  return true;
}

async function resolveRecord(
  q: Queryable,
  row: OfflineReplayLogRow,
  ctx: ReplayContext
): Promise<PaymentIdempotencyOutcome> {
  const check = checkRecord(row, ctx);
  if (check !== 'ok') return { kind: check };

  const res = await q.query(
    `SELECT p.*, p.payment_date::text AS __payment_day
       FROM payments p
      WHERE p.id = $1 AND p.business_id = $2`,
    [row.entity_id, ctx.businessId]
  );
  const found = res.rows[0] as Record<string, any> | undefined;
  if (!found) return { kind: 'unavailable' };
  const { __payment_day: day, ...payment } = found;
  if (!paymentMatchesRequest(payment, row.request_payload ?? {}, day)) return { kind: 'unavailable' };
  return { kind: 'replay', payment };
}

/**
 * Read-only check before any validation that depends on current data (period locks, balances).
 * Returns null when this business has no record for the key, so the request proceeds.
 */
export async function findPaymentIdempotencyOutcome(
  q: Queryable,
  ctx: ReplayContext
): Promise<PaymentIdempotencyOutcome | null> {
  const row = await findReplayLog(ctx.businessId, ctx.scopedKey);
  return row ? resolveRecord(q, row, ctx) : null;
}

/**
 * Claims the key inside the payment transaction. A concurrent claim on the same key blocks on
 * the unique index until the first transaction commits or rolls back.
 */
export async function claimPaymentIdempotencyKey(
  client: PoolClient,
  input: { businessId: string; userId: string; scopedKey: string; hash: string; storedPayload: Record<string, unknown> }
): Promise<{ claimed: true; rowId: string } | { claimed: false; outcome: PaymentIdempotencyOutcome }> {
  const inserted = await insertReplayLogPending(client, {
    businessId: input.businessId,
    idempotencyKey: input.scopedKey,
    actionType: PAYMENT_IDEMPOTENCY_ACTION,
    requestHash: input.hash,
    requestPayload: input.storedPayload,
    userId: input.userId,
  });
  if (inserted) return { claimed: true, rowId: inserted.id };

  const existing = await lockReplayLogRow(client, input.businessId, input.scopedKey);
  if (!existing) return { claimed: false, outcome: { kind: 'unavailable' } };
  return { claimed: false, outcome: await resolveRecord(client, existing, input) };
}

export async function completePaymentIdempotencyKey(
  client: PoolClient,
  rowId: string,
  paymentId: string
): Promise<void> {
  await markReplayCompleted(client, rowId, { payment_id: paymentId }, { type: 'payment', id: paymentId });
}
