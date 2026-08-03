/**
 * Strict billing_transactions status transitions.
 * Allowed: pending → completed | failed
 * Blocked: terminal → any other state (including completed → completed)
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

const TERMINAL: ReadonlySet<BillingTxStatus> = new Set([
  'completed',
  'failed',
  'refunded',
]);

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
