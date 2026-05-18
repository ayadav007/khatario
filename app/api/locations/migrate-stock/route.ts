import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * POST /api/locations/migrate-stock
 * Migrate existing items' stock to a warehouse
 * Note: location_id parameter is actually a warehouse_id (for backward compatibility)
 */
export async function POST(request: NextRequest) {
  const pool = db.getPool();
  const client = await pool.connect();
  let transactionStarted = false;
  
  try {
    const body = await request.json();
    const { business_id, location_id, warehouse_id } = body;

    // Support both location_id (legacy) and warehouse_id (new)
    const targetWarehouseId = warehouse_id || location_id;

    if (!business_id || !targetWarehouseId) {
      client.release();
      return NextResponse.json(
        { error: 'business_id and warehouse_id (or location_id) are required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access for warehouses
    try {
      await assertFeatureAccess(business_id, 'multi_warehouse');
    } catch (error) {
      client.release();
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await client.query('BEGIN');
    transactionStarted = true;

    // Get all items with stock for this business
    const items = await client.query(`
      SELECT id, name, current_stock
      FROM items
      WHERE business_id = $1
        AND item_type = 'goods'
        AND current_stock > 0
    `, [business_id]);

    let migratedCount = 0;

    // Verify warehouse exists
    const warehouseCheck = await client.query(`
      SELECT id FROM warehouses WHERE id = $1 AND business_id = $2
    `, [targetWarehouseId, business_id]);

    if (warehouseCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return NextResponse.json(
        { error: 'Warehouse not found or does not belong to this business' },
        { status: 404 }
      );
    }

    // Migrate each item's stock to location_stock
    // Note: location_stock.location_id now references warehouses(id) after migration 119
    for (const item of items.rows) {
      // Check if location_stock entry already exists
      const existing = await client.query(`
        SELECT id, current_stock_qty FROM location_stock
        WHERE location_id = $1 AND item_id = $2
      `, [targetWarehouseId, item.id]);

      if (existing.rows.length > 0) {
        // Update existing entry (add to existing stock)
        await client.query(`
          UPDATE location_stock
          SET current_stock_qty = current_stock_qty + $1,
              last_updated = CURRENT_TIMESTAMP
          WHERE location_id = $2 AND item_id = $3
        `, [item.current_stock, targetWarehouseId, item.id]);
      } else {
        // Create new entry
        await client.query(`
          INSERT INTO location_stock (location_id, item_id, current_stock_qty, min_stock_qty)
          VALUES ($1, $2, $3, 0)
        `, [targetWarehouseId, item.id, item.current_stock]);
      }

      migratedCount++;
    }

    await client.query('COMMIT');

    return NextResponse.json({
      success: true,
      message: `Successfully migrated ${migratedCount} items to warehouse`,
      migrated_count: migratedCount
    });
  } catch (error: any) {
    // Only rollback if transaction was started
    if (transactionStarted) {
      try {
        await client.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }
    console.error('Error migrating stock:', error);
    
    // Always return valid JSON, even on error
    return NextResponse.json(
      { 
        error: 'Failed to migrate stock', 
        details: error?.message || 'Unknown error occurred',
        success: false
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

