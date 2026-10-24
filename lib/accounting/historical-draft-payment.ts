/**
 * Stop finalization of a draft that already carries payment state from before
 * payments were limited to final documents. This does not repair, delete, or
 * repost anything.
 */
export const HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW = 'HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW';

/** Same rupee tolerance as invoice payment-status derivation. */
const INR_EPS = 0.01;

type SqlQueryable = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
};

export function historicalDraftPaymentReviewError(document: 'invoice' | 'purchase'): {
  error: string;
  code: typeof HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW;
} {
  const label = document === 'invoice' ? 'invoice' : 'purchase';
  return {
    error: `This draft ${label} contains historical payment information and cannot be finalized automatically until the payment and accounting are reconciled.`,
    code: HISTORICAL_DRAFT_PAYMENT_REQUIRES_REVIEW,
  };
}

function paymentStatusShowsPayment(status: unknown): boolean {
  const value = String(status ?? '').trim().toLowerCase();
  return value === 'paid' || value === 'partially_paid';
}

/**
 * A soft-deleted payment row blocks finalization only when the document totals
 * still say a payment happened (`paid_amount` or `payment_status`). A deleted
 * row left on an unpaid draft, which is what draft deletion leaves behind, does
 * not block. An active payment row always blocks.
 */
export async function historicalDraftPaymentBlock(
  db: SqlQueryable,
  args: {
    businessId: string;
    referenceType: 'invoice' | 'purchase';
    documentId: string;
  }
): Promise<ReturnType<typeof historicalDraftPaymentReviewError> | null> {
  const table = args.referenceType === 'invoice' ? 'invoices' : 'purchases';
  const doc = await db.query(
    `SELECT COALESCE(paid_amount, 0)::float8 AS paid_amount, payment_status
       FROM ${table}
      WHERE id = $1 AND business_id = $2`,
    [args.documentId, args.businessId]
  );
  const row = doc.rows[0];
  if (!row) return null;

  const paidAmount = Number(row.paid_amount) || 0;
  const totalsShowPayment = paidAmount > INR_EPS || paymentStatusShowsPayment(row.payment_status);

  const pays = await db.query(
    `SELECT COUNT(*) FILTER (WHERE deleted_at IS NULL AND status = 'active')::int AS active_count
       FROM payments
      WHERE business_id = $1 AND reference_type = $2 AND reference_id = $3`,
    [args.businessId, args.referenceType, args.documentId]
  );
  const activeCount = Number(pays.rows[0]?.active_count) || 0;

  if (totalsShowPayment || activeCount > 0) {
    return historicalDraftPaymentReviewError(args.referenceType);
  }
  return null;
}
