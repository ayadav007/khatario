/**
 * "Mark reviewed" for a refund that was flagged (metadata.needs_review). Records who and when in the
 * refund row's metadata; the money, the refund's status and the customer's plan are not touched.
 */

import { queryOne } from '@/lib/db';
import { logAdminAction } from '@/lib/platform-auth';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function markRefundReviewed(params: {
  refundId: string;
  paymentId: string;
  businessId: string;
  adminId: string;
}): Promise<'reviewed' | 'already_reviewed' | 'not_found'> {
  const { refundId, paymentId, businessId, adminId } = params;
  if (![refundId, paymentId, businessId, adminId].every((v) => UUID.test(v))) return 'not_found';

  const updated = await queryOne<{ id: string }>(
    `UPDATE billing_transactions
     SET metadata = COALESCE(metadata, '{}'::jsonb)
                    || jsonb_build_object('reviewed_by', $4::text, 'reviewed_at', to_char(CURRENT_TIMESTAMP AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
     WHERE id = $1::uuid AND type = 'refund' AND business_id = $2::uuid
       AND metadata->>'refund_of' = $3
       AND (metadata->>'needs_review') = 'true'
       AND metadata->>'reviewed_at' IS NULL
     RETURNING id::text AS id`,
    [refundId, businessId, paymentId, adminId],
  );
  if (updated) {
    await logAdminAction(adminId, 'review_refund', 'billing_transaction', refundId, {
      business_id: businessId,
      refund_of: paymentId,
    });
    return 'reviewed';
  }
  const existing = await queryOne<{ reviewed: boolean }>(
    `SELECT (metadata->>'reviewed_at' IS NOT NULL) AS reviewed FROM billing_transactions
     WHERE id = $1::uuid AND type = 'refund' AND business_id = $2::uuid AND metadata->>'refund_of' = $3
       AND (metadata->>'needs_review') = 'true'`,
    [refundId, businessId, paymentId],
  );
  if (existing?.reviewed) return 'already_reviewed';
  return 'not_found';
}
