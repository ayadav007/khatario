import type { PoolClient } from 'pg';
import { reverseVoucherLedgerEntries, reverseVouchers } from '@/lib/ledger-reversal';

/**
 * Invoice save with explicit payment entries replaces the invoice's payment rows: the receipt
 * vouchers of the rows being replaced are reversed. Returns their ids. Saves without payment
 * entries must not call this, so recorded payments and their vouchers are preserved. Reversed
 * payments are history and are never replaced.
 */
export async function reverseReplacedInvoicePayments(
  client: PoolClient,
  p: { businessId: string; invoiceId: string; userId: string | null }
): Promise<string[]> {
  const old = await client.query<{ id: string }>(
    `SELECT id FROM payments
      WHERE reference_type = 'invoice' AND reference_id = $1 AND business_id = $2 AND deleted_at IS NULL
        AND status = 'active'`,
    [p.invoiceId, p.businessId]
  );
  const ids = old.rows.map((r) => r.id);
  await reverseVouchers(client, {
    businessId: p.businessId,
    voucherType: 'payment',
    voucherIds: ids,
    reason: `Payment replaced on edit of invoice ${p.invoiceId.slice(0, 8)}`,
    actorId: p.userId,
  });
  return ids;
}

/** Reverses whatever is still posted on the invoice voucher before it is posted again. */
export async function reverseInvoicePostingForRepost(
  client: PoolClient,
  p: { businessId: string; invoiceId: string; invoiceNumber: string; userId: string | null }
): Promise<number> {
  return reverseVoucherLedgerEntries(client, {
    businessId: p.businessId,
    voucherType: 'invoice',
    voucherId: p.invoiceId,
    reason: `Invoice ${p.invoiceNumber} re-posted on edit`,
    actorId: p.userId,
  });
}
