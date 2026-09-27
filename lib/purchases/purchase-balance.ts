import type { PoolClient } from 'pg';
import { round2 } from '@/lib/invoices/line-gst';
import { supplierPayableAmount } from '@/lib/purchases/supplier-payable';

const INR_EPS = 0.01;

/**
 * Amount still owed to the supplier on a bill: the payable (net of reverse-charge GST),
 * less cash paid and TDS deducted. Recomputed from the row so payments and TDS never
 * overwrite each other's effect.
 */
export async function recomputePurchaseBalance(
  client: PoolClient,
  purchaseId: string,
  businessId: string
): Promise<{ payable: number; paid_amount: number; tds_deducted: number; balance_amount: number; payment_status: string } | null> {
  const res = await client.query(
    `SELECT grand_total, tax_total, is_reverse_charge, paid_amount, COALESCE(tds_deducted, 0) AS tds_deducted
       FROM purchases
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
    [purchaseId, businessId]
  );
  const row = res.rows[0];
  if (!row) return null;

  const payable = supplierPayableAmount(row.grand_total, row.tax_total, row.is_reverse_charge);
  const paid = Number(row.paid_amount) || 0;
  const tds = Number(row.tds_deducted) || 0;
  const balance = Math.max(0, round2(payable - paid - tds));
  const settled = paid + tds;
  const status = settled <= INR_EPS ? 'unpaid' : balance <= INR_EPS ? 'paid' : 'partially_paid';

  await client.query(
    `UPDATE purchases SET balance_amount = $1, payment_status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND business_id = $4`,
    [balance, status, purchaseId, businessId]
  );
  return { payable, paid_amount: paid, tds_deducted: tds, balance_amount: balance, payment_status: status };
}

/** Outstanding on a bill before a new settlement is applied (for overpayment checks). */
export function purchaseOutstanding(row: {
  grand_total: number | string | null;
  tax_total: number | string | null;
  is_reverse_charge: boolean | null;
  paid_amount: number | string | null;
  tds_deducted?: number | string | null;
}): number {
  const payable = supplierPayableAmount(row.grand_total, row.tax_total, row.is_reverse_charge);
  return Math.max(0, round2(payable - (Number(row.paid_amount) || 0) - (Number(row.tds_deducted) || 0)));
}
