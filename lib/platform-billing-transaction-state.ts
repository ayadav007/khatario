/**
 * Strict billing_transactions status transitions.
 * Allowed: pending → completed | failed, failed → completed (a retry on the same link can succeed),
 * and completed → refunded (only lib/platform-refunds.ts writes it, once the refunds against a payment
 * add up to everything that can be refunded; a partial refund leaves the payment `completed`).
 * Blocked: refunded → any other state, completed → anything else (including completed → completed),
 * and pending → refunded.
 */

export type BillingTxStatus = 'pending' | 'completed' | 'failed' | 'refunded';

export class BillingTransactionStateError extends Error {
  readonly code: string;
  readonly fromStatus: BillingTxStatus;
  readonly toStatus: BillingTxStatus;

  constructor(
    code: string,
    message: string,
    fromStatus: BillingTxStatus,
    toStatus: BillingTxStatus,
  ) {
    super(message);
    this.name = 'BillingTransactionStateError';
    this.code = code;
    this.fromStatus = fromStatus;
    this.toStatus = toStatus;
  }
}

const TERMINAL: ReadonlySet<BillingTxStatus> = new Set(['completed', 'refunded']);

const ALLOWED_FROM_PENDING: ReadonlySet<BillingTxStatus> = new Set([
  'completed',
  'failed',
]);

export function assertBillingTransactionTransition(
  fromStatus: BillingTxStatus,
  toStatus: BillingTxStatus,
): void {
  if (fromStatus === toStatus) {
    console.warn('[billing-tx] Blocked no-op/duplicate transition', {
      from: fromStatus,
      to: toStatus,
    });
    throw new BillingTransactionStateError(
      'INVALID_STATUS_TRANSITION',
      `Transaction is already ${fromStatus}`,
      fromStatus,
      toStatus,
    );
  }

  if (fromStatus === 'completed' && toStatus === 'refunded') {
    return;
  }

  if (TERMINAL.has(fromStatus)) {
    console.warn('[billing-tx] Blocked transition from terminal state', {
      from: fromStatus,
      to: toStatus,
    });
    throw new BillingTransactionStateError(
      'INVALID_STATUS_TRANSITION',
      `Cannot transition billing transaction from ${fromStatus} to ${toStatus}`,
      fromStatus,
      toStatus,
    );
  }

  if (fromStatus === 'pending' && ALLOWED_FROM_PENDING.has(toStatus)) {
    return;
  }

  if (fromStatus === 'failed' && toStatus === 'completed') {
    return;
  }

  console.warn('[billing-tx] Blocked unknown transition', {
    from: fromStatus,
    to: toStatus,
  });
  throw new BillingTransactionStateError(
    'INVALID_STATUS_TRANSITION',
    `Cannot transition billing transaction from ${fromStatus} to ${toStatus}`,
    fromStatus,
    toStatus,
  );
}

/**
 * The one way out of `refunded`: a payment that was refunded only up to what could be refunded while upgrade credit
 * was spent on it, and whose credit is released because the upgrade that used it was refunded in full (lib/platform-refunds.ts).
 * It has refundable money again, so it goes back to `completed`. Nothing else may use this: `assertBillingTransactionTransition`
 * still blocks refunded -> anything, and this does not reactivate, renumber or notify anything.
 */
export function assertCreditReleaseReopen(fromStatus: BillingTxStatus, toStatus: BillingTxStatus): void {
  if (fromStatus === 'refunded' && toStatus === 'completed') return;
  throw new BillingTransactionStateError(
    'INVALID_STATUS_TRANSITION',
    `Cannot reopen a billing transaction from ${fromStatus} to ${toStatus}`,
    fromStatus,
    toStatus,
  );
}

/** True for the unique violation raised by uq_billing_tx_completed_payment_ref (one gateway payment, one checkout). */
export function isPaymentReferenceViolation(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string } | null;
  return e?.code === '23505' && e?.constraint === 'uq_billing_tx_completed_payment_ref';
}
