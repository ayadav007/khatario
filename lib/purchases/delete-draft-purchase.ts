import type { PoolClient } from 'pg';
import { reverseVouchers } from '@/lib/ledger-reversal';
import { releaseDocumentAdvances } from '@/lib/accounting/advance-service';
import { cancelTdsTransactions, PurchaseCancelError } from '@/lib/purchases/cancel-purchase';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Deletes a draft purchase on the caller's transaction.
 *
 * A draft never posts its payable, so the supplier balance only carries what was settled
 * against it: each payment lowered the balance by its amount, each TDS row by its tds_amount
 * (whether deducted on its own or inside a payment), and each advance adjustment by its amount.
 * Deleting the draft reverses exactly those postings and adds the same amounts back, so the
 * supplier balance returns to where it was before the draft:
 *   - payment and TDS vouchers are reversed (mirror lines linked in ledger_entry_reversals);
 *   - advance adjustments are released back to their advances;
 *   - TDS rows are marked cancelled (deposited TDS refuses the delete);
 *   - payments are soft-deleted (hard-deleted when the business has no soft delete);
 *   - the draft is soft-deleted, or hard-deleted when the business has no soft delete. A draft
 *     that carried advance adjustments is kept as status 'cancelled' instead of hard-deleted,
 *     because the released adjustment rows still reference it.
 */
export async function deleteDraftPurchase(
  client: PoolClient,
  p: { businessId: string; purchaseId: string; userId: string; softDelete: boolean }
): Promise<{ supplierRestored: number; releasedAdvance: number; mode: 'soft_deleted' | 'deleted' | 'cancelled' }> {
  const purchase = (
    await client.query(
      `SELECT id, status, supplier_id, bill_number FROM purchases
        WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL FOR UPDATE`,
      [p.purchaseId, p.businessId]
    )
  ).rows[0];
  if (!purchase) throw new PurchaseCancelError(404, 'PURCHASE_NOT_FOUND', 'Purchase not found');
  if (purchase.status === 'final' || purchase.status === 'cancelled') {
    throw new PurchaseCancelError(409, 'PURCHASE_STATE_CHANGED', 'Purchase changed while deleting; reload and try again');
  }

  const returns = await client.query(
    `SELECT 1 FROM purchase_returns
      WHERE purchase_id = $1 AND business_id = $2 AND COALESCE(status, 'final') <> 'cancelled' LIMIT 1`,
    [p.purchaseId, p.businessId]
  );
  if (returns.rows.length > 0) {
    throw new PurchaseCancelError(
      400,
      'PURCHASE_HAS_RETURNS',
      'Cannot delete purchase that has associated returns. Please delete the returns first.'
    );
  }

  const tds = (
    await client.query<{ id: string; tds_amount: string; is_deposited: boolean }>(
      `SELECT id, tds_amount, COALESCE(is_deposited, false) AS is_deposited
         FROM tds_transactions WHERE business_id = $1 AND purchase_id = $2 AND status = 'active' FOR UPDATE`,
      [p.businessId, p.purchaseId]
    )
  ).rows;
  if (tds.some((r) => r.is_deposited)) {
    throw new PurchaseCancelError(
      409,
      'BILL_TDS_DEPOSITED',
      'TDS on this bill is already deposited. Correct it through a TDS return revision instead of deleting the bill.'
    );
  }

  const payments = (
    await client.query<{ id: string; amount: string }>(
      `SELECT id, amount FROM payments
        WHERE business_id = $1 AND reference_type = 'purchase' AND reference_id = $2 AND deleted_at IS NULL
        FOR UPDATE`,
      [p.businessId, p.purchaseId]
    )
  ).rows;

  const reason = `Draft purchase ${purchase.bill_number || ''} deleted`.replace(/\s+/g, ' ');
  await reverseVouchers(client, {
    businessId: p.businessId,
    voucherType: 'payment',
    voucherIds: payments.map((r) => r.id),
    reason,
    actorId: p.userId,
  });
  await reverseVouchers(client, {
    businessId: p.businessId,
    voucherType: 'tds',
    voucherIds: tds.map((r) => r.id),
    reason,
    actorId: p.userId,
  });
  const { released } = await releaseDocumentAdvances(client, {
    businessId: p.businessId,
    userId: p.userId,
    purchaseId: p.purchaseId,
    reason,
  });

  const supplierRestored = round2(
    payments.reduce((s, r) => s + (Number(r.amount) || 0), 0) +
      tds.reduce((s, r) => s + (Number(r.tds_amount) || 0), 0) +
      released
  );
  if (purchase.supplier_id && supplierRestored !== 0) {
    await client.query(
      `UPDATE suppliers SET current_balance = current_balance + $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [supplierRestored, purchase.supplier_id, p.businessId]
    );
  }

  await cancelTdsTransactions(client, { businessId: p.businessId, ids: tds.map((r) => r.id), userId: p.userId, reason });
  await client.query(
    p.softDelete
      ? `UPDATE payments SET deleted_at = CURRENT_TIMESTAMP
          WHERE reference_type = 'purchase' AND reference_id = $1 AND business_id = $2 AND deleted_at IS NULL`
      : `DELETE FROM payments WHERE reference_type = 'purchase' AND reference_id = $1 AND business_id = $2`,
    [p.purchaseId, p.businessId]
  );
  await client.query(
    `UPDATE quantity_requests SET purchase_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE purchase_id = $1`,
    [p.purchaseId]
  );
  await client.query(
    `UPDATE purchases SET paid_amount = 0, tds_deducted = 0, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1 AND business_id = $2`,
    [p.purchaseId, p.businessId]
  );

  if (p.softDelete) {
    await client.query(`UPDATE purchases SET deleted_at = CURRENT_TIMESTAMP WHERE id = $1 AND business_id = $2`, [
      p.purchaseId,
      p.businessId,
    ]);
    return { supplierRestored, releasedAdvance: released, mode: 'soft_deleted' };
  }

  const referenced = await client.query(
    `SELECT 1 FROM advance_adjustments WHERE business_id = $1 AND purchase_id = $2 LIMIT 1`,
    [p.businessId, p.purchaseId]
  );
  if (referenced.rows.length > 0) {
    await client.query(
      `UPDATE purchases
          SET status = 'cancelled', balance_amount = 0,
              cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3, cancellation_reason = $4
        WHERE id = $1 AND business_id = $2`,
      [p.purchaseId, p.businessId, p.userId, reason]
    );
    return { supplierRestored, releasedAdvance: released, mode: 'cancelled' };
  }
  await client.query(`DELETE FROM purchases WHERE id = $1 AND business_id = $2`, [p.purchaseId, p.businessId]);
  return { supplierRestored, releasedAdvance: released, mode: 'deleted' };
}
