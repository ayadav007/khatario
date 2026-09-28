import type { PoolClient } from 'pg';
import { deriveInvoicePaymentStatus } from '@/lib/invoice-payment-status';
import { round2 } from '@/lib/invoices/line-gst';

/**
 * Amount still due on an invoice: its value, plus active debit notes, less active credit
 * notes, receipts, advances adjusted and TDS the customer withheld. Recomputed from source rows so payments and notes never overwrite
 * each other's effect.
 */
export async function recomputeInvoiceBalance(
  client: PoolClient,
  invoiceId: string,
  businessId: string
): Promise<{ grand_total: number; paid_amount: number; balance_amount: number; payment_status: string } | null> {
  const res = await client.query(
    `SELECT i.grand_total, i.paid_amount, i.status, COALESCE(i.tds_received, 0) AS tds_received,
            COALESCE(i.advance_adjusted, 0) AS advance_adjusted,
            COALESCE((SELECT SUM(grand_total) FROM debit_notes
                       WHERE invoice_id = i.id AND business_id = i.business_id AND status = 'active'), 0) AS debited,
            COALESCE((SELECT SUM(grand_total) FROM credit_notes
                       WHERE invoice_id = i.id AND business_id = i.business_id AND status = 'active'), 0) AS credited
       FROM invoices i
      WHERE i.id = $1 AND i.business_id = $2`,
    [invoiceId, businessId]
  );
  const row = res.rows[0];
  if (!row) return null;
  if (row.status === 'cancelled') {
    return { grand_total: Number(row.grand_total), paid_amount: Number(row.paid_amount), balance_amount: 0, payment_status: 'unpaid' };
  }

  const grand = Number(row.grand_total) || 0;
  const paid = Number(row.paid_amount) || 0;
  const settled = paid + (Number(row.tds_received) || 0) + (Number(row.advance_adjusted) || 0);
  const balance = Math.max(0, round2(grand + Number(row.debited) - Number(row.credited) - settled));
  const status = deriveInvoicePaymentStatus(grand, settled, balance);

  await client.query(
    `UPDATE invoices SET balance_amount = $1, payment_status = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3 AND business_id = $4`,
    [balance, status, invoiceId, businessId]
  );
  return { grand_total: grand, paid_amount: paid, balance_amount: balance, payment_status: status };
}
