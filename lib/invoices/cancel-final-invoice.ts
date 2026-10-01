import type { PoolClient } from 'pg';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { adjustBranchVariantStock, refreshVariantGlobalStockFromBranches } from '@/lib/branch-variant-stock';
import { restoreBundleChildrenAfterInvoiceCancel } from '@/lib/invoice-bundle-stock';
import { reverseInvoiceAccountingOnCancel } from '@/lib/invoices/cancel-invoice-accounting';

/** Authenticated Shiprocket tracking event. Not a users.id. */
export const SHIPROCKET_WEBHOOK_ACTOR = 'shiprocket_webhook' as const;

export class InvoiceCancelError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public code: string,
  ) {
    super(message);
    this.name = 'InvoiceCancelError';
  }
}

type PostedInvoiceRow = {
  id: string;
  business_id: string;
  branch_id: string | null;
  status: string;
  document_type: string | null;
  invoice_number: string;
  invoice_date: string | Date;
  customer_id: string | null;
  grand_total: string | number | null;
};

/**
 * Cancels one posted final invoice on the caller's transaction.
 * Ledger lines and the original stock movement stay. A mirror voucher and an
 * `invoice_cancel` stock movement are added. A second call does not post again.
 */
export async function cancelPostedInvoiceInTransaction(
  client: PoolClient,
  input: {
    invoiceId: string;
    businessId: string;
    /** Session user. Null only when `systemActor` is an authenticated carrier event. */
    userId: string | null;
    reason: string;
    systemActor?: typeof SHIPROCKET_WEBHOOK_ACTOR;
  },
): Promise<'cancelled' | 'already_cancelled'> {
  const locked = await client.query<PostedInvoiceRow>(
    `SELECT id, business_id, branch_id, status, document_type, invoice_number,
            invoice_date, customer_id, grand_total
       FROM invoices
      WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL
      FOR UPDATE`,
    [input.invoiceId, input.businessId],
  );
  const inv = locked.rows[0];
  if (!inv) {
    throw new InvoiceCancelError('Invoice not found', 404, 'INVOICE_NOT_FOUND');
  }
  if (inv.status === 'cancelled') return 'already_cancelled';
  if (inv.status !== 'final' || inv.document_type === 'proforma_invoice') {
    throw new InvoiceCancelError(
      'Only a final tax invoice can be reversed',
      409,
      'INVOICE_NOT_REVERSIBLE',
    );
  }

  const notes = await client.query<{ n: string }>(
    `SELECT (
       (SELECT COUNT(*) FROM credit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active') +
       (SELECT COUNT(*) FROM debit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active')
     )::text AS n`,
    [inv.id, input.businessId],
  );
  if (Number(notes.rows[0]?.n || 0) > 0) {
    throw new InvoiceCancelError(
      'This invoice has credit or debit notes against it. Cancel those notes first, then cancel the invoice.',
      409,
      'INVOICE_HAS_NOTES',
    );
  }

  const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
  try {
    await assertGstPeriodNotFiledForDocumentDate(
      input.businessId,
      inv.branch_id,
      inv.invoice_date,
      'cancel invoice (issue a credit note instead)',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : 'GST period is filed';
    throw new InvoiceCancelError(message, 403, 'GST_PERIOD_FILED');
  }
  const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
  try {
    await assertPeriodNotLocked(input.businessId, inv.branch_id, inv.invoice_date, 'invoice cancellation');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Period is locked';
    throw new InvoiceCancelError(message, 403, 'PERIOD_LOCKED');
  }

  const actorUserId = input.systemActor ? null : input.userId;
  if (!input.systemActor && !actorUserId) {
    throw new InvoiceCancelError('A session user is required to reverse the invoice', 409, 'ACTOR_REQUIRED');
  }

  await restorePostedInvoiceStockOnCancel(client, inv);
  await reverseInvoiceAccountingOnCancel(client, inv, actorUserId);

  const cancellationDetails: Record<string, string | null> = {
    reason: input.reason || 'Cancelled',
    cancelled_by: actorUserId,
    cancelled_at: new Date().toISOString(),
  };
  if (input.systemActor) cancellationDetails.actor_type = input.systemActor;

  await client.query(
    `UPDATE invoices
        SET status = 'cancelled',
            is_editable = false,
            balance_amount = 0,
            cancellation_details = $1,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = $2 AND business_id = $3 AND status = 'final'`,
    [cancellationDetails, inv.id, input.businessId],
  );
  return 'cancelled';
}

/** Puts goods sold on a final invoice back, and records an `invoice_cancel` movement. */
async function restorePostedInvoiceStockOnCancel(
  client: PoolClient,
  inv: PostedInvoiceRow,
): Promise<void> {
  const items = await client.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [inv.id]);
  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  const warehouseModeEnabled = await isWarehouseModeEnabled(inv.business_id);

  for (const row of items.rows) {
    if (!row.item_id) continue;

    const itemTypeRes = await client.query(
      `SELECT item_type, track_batch, track_serial, COALESCE(is_bundle, false) AS is_bundle
         FROM items WHERE id = $1`,
      [row.item_id],
    );
    const itemData = itemTypeRes.rows[0];
    const itemType = itemData?.item_type || 'goods';

    if (itemType === 'goods' && itemData?.is_bundle) {
      const quantity = Number(row.quantity) || 0;
      await client.query(
        `UPDATE item_serials
            SET status = 'available',
                sold_to_customer_id = NULL,
                sold_invoice_id = NULL,
                sold_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE sold_invoice_id = $1
            AND item_id IN (SELECT item_id FROM bundle_items WHERE bundle_id = $2)`,
        [inv.id, row.item_id],
      );
      await restoreBundleChildrenAfterInvoiceCancel(
        client,
        inv.business_id,
        inv.branch_id,
        inv.id,
        row.item_id,
        quantity,
        row.location_id || null,
        warehouseModeEnabled,
      );
      continue;
    }

    if (itemType !== 'goods') continue;

    const quantity = Number(row.quantity) || 0;

    if (itemData?.track_serial) {
      await client.query(
        `UPDATE item_serials
            SET status = 'available',
                sold_to_customer_id = NULL,
                sold_invoice_id = NULL,
                sold_at = NULL,
                updated_at = CURRENT_TIMESTAMP
          WHERE sold_invoice_id = $1`,
        [inv.id],
      );
    }

    if (itemData?.track_batch) {
      const movements = await client.query(
        `SELECT batch_id, quantity FROM stock_movements
          WHERE reference_type = 'invoice' AND reference_id = $1 AND item_id = $2 AND batch_id IS NOT NULL`,
        [inv.id, row.item_id],
      );
      for (const movement of movements.rows) {
        await client.query(
          `UPDATE item_batches
              SET quantity = quantity + $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2`,
          [movement.quantity, movement.batch_id],
        );
      }
    }

    if (row.variant_id) {
      if (warehouseModeEnabled && row.location_id) {
        await client.query(
          `INSERT INTO location_stock (location_id, item_id, current_stock_qty)
           VALUES ($1, $2, $3)
           ON CONFLICT (location_id, item_id)
           DO UPDATE SET current_stock_qty = location_stock.current_stock_qty + $3,
                         last_updated = CURRENT_TIMESTAMP`,
          [row.location_id, row.item_id, quantity],
        );
      } else if (!warehouseModeEnabled && inv.branch_id) {
        await adjustBranchVariantStock(client, inv.business_id, inv.branch_id, row.variant_id, quantity);
        await refreshVariantGlobalStockFromBranches(client, inv.business_id, row.variant_id);
      }
    } else if (warehouseModeEnabled && row.location_id) {
      await client.query(
        `INSERT INTO location_stock (location_id, item_id, current_stock_qty)
         VALUES ($1, $2, $3)
         ON CONFLICT (location_id, item_id)
         DO UPDATE SET current_stock_qty = location_stock.current_stock_qty + $3,
                       last_updated = CURRENT_TIMESTAMP`,
        [row.location_id, row.item_id, quantity],
      );
    } else if (!warehouseModeEnabled && inv.branch_id) {
      await adjustBranchItemStock(client, inv.business_id, inv.branch_id, row.item_id, quantity);
      await refreshItemGlobalStockFromBranches(client, inv.business_id, row.item_id);
    }

    await client.query(
      `INSERT INTO stock_movements (
         business_id, item_id, variant_id, type, quantity, reference_type, reference_id
       ) VALUES ($1, $2, $3, 'in', $4, 'invoice_cancel', $5)`,
      [inv.business_id, row.item_id, row.variant_id || null, quantity, inv.id],
    );
  }
}
