import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * PATCH /api/stock-transfers/[id]/dispatch
 * Dispatch a stock transfer (change status from 'pending' to 'in_transit')
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { dispatched_by, dispatch_date, notes } = body;

    const userId = dispatched_by || body.user_id; // REQUIRED for authorization
    if (!userId) {
      client.release();
      return NextResponse.json(
        { error: 'dispatched_by (user_id) is required for authorization' },
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

    // AUTHORIZATION: Check dispatch permission (PBAC will check source warehouse access, status='pending', period lock, stock freeze)
    // Note: Status validation is now handled by PBAC policy (transferCanBeDispatched) - removed inline checks
    try {
      await authorize(userId, 'warehouse_transfer', 'dispatch', {
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

    // Get transfer items with lock
    const transferItemsResult = await client.query(`
      SELECT * FROM stock_transfer_items 
      WHERE transfer_id = $1
      FOR UPDATE
    `, [params.id]);

    const transferItems = transferItemsResult.rows;

    // Validate stock availability and deduct stock from source warehouse
    for (const item of transferItems) {
      const requestedQty = parseFloat(item.quantity_requested || item.qty || '0');
      
      // Lock and check stock availability
      const stockCheck = await client.query(`
        SELECT current_stock_qty 
        FROM location_stock 
        WHERE location_id = $1 AND item_id = $2
        FOR UPDATE
      `, [transfer.from_location_id, item.item_id]);

      const availableStock = parseFloat(stockCheck.rows[0]?.current_stock_qty || '0');

      if (availableStock < requestedQty) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          { 
            error: `Insufficient stock for item. Available: ${availableStock}, Requested: ${requestedQty}`,
            item_id: item.item_id
          },
          { status: 400 }
        );
      }

      // Deduct stock from source warehouse
      await client.query(`
        INSERT INTO location_stock (location_id, item_id, current_stock_qty)
        VALUES ($1, $2, -$3)
        ON CONFLICT (location_id, item_id)
        DO UPDATE SET 
          current_stock_qty = location_stock.current_stock_qty - $3,
          last_updated = CURRENT_TIMESTAMP
      `, [transfer.from_location_id, item.item_id, requestedQty]);

      // Update quantity_dispatched
      await client.query(`
        UPDATE stock_transfer_items
        SET quantity_dispatched = $1
        WHERE transfer_id = $2 AND item_id = $3
      `, [requestedQty, params.id, item.item_id]);

      // Record stock movement
      await client.query(`
        INSERT INTO stock_movements (
          business_id, item_id, location_id, type, quantity,
          reference_type, reference_id, notes, unit_cost
        )
        VALUES ($1, $2, $3, 'out', $4, 'stock_transfer', $5, $6, $7)
      `, [
        transfer.business_id,
        item.item_id,
        transfer.from_location_id,
        requestedQty,
        transfer.id,
        `Transfer ${transfer.transfer_number} dispatched to ${transfer.to_location_id}`,
        item.cost_snapshot || null
      ]);
    }

    // Update transfer status to 'in_transit'
    const updatedTransfer = await queryOne(`
      UPDATE stock_transfers 
      SET status = 'in_transit',
          updated_at = CURRENT_TIMESTAMP,
          notes = CASE 
            WHEN $1 IS NOT NULL AND notes IS NOT NULL THEN notes || E'\n' || $1
            WHEN $1 IS NOT NULL THEN $1
            ELSE notes
          END
      WHERE id = $2
      RETURNING *
    `, [notes || null, params.id]);

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
    console.error('Error dispatching stock transfer:', error);
    return NextResponse.json(
      { error: 'Failed to dispatch stock transfer', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
