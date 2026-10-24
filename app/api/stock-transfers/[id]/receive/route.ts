import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { createInterBranchPurchaseEntries } from '@/lib/inter-branch-utils';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * POST /api/stock-transfers/[id]/receive
 * Receive/complete a stock transfer - adds stock to destination warehouse
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { received_items, notes } = body;

    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const preview = await client.query(
      `SELECT * FROM stock_transfers WHERE id = $1 AND business_id = $2`,
      [params.id, tenant.businessId]
    );

    if (preview.rows.length === 0) {
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      );
    }

    const transfer = preview.rows[0];

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(transfer.business_id, 'multi_warehouse');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check receive permission (PBAC will check destination warehouse access, status='in_transit', period lock, stock freeze)
    // Note: Status validation is now handled by PBAC policy (transferCanBeReceived) - removed inline checks
    try {
      await authorize(userId, 'warehouse_transfer', 'receive', {
        businessId: transfer.business_id,
        resourceId: params.id,
        destinationWarehouseId: transfer.to_location_id,
        transfer_date: transfer.transfer_date,
        status: transfer.status,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    const locked = await client.query(
      `SELECT status FROM stock_transfers WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [params.id, tenant.businessId]
    );
    if (locked.rows[0]?.status !== 'in_transit') {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: `Transfer is ${locked.rows[0]?.status ?? 'missing'}; only in-transit transfers can be received.`, code: 'TRANSFER_STATE_CHANGED' },
        { status: 409 }
      );
    }

    // Get transfer items
    const transferItemsResult = await client.query(`
      SELECT * FROM stock_transfer_items WHERE transfer_id = $1 FOR UPDATE
    `, [params.id]);

    const transferItems = transferItemsResult.rows;

    // received_qty in the request is the cumulative total received so far (the UI
    // pre-fills the previous figure); only the increase is added to stock.
    const itemsToReceive: Array<{ item_id: string; qty?: number; received_qty?: number }> =
      received_items || transferItems.map(item => ({
        item_id: item.item_id,
        qty: item.qty,
        received_qty: item.quantity_dispatched ?? item.qty,
      }));

    const seenItemIds = new Set<string>();
    for (const r of itemsToReceive) {
      if (seenItemIds.has(r.item_id)) {
        await client.query('ROLLBACK');
        return NextResponse.json({ error: `Item ${r.item_id} appears more than once`, code: 'DUPLICATE_ITEM' }, { status: 400 });
      }
      seenItemIds.add(r.item_id);
    }

    // Add stock to destination warehouse
    for (const receivedItem of itemsToReceive) {
      const transferItem = transferItems.find(ti => ti.item_id === receivedItem.item_id);
      if (!transferItem) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { error: `Item ${receivedItem.item_id} not found in transfer` },
          { status: 400 }
        );
      }

      const dispatchedQty = parseFloat(transferItem.quantity_dispatched || transferItem.qty || '0');
      const receivedQty = parseFloat(String(receivedItem.received_qty ?? receivedItem.qty ?? dispatchedQty));
      const alreadyReceived = parseFloat(transferItem.received_qty || '0');
      const receiveNow = Math.round((receivedQty - alreadyReceived) * 1000) / 1000;

      if (!Number.isFinite(receivedQty) || receiveNow < 0) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          {
            error: `Received quantity cannot go below what was already received (${alreadyReceived}).`,
            item_id: receivedItem.item_id,
          },
          { status: 400 }
        );
      }

      // Validate: Cannot receive more than dispatched
      if (receivedQty > dispatchedQty) {
        await client.query('ROLLBACK');
        return NextResponse.json(
          { 
            error: `Cannot receive more than dispatched. Dispatched: ${dispatchedQty}, Received: ${receivedQty}`,
            item_id: receivedItem.item_id
          },
          { status: 400 }
        );
      }

      if (receiveNow > 0) {
        await client.query(`
          SELECT * FROM location_stock 
          WHERE location_id = $1 AND item_id = $2
          FOR UPDATE
        `, [transfer.to_location_id, receivedItem.item_id]);

        await client.query(`
          INSERT INTO location_stock (location_id, item_id, current_stock_qty)
          VALUES ($1, $2, $3)
          ON CONFLICT (location_id, item_id)
          DO UPDATE SET 
            current_stock_qty = location_stock.current_stock_qty + $3,
            last_updated = CURRENT_TIMESTAMP
        `, [transfer.to_location_id, receivedItem.item_id, receiveNow]);

        await client.query(`
          INSERT INTO stock_movements (
            business_id, item_id, location_id, type, quantity,
            reference_type, reference_id, notes, unit_cost
          )
          VALUES ($1, $2, $3, 'in', $4, 'stock_transfer', $5, $6, $7)
        `, [
          transfer.business_id,
          receivedItem.item_id,
          transfer.to_location_id,
          receiveNow,
          transfer.id,
          `Received transfer ${transfer.transfer_number}${receivedQty !== dispatchedQty ? ` (Expected: ${dispatchedQty}, Received: ${receivedQty})` : ''}`,
          transferItem.cost_snapshot ?? null,
        ]);
      }

      // Update transfer item with received quantity
      const dispatchedQtyForUpdate = parseFloat(transferItem.quantity_dispatched || transferItem.qty || '0');
      await client.query(`
        UPDATE stock_transfer_items
        SET received_qty = $1, 
            notes = CASE 
              WHEN $2::text IS NOT NULL AND $1::numeric != $3::numeric THEN COALESCE(notes || E'\n', '') || $2::text
              WHEN $2::text IS NOT NULL THEN COALESCE(notes || E'\n', '') || $2::text
              ELSE notes
            END
        WHERE transfer_id = $4 AND item_id = $5
      `, [
        receivedQty,
        receivedQty !== dispatchedQtyForUpdate ? `Received: ${receivedQty}, Dispatched: ${dispatchedQtyForUpdate}` : null,
        dispatchedQtyForUpdate,
        transfer.id,
        receivedItem.item_id
      ]);
    }

    // Check if all items are fully received
    const allItemsReceived = await client.query(`
      SELECT 
        COUNT(*) as total_items,
        COUNT(CASE WHEN received_qty >= quantity_dispatched THEN 1 END) as fully_received_items
      FROM stock_transfer_items
      WHERE transfer_id = $1
    `, [params.id]);

    const totalItems = parseInt(allItemsReceived.rows[0]?.total_items || '0');
    const fullyReceivedItems = parseInt(allItemsReceived.rows[0]?.fully_received_items || '0');

    // Update transfer status: completed if all items fully received, otherwise stays in_transit (partial receipt)
    const finalStatus = (fullyReceivedItems === totalItems && totalItems > 0) ? 'completed' : 'in_transit';

    await client.query(`
      UPDATE stock_transfers 
      SET status = $1, 
          updated_at = CURRENT_TIMESTAMP,
          notes = CASE 
            WHEN $2::text IS NOT NULL AND notes IS NOT NULL THEN notes || E'\n' || $2::text
            WHEN $2::text IS NOT NULL THEN $2::text
            ELSE notes
          END
      WHERE id = $3
    `, [finalStatus, notes || null, params.id]);

    // The receiving branch books the inter-branch invoice once, when the goods are fully received.
    if (transfer.inter_branch_invoice_id && finalStatus === 'completed') {
      const invoice = await client.query(
        `SELECT id, invoice_date FROM invoices WHERE id = $1`,
        [transfer.inter_branch_invoice_id]
      );
      const toWarehouse = await client.query(
        `SELECT COALESCE(
           w.branch_id,
           (SELECT bw.branch_id FROM branch_warehouses bw WHERE bw.warehouse_id = w.id
             ORDER BY bw.is_primary DESC NULLS LAST LIMIT 1)
         ) AS branch_id
           FROM warehouses w WHERE w.id = $1`,
        [transfer.to_location_id]
      );
      if (invoice.rows[0] && toWarehouse.rows[0]?.branch_id) {
        const cogs = await client.query(
          `SELECT COALESCE(SUM(credit), 0) AS amt
             FROM ledger_entry_lines l JOIN accounts a ON a.id = l.account_id
            WHERE l.voucher_id = $1 AND l.voucher_type = 'invoice' AND a.account_code = '1104'`,
          [transfer.inter_branch_invoice_id]
        );
        await createInterBranchPurchaseEntries(client, {
          businessId: transfer.business_id,
          toBranchId: toWarehouse.rows[0].branch_id,
          invoiceId: invoice.rows[0].id,
          invoiceDate: invoice.rows[0].invoice_date,
          inventoryAmount: Number(cogs.rows[0]?.amt || 0),
        });
      }
    }

    await client.query('COMMIT');

    // Fetch updated transfer with warehouse names
    const updatedTransfer = await queryOne(`
      SELECT 
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
      WHERE st.id = $1
    `, [params.id]);

    return NextResponse.json({ 
      success: true,
      transfer: updatedTransfer
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error receiving stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to receive stock transfer', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
