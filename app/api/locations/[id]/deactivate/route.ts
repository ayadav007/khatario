import { NextRequest, NextResponse } from 'next/server';
import { getPool, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * PATCH /api/locations/[id]/deactivate
 * Deactivate a warehouse with validation
 * Prevents deactivation if warehouse has stock
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const body = await request.json();
    const { business_id, force } = body; // force: bypass validation

    if (!business_id) {
      client.release();
      return NextResponse.json(
        { error: 'business_id is required' },
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

    // Get warehouse
    const warehouse = await queryOne(`
      SELECT * FROM business_locations 
      WHERE id = $1 AND business_id = $2
    `, [params.id, business_id]);

    if (!warehouse) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Warehouse not found' },
        { status: 404 }
      );
    }

    if (!warehouse.is_active) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Warehouse is already inactive' },
        { status: 400 }
      );
    }

    // Check if warehouse has stock (unless force is true)
    if (!force) {
      const stockCheck = await queryOne<{ total_stock: number; item_count: number }>(`
        SELECT 
          SUM(current_stock_qty) as total_stock,
          COUNT(*) as item_count
        FROM location_stock
        WHERE location_id = $1 AND current_stock_qty > 0
      `, [params.id]);

      const totalStock = parseFloat(stockCheck?.total_stock?.toString() || '0');
      const itemCount = parseInt(stockCheck?.item_count?.toString() || '0');

      if (totalStock > 0) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          {
            error: 'Cannot deactivate warehouse with stock',
            details: {
              total_stock: totalStock,
              items_with_stock: itemCount,
              message: 'Please transfer or adjust all stock before deactivating. Use force=true to bypass this check.'
            }
          },
          { status: 400 }
        );
      }

      // Check for pending transfers
      const pendingTransfers = await queryOne<{ count: number }>(`
        SELECT COUNT(*) as count
        FROM stock_transfers
        WHERE (from_location_id = $1 OR to_location_id = $1)
          AND status IN ('pending', 'in_transit')
      `, [params.id]);

      const transferCount = parseInt(pendingTransfers?.count?.toString() || '0');
      if (transferCount > 0) {
        await client.query('ROLLBACK');
        client.release();
        return NextResponse.json(
          {
            error: 'Cannot deactivate warehouse with pending transfers',
            details: {
              pending_transfers: transferCount,
              message: 'Please complete or cancel all pending transfers before deactivating.'
            }
          },
          { status: 400 }
        );
      }
    }

    // Deactivate warehouse
    await client.query(`
      UPDATE business_locations
      SET is_active = false,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
    `, [params.id]);

    await client.query('COMMIT');

    const updatedWarehouse = await queryOne(`
      SELECT * FROM business_locations WHERE id = $1
    `, [params.id]);

    return NextResponse.json({
      success: true,
      warehouse: updatedWarehouse,
      message: 'Warehouse deactivated successfully'
    });
  } catch (error: any) {
    await client.query('ROLLBACK');
    console.error('Error deactivating warehouse:', error);
    return NextResponse.json(
      { error: 'Failed to deactivate warehouse', details: error.message },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
