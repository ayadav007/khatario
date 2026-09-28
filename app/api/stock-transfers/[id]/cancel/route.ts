import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { reverseVoucherLedgerEntries } from '@/lib/ledger-reversal';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/stock-transfers/[id]/cancel
 * Cancel a stock transfer: restore dispatched stock to the source warehouse and, for a transfer
 * between GST registrations, cancel the inter-branch invoice and reverse its ledger postings.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();
  let inTransaction = false;

  try {
    const body = await request.json();
    const { cancelled_by, cancellation_reason, notes } = body;

    const userId = getUserIdFromRequest(request, body) || cancelled_by;
    if (!userId) {
      return NextResponse.json(
        { error: 'cancelled_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    const peek = await client.query(`SELECT * FROM stock_transfers WHERE id = $1`, [params.id]);
    if (peek.rows.length === 0) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }
    const tenant = requireTenantBusinessId(request, peek.rows[0].business_id);
    if (!tenant.ok || tenant.businessId !== peek.rows[0].business_id) {
      return NextResponse.json({ error: 'Transfer not found' }, { status: 404 });
    }

    try {
      await assertFeatureAccess(peek.rows[0].business_id, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // PBAC checks source warehouse access, status ('pending' or 'in_transit') and period lock.
    try {
      await authorize(userId, 'warehouse_transfer', 'cancel', {
        businessId: peek.rows[0].business_id,
        resourceId: params.id,
        sourceWarehouseId: peek.rows[0].from_location_id,
        transfer_date: peek.rows[0].transfer_date,
        status: peek.rows[0].status,
        resource: peek.rows[0],
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');
    inTransaction = true;
    const locked = await client.query(`SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE`, [params.id]);
    const transfer = locked.rows[0];
    if (!['pending', 'in_transit', 'draft'].includes(String(transfer.status))) {
      await client.query('ROLLBACK');
      inTransaction = false;
      return NextResponse.json(
        { error: `A ${transfer.status} transfer cannot be cancelled`, code: 'INVALID_STATUS' },
        { status: 409 }
      );
    }

    if (transfer.status === 'in_transit') {
      const transferItemsResult = await client.query(
        `SELECT * FROM stock_transfer_items WHERE transfer_id = $1`,
        [params.id]
      );

      for (const item of transferItemsResult.rows) {
        const dispatchedQty = parseFloat(item.quantity_dispatched || item.qty || '0');
        if (dispatchedQty <= 0) continue;

        await client.query(
          `INSERT INTO location_stock (location_id, item_id, current_stock_qty)
           VALUES ($1, $2, $3::numeric)
           ON CONFLICT (location_id, item_id)
           DO UPDATE SET
             current_stock_qty = location_stock.current_stock_qty + $3::numeric,
             last_updated = CURRENT_TIMESTAMP`,
          [transfer.from_location_id, item.item_id, dispatchedQty]
        );

        await client.query(
          `INSERT INTO stock_movements (
             business_id, item_id, location_id, type, quantity,
             reference_type, reference_id, notes, unit_cost
           )
           VALUES ($1, $2, $3, 'in', $4, 'stock_transfer_cancel', $5, $6, $7)`,
          [
            transfer.business_id,
            item.item_id,
            transfer.from_location_id,
            dispatchedQty,
            transfer.id,
            `Cancelled transfer ${transfer.transfer_number} - stock restored`,
            item.cost_snapshot || null,
          ]
        );
      }
    }

    const cancelNote = cancellation_reason || notes || 'Transfer cancelled';
    if (transfer.inter_branch_invoice_id) {
      const inv = await client.query(
        `SELECT id, invoice_number, customer_id, grand_total, status FROM invoices WHERE id = $1 AND business_id = $2`,
        [transfer.inter_branch_invoice_id, transfer.business_id]
      );
      const invoice = inv.rows[0];
      if (invoice && invoice.status !== 'cancelled') {
        const reason = `Transfer ${transfer.transfer_number} cancelled`;
        for (const voucherType of ['invoice', 'inter_branch_receipt']) {
          await reverseVoucherLedgerEntries(client, {
            businessId: transfer.business_id,
            voucherType,
            voucherId: invoice.id,
            reason,
          });
        }
        await client.query(
          `UPDATE invoices SET status = 'cancelled', balance_amount = 0, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [invoice.id]
        );
        if (invoice.customer_id) {
          await client.query(
            `UPDATE customers SET current_balance = COALESCE(current_balance, 0) - $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
            [Number(invoice.grand_total) || 0, invoice.customer_id]
          );
        }
      }
    }

    await client.query(
      `UPDATE stock_transfers
          SET status = 'cancelled',
              updated_at = CURRENT_TIMESTAMP,
              notes = CASE WHEN notes IS NOT NULL THEN notes || E'\n' || $1 ELSE $1 END
        WHERE id = $2`,
      [cancelNote, params.id]
    );

    await client.query('COMMIT');
    inTransaction = false;

    const finalTransfer = await queryOne(
      `SELECT
         st.*,
         fw.name as from_warehouse_name,
         tw.name as to_warehouse_name,
         u.name as approved_by_name,
         creator.name as created_by_name
       FROM stock_transfers st
       LEFT JOIN warehouses fw ON st.from_location_id = fw.id
       LEFT JOIN warehouses tw ON st.to_location_id = tw.id
       LEFT JOIN users u ON st.approved_by = u.id
       LEFT JOIN users creator ON st.created_by = creator.id
       WHERE st.id = $1`,
      [params.id]
    );

    return NextResponse.json({
      success: true,
      transfer: finalTransfer,
    });
  } catch (error: any) {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    console.error('Error cancelling stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to cancel stock transfer', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
