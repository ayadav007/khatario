import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, query, getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { adjustBranchVariantStock, refreshVariantGlobalStockFromBranches } from '@/lib/branch-variant-stock';
import { restoreBundleChildrenAfterInvoiceCancel } from '@/lib/invoice-bundle-stock';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';

export const dynamic = 'force-dynamic';

export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id;
  try {
    const body = await request.json();
    const { reason, cancelled_by } = body;

    if (!cancelled_by) {
      return NextResponse.json(
        { error: 'cancelled_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    const businessScope =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request, body);
    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const inv = await queryOne(
      `SELECT * FROM invoices WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [id, businessScope]
    );
    if (!inv) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 });

    // AUTHORIZATION: Check cancel permission (PBAC will check status, period lock, etc.)
    try {
      await authorize(cancelled_by, 'invoices', 'cancel', { 
        branchId: inv.branch_id,
        businessId: inv.business_id,
        resourceId: id,
        invoice_date: inv.invoice_date,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (inv.status === 'cancelled') {
      return NextResponse.json({ error: 'Invoice is already cancelled' }, { status: 409 });
    }

    if (inv.status === 'final') {
      const notes = await queryOne<{ n: string }>(
        `SELECT (
           (SELECT COUNT(*) FROM credit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active') +
           (SELECT COUNT(*) FROM debit_notes WHERE invoice_id = $1 AND business_id = $2 AND status = 'active')
         )::text AS n`,
        [id, businessScope]
      );
      if (Number(notes?.n || 0) > 0) {
        return NextResponse.json(
          {
            error:
              'This invoice has credit or debit notes against it. Cancel those notes first, then cancel the invoice.',
            code: 'INVOICE_HAS_NOTES',
          },
          { status: 409 }
        );
      }

      const { assertGstPeriodNotFiledForDocumentDate } = await import('@/lib/gst/gst-filing');
      try {
        await assertGstPeriodNotFiledForDocumentDate(
          businessScope,
          inv.branch_id,
          inv.invoice_date,
          'cancel invoice (issue a credit note instead)'
        );
      } catch (error: any) {
        return NextResponse.json(
          { error: error.message || 'GST period is filed', code: 'GST_PERIOD_FILED' },
          { status: 403 }
        );
      }
      const { assertPeriodNotLocked } = await import('@/lib/period-lock-utils');
      try {
        await assertPeriodNotLocked(businessScope, inv.branch_id, inv.invoice_date, 'invoice cancellation');
      } catch (error: any) {
        return NextResponse.json({ error: error.message || 'Period is locked', code: 'PERIOD_LOCKED' }, { status: 403 });
      }
    }

    const cancellationDetails = {
      reason: reason || 'Cancelled',
      cancelled_by: cancelled_by || null,
      cancelled_at: new Date().toISOString(),
    };

    const pool = getPool();
    const client = await pool.connect();
    let updated: any = null;
    try {
      await client.query('BEGIN');

      // Reverse stock, books and receivable if final (including batch/serial reversals)
      if (inv.status === 'final') {
        const items = await client.query(`SELECT * FROM invoice_items WHERE invoice_id = $1`, [id]);
        const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
        const warehouseModeEnabled = await isWarehouseModeEnabled(inv.business_id);

        for (const row of items.rows) {
          if (!row.item_id) continue;
          
          // Check if item is goods (services don't update stock)
          const itemTypeRes = await client.query(
            `SELECT item_type, track_batch, track_serial, COALESCE(is_bundle, false) AS is_bundle
             FROM items WHERE id = $1`,
            [row.item_id]
          );
          const itemData = itemTypeRes.rows[0];
          const itemType = itemData?.item_type || 'goods';

          if (itemType === 'goods' && itemData?.is_bundle) {
            const quantity = Number(row.quantity) || 0;
            // Child items may be serial-tracked; parent bundle row often is not
            await client.query(
              `UPDATE item_serials
               SET status = 'available',
                   sold_to_customer_id = NULL,
                   sold_invoice_id = NULL,
                   sold_at = NULL,
                   updated_at = CURRENT_TIMESTAMP
               WHERE sold_invoice_id = $1
                 AND item_id IN (SELECT item_id FROM bundle_items WHERE bundle_id = $2)`,
              [inv.id, row.item_id]
            );
            await restoreBundleChildrenAfterInvoiceCancel(
              client,
              inv.business_id,
              inv.branch_id,
              inv.id,
              row.item_id,
              quantity,
              row.location_id || null,
              warehouseModeEnabled
            );
            continue;
          }

          if (itemType === 'goods') {
            const quantity = Number(row.quantity) || 0;

            // Reverse serial numbers first (mark as available again)
            if (itemData?.track_serial) {
              await client.query(`
                UPDATE item_serials
                SET status = 'available',
                    sold_to_customer_id = NULL,
                    sold_invoice_id = NULL,
                    sold_at = NULL,
                    updated_at = CURRENT_TIMESTAMP
                WHERE sold_invoice_id = $1
              `, [inv.id]);
            }

            // Reverse batch quantities
            if (itemData?.track_batch) {
              // Get stock movements for this invoice to reverse batches
              const movements = await client.query(`
                SELECT batch_id, quantity FROM stock_movements
                WHERE reference_type = 'invoice' AND reference_id = $1 AND item_id = $2 AND batch_id IS NOT NULL
              `, [inv.id, row.item_id]);

              for (const movement of movements.rows) {
                await client.query(`
                  UPDATE item_batches
                  SET quantity = quantity + $1,
                      updated_at = CURRENT_TIMESTAMP
                  WHERE id = $2
                `, [movement.quantity, movement.batch_id]);
              }
            }

            // Update item/variant stock (mirror finalize)
            if (row.variant_id) {
              if (warehouseModeEnabled && row.location_id) {
                await client.query(
                  `
                INSERT INTO location_stock (location_id, item_id, current_stock_qty)
                VALUES ($1, $2, $3)
                ON CONFLICT (location_id, item_id)
                DO UPDATE SET
                  current_stock_qty = location_stock.current_stock_qty + $3,
                  last_updated = CURRENT_TIMESTAMP
              `,
                  [row.location_id, row.item_id, quantity]
                );
              } else if (!warehouseModeEnabled && inv.branch_id) {
                await adjustBranchVariantStock(client, inv.business_id, inv.branch_id, row.variant_id, quantity);
                await refreshVariantGlobalStockFromBranches(client, inv.business_id, row.variant_id);
              }
            } else if (warehouseModeEnabled && row.location_id) {
              await client.query(
                `
                INSERT INTO location_stock (location_id, item_id, current_stock_qty)
                VALUES ($1, $2, $3)
                ON CONFLICT (location_id, item_id)
                DO UPDATE SET
                  current_stock_qty = location_stock.current_stock_qty + $3,
                  last_updated = CURRENT_TIMESTAMP
              `,
                [row.location_id, row.item_id, quantity]
              );
            } else if (!warehouseModeEnabled && inv.branch_id) {
              await adjustBranchItemStock(client, inv.business_id, inv.branch_id, row.item_id, quantity);
              await refreshItemGlobalStockFromBranches(client, inv.business_id, row.item_id);
            }

            // Record reversal stock movement
            await client.query(`
              INSERT INTO stock_movements (
                business_id, item_id, variant_id, type, quantity, reference_type, reference_id
              )
              VALUES ($1, $2, $3, 'in', $4, 'invoice_cancel', $5)
            `, [inv.business_id, row.item_id, row.variant_id || null, quantity, inv.id]);
          }
        }

        // Dated on the invoice date so the cancelled supply drops out of that period's books
        // and GST, matching its removal from GSTR-1.
        await reverseVoucherLedgerEntries(client, {
          businessId: inv.business_id,
          voucherType: 'invoice',
          voucherId: inv.id,
          reason: `Invoice ${inv.invoice_number} cancelled`,
        });

        // Anything already received stays on the customer's account as an advance.
        if (inv.customer_id && inv.document_type !== 'proforma_invoice') {
          await client.query(
            `UPDATE customers
                SET current_balance = current_balance - $1, updated_at = CURRENT_TIMESTAMP
              WHERE id = $2 AND business_id = $3`,
            [Number(inv.grand_total) || 0, inv.customer_id, inv.business_id]
          );
        }
      }

      const res = await client.query(
        `UPDATE invoices
         SET status = 'cancelled',
             is_editable = false,
             balance_amount = 0,
             cancellation_details = $1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND business_id = $3
         RETURNING *`,
        [cancellationDetails, id, businessScope]
      );
      updated = res.rows[0];

      await client.query('COMMIT');
    } catch (error: any) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }

    return NextResponse.json({ invoice: updated });
  } catch (error: any) {
    console.error('Cancel error', error);
    return NextResponse.json({ error: error.message || 'Internal server error' }, { status: 500 });
  }
}


