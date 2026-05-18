import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * PATCH /api/stock-transfers/[id]/cancel
 * Cancel a stock transfer (restore stock to source warehouse if already dispatched)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { cancelled_by, cancellation_reason, notes } = body;

    const userId = cancelled_by || body.user_id; // REQUIRED for authorization
    if (!userId) {
      client.release();
      return NextResponse.json(
        { error: 'cancelled_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // Get transfer with lock
    const transferResult = await client.query(`
      SELECT * FROM stock_transfers WHERE id = $1 FOR UPDATE
    `, [params.id]);

    if (transferResult.rows.length === 0) {
      client.release();
      return NextResponse.json(
        { error: 'Transfer not found' },
        { status: 404 }
      );
    }

    const transfer = transferResult.rows[0];

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(transfer.business_id, 'multi_warehouse');
    } catch (error) {
      client.release();
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check cancel permission (PBAC will check source warehouse access, status='pending' or 'in_transit', period lock)
    // Note: Status validation is now handled by PBAC policy (transferCanBeCancelled) - removed inline checks
    try {
      await authorize(userId, 'warehouse_transfer', 'cancel', {
        businessId: transfer.business_id,
        resourceId: params.id,
        sourceWarehouseId: transfer.from_location_id,
        transfer_date: transfer.transfer_date,
        status: transfer.status,
        resource: transfer,
      });
    } catch (error) {
      client.release();
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    // If transfer is in_transit (already dispatched), restore stock to source warehouse
    if (transfer.status === 'in_transit') {
      // Get transfer items
      const transferItemsResult = await client.query(`
        SELECT * FROM stock_transfer_items WHERE transfer_id = $1
      `, [params.id]);

      const transferItems = transferItemsResult.rows;

      // Restore stock to source warehouse (restore only what was dispatched)
      for (const item of transferItems) {
        const dispatchedQty = parseFloat(item.quantity_dispatched || item.qty || '0');
        
        if (dispatchedQty <= 0) continue; // Nothing to restore

        // Lock source location stock
        await client.query(`
          SELECT * FROM location_stock 
          WHERE location_id = $1 AND item_id = $2
          FOR UPDATE
        `, [transfer.from_location_id, item.item_id]);

        // Restore stock to source
        await client.query(`
          INSERT INTO location_stock (location_id, item_id, current_stock_qty)
          VALUES ($1, $2, $3)
          ON CONFLICT (location_id, item_id)
          DO UPDATE SET 
            current_stock_qty = location_stock.current_stock_qty + $3,
            last_updated = CURRENT_TIMESTAMP
        `, [transfer.from_location_id, item.item_id, dispatchedQty]);

        // Record stock movement for restoration
        await client.query(`
          INSERT INTO stock_movements (
            business_id, item_id, location_id, type, quantity,
            reference_type, reference_id, notes, unit_cost
          )
          VALUES ($1, $2, $3, 'in', $4, 'stock_transfer_cancel', $5, $6, $7)
        `, [
          transfer.business_id,
          item.item_id,
          transfer.from_location_id,
          dispatchedQty,
          transfer.id,
          `Cancelled transfer ${transfer.transfer_number} - stock restored`,
          item.cost_snapshot || null
        ]);
      }
    }

    // Update transfer status to 'cancelled'
    const cancelNote = cancellation_reason || notes || 'Transfer cancelled';
    const updatedTransfer = await queryOne(`
      UPDATE stock_transfers 
      SET status = 'cancelled',
          updated_at = CURRENT_TIMESTAMP,
          notes = CASE 
            WHEN notes IS NOT NULL THEN notes || E'\n' || $1
            ELSE $1
          END
      WHERE id = $2
      RETURNING *
    `, [cancelNote, params.id]);

    await client.query('COMMIT');

    // Fetch updated transfer with warehouse names
    const finalTransfer = await queryOne(`
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
      transfer: finalTransfer
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error cancelling stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to cancel stock transfer', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
