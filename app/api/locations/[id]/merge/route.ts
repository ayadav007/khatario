import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne, queryRows } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * POST /api/locations/[id]/merge
 * Merge source warehouse into destination warehouse
 * Transfers all stock and updates references
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { business_id, destination_warehouse_id, deactivate_source } = body;

    if (!business_id || !destination_warehouse_id) {
      client.release();
      return NextResponse.json(
        { error: 'business_id and destination_warehouse_id are required' },
        { status: 400 }
      );
    }

    if (params.id === destination_warehouse_id) {
      client.release();
      return NextResponse.json(
        { error: 'Source and destination warehouses cannot be the same' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'multi_branch');
    } catch (error) {
      client.release();
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');

    // Verify both warehouses exist and belong to business
    const sourceWarehouse = await queryOne(`
      SELECT * FROM business_locations 
      WHERE id = $1 AND business_id = $2
    `, [params.id, business_id]);

    const destWarehouse = await queryOne(`
      SELECT * FROM business_locations 
      WHERE id = $1 AND business_id = $2
    `, [destination_warehouse_id, business_id]);

    if (!sourceWarehouse) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Source warehouse not found' },
        { status: 404 }
      );
    }

    if (!destWarehouse) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Destination warehouse not found' },
        { status: 404 }
      );
    }

    // Get all stock from source warehouse
    const sourceStock = await queryRows<{ item_id: string; current_stock_qty: number }>(`
      SELECT item_id, current_stock_qty
      FROM location_stock
      WHERE location_id = $1 AND current_stock_qty > 0
    `, [params.id]);

    let transferredItems = 0;
    let totalQuantity = 0;

    // Transfer each item's stock to destination
    for (const stock of sourceStock) {
      // Lock destination location stock
      await client.query(`
        SELECT * FROM location_stock 
        WHERE location_id = $1 AND item_id = $2
        FOR UPDATE
      `, [destination_warehouse_id, stock.item_id]);

      // Add stock to destination
      await client.query(`
        INSERT INTO location_stock (location_id, item_id, current_stock_qty)
        VALUES ($1, $2, $3)
        ON CONFLICT (location_id, item_id)
        DO UPDATE SET 
          current_stock_qty = location_stock.current_stock_qty + $3,
          last_updated = CURRENT_TIMESTAMP
      `, [destination_warehouse_id, stock.item_id, stock.current_stock_qty]);

      // Record stock movement
      await client.query(`
        INSERT INTO stock_movements (
          business_id, item_id, location_id, type, quantity,
          reference_type, reference_id, notes
        )
        VALUES ($1, $2, $3, 'out', $4, 'warehouse_merge', $5, $6)
      `, [
        business_id,
        stock.item_id,
        params.id,
        stock.current_stock_qty,
        params.id,
        `Merged from ${sourceWarehouse.name} to ${destWarehouse.name}`
      ]);

      await client.query(`
        INSERT INTO stock_movements (
          business_id, item_id, location_id, type, quantity,
          reference_type, reference_id, notes
        )
        VALUES ($1, $2, $3, 'in', $4, 'warehouse_merge', $5, $6)
      `, [
        business_id,
        stock.item_id,
        destination_warehouse_id,
        stock.current_stock_qty,
        params.id,
        `Merged from ${sourceWarehouse.name} to ${destWarehouse.name}`
      ]);

      transferredItems++;
      totalQuantity += parseFloat(stock.current_stock_qty.toString());
    }

    // Delete source warehouse stock records
    await client.query(`
      DELETE FROM location_stock WHERE location_id = $1
    `, [params.id]);

    // Update user_warehouses to point to destination
    await client.query(`
      UPDATE user_warehouses
      SET warehouse_id = $1,
          updated_at = CURRENT_TIMESTAMP
      WHERE warehouse_id = $2
    `, [destination_warehouse_id, params.id]);

    // Deactivate source warehouse if requested
    if (deactivate_source) {
      await client.query(`
        UPDATE business_locations
        SET is_active = false,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
      `, [params.id]);
    }

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: 'Warehouse merged successfully',
      details: {
        source_warehouse_id: params.id,
        source_warehouse_name: sourceWarehouse.name,
        destination_warehouse_id: destination_warehouse_id,
        destination_warehouse_name: destWarehouse.name,
        items_transferred: transferredItems,
        total_quantity_transferred: totalQuantity,
        source_deactivated: deactivate_source || false
      }
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error merging warehouse:', error);
    return NextResponse.json(
      { error: 'Failed to merge warehouse', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
