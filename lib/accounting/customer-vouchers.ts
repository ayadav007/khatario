import type { PoolClient } from 'pg';

/**
 * Which customer a ledger voucher belongs to.
 *
 * Ledger lines carry no party; the customer comes from the document the voucher was posted for.
 * This is the same attribution the receivables report uses (lib/reports/party-ledger-docs.ts),
 * kept here as one relation so posting code can ask it for a single voucher or a single customer.
 */

/** Rows (voucher_type text, voucher_id uuid, customer_id uuid) for the business in $1. */
export const CUSTOMER_VOUCHERS_SQL = `
  SELECT 'invoice'::text AS voucher_type, i.id AS voucher_id, i.customer_id
    FROM invoices i
   WHERE i.business_id = $1 AND i.customer_id IS NOT NULL
  UNION ALL
  SELECT 'payment', p.id, p.customer_id
    FROM payments p
   WHERE p.business_id = $1 AND p.customer_id IS NOT NULL
  UNION ALL
  -- A receipt taken when the invoice was saved is posted under the invoice's own id.
  SELECT 'payment', i.id, i.customer_id
    FROM invoices i
   WHERE i.business_id = $1 AND i.customer_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.id = i.id)
  UNION ALL
  SELECT 'credit_note', cn.id, cn.customer_id
    FROM credit_notes cn
   WHERE cn.business_id = $1 AND cn.customer_id IS NOT NULL
  UNION ALL
  SELECT 'debit_note', dn.id, dn.customer_id
    FROM debit_notes dn
   WHERE dn.business_id = $1 AND dn.customer_id IS NOT NULL
  UNION ALL
  SELECT DISTINCT 'advance_adjustment', aa.voucher_id, ap.customer_id
    FROM advance_adjustments aa
    JOIN advance_payments ap ON ap.id = aa.advance_id
   WHERE aa.business_id = $1 AND ap.customer_id IS NOT NULL AND aa.voucher_id IS NOT NULL
  UNION ALL
  SELECT 'credit_note_refund', cnr.id, cnr.customer_id
    FROM credit_note_refunds cnr
   WHERE cnr.business_id = $1 AND cnr.customer_id IS NOT NULL
  UNION ALL
  -- A customer's opening balance is posted under the customer's id.
  SELECT 'opening_balance', c.id, c.id
    FROM customers c
   WHERE c.business_id = $1
  UNION ALL
  -- The transfer posted when a customer's receivable account was changed.
  SELECT 'receivable_transfer', m.id, m.customer_id
    FROM customer_receivable_account_moves m
   WHERE m.business_id = $1
`;

export async function customerIdForVoucher(
  client: PoolClient,
  businessId: string,
  voucherType: string,
  voucherId: string,
): Promise<string | null> {
  const res = await client.query<{ customer_id: string }>(
    `SELECT v.customer_id
       FROM (${CUSTOMER_VOUCHERS_SQL}) v
      WHERE v.voucher_type = $2 AND v.voucher_id = $3
      LIMIT 1`,
    [businessId, voucherType, voucherId],
  );
  return res.rows[0]?.customer_id ?? null;
}

/**
 * Debit minus credit of the customer's lines in each of `accountIds`.
 * Accounts where the customer has no balance are absent from the map.
 */
export async function customerReceivableBalances(
  client: PoolClient,
  businessId: string,
  customerId: string,
  accountIds: string[],
): Promise<Map<string, number>> {
  const res = await client.query<{ account_id: string; net: string }>(
    `SELECT l.account_id, SUM(l.debit - l.credit)::text AS net
       FROM ledger_entry_lines l
       JOIN (${CUSTOMER_VOUCHERS_SQL}) v
         ON v.voucher_type = l.voucher_type AND v.voucher_id = l.voucher_id
      WHERE l.business_id = $1 AND v.customer_id = $2 AND l.account_id = ANY($3::uuid[])
      GROUP BY l.account_id
     HAVING ABS(SUM(l.debit - l.credit)) >= 0.005`,
    [businessId, customerId, accountIds],
  );
  return new Map(res.rows.map((r) => [r.account_id, Math.round(Number(r.net) * 100) / 100]));
}
