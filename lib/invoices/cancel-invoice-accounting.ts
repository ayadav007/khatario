import type { PoolClient } from 'pg';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';
import { releaseDocumentAdvances } from '@/lib/accounting/advance-service';
import { recostAfterStockChange, stockItemsForDocument } from '@/lib/inventory/fifo-recost';

/**
 * Accounting side of cancelling a final invoice, on the caller's transaction:
 *   - the invoice voucher is reversed, dated on the invoice date so the supply drops out of
 *     that period's books and GST (matching its removal from GSTR-1);
 *   - advances adjusted against it are released back to the advance and their adjustment
 *     vouchers reversed;
 *   - the customer balance loses the invoice total; payments already received stay on the
 *     customer's account as a credit (existing behaviour), and the released advance is added
 *     back because it is tracked on the advance, not on the customer balance.
 */
export async function reverseInvoiceAccountingOnCancel(
  client: PoolClient,
  inv: {
    id: string;
    business_id: string;
    invoice_number: string;
    customer_id: string | null;
    document_type: string | null;
    grand_total: number | string | null;
  },
  userId: string | null
): Promise<{ reversedLines: number; releasedAdvance: number }> {
  const reason = `Invoice ${inv.invoice_number} cancelled`;
  const reversedLines = await reverseVoucherLedgerEntries(client, {
    businessId: inv.business_id,
    voucherType: 'invoice',
    voucherId: inv.id,
    reason,
    actorId: userId,
  });
  if (reversedLines > 0) {
    await recostAfterStockChange(client, inv.business_id, await stockItemsForDocument(client, 'invoice', inv.id));
  }
  const { released } = await releaseDocumentAdvances(client, {
    businessId: inv.business_id,
    userId,
    invoiceId: inv.id,
    reason,
  });
  if (inv.customer_id && inv.document_type !== 'proforma_invoice') {
    await client.query(
      `UPDATE customers
          SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [(Number(inv.grand_total) || 0) - released, inv.customer_id, inv.business_id]
    );
  }
  return { reversedLines, releasedAdvance: released };
}
