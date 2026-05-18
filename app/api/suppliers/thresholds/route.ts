import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/suppliers/thresholds?supplier_business_id=xxx
 * Get all thresholds set by a supplier
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierBusinessId = searchParams.get('supplier_business_id');

    if (!supplierBusinessId) {
      return NextResponse.json(
        { error: 'supplier_business_id is required' },
        { status: 400 }
      );
    }

    const thresholds = await queryRows(
      `SELECT 
        t.id,
        t.supplier_business_id,
        t.customer_business_id,
        t.item_id,
        t.low_stock_threshold,
        t.created_at,
        t.updated_at,
        cb.name as customer_name,
        cb.phone as customer_phone,
        cb.city as customer_city,
        cb.state as customer_state,
        i.name as item_name,
        i.code as item_code,
        i.current_stock
      FROM supplier_item_thresholds t
      LEFT JOIN businesses cb ON t.customer_business_id = cb.id
      -- Soft delete: exclude records where deleted_at is set
      LEFT JOIN items i ON t.item_id = i.id AND i.deleted_at IS NULL
      WHERE t.supplier_business_id = $1
      ORDER BY t.created_at DESC`,
      [supplierBusinessId]
    );

    return NextResponse.json({
      success: true,
      thresholds
    });

  } catch (error: any) {
    console.error('Error fetching thresholds:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch thresholds' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/suppliers/thresholds
 * Create a new threshold
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      supplier_business_id,
      customer_business_id,
      item_id,
      low_stock_threshold
    } = body;

    if (!supplier_business_id || !customer_business_id || !item_id || low_stock_threshold === undefined) {
      return NextResponse.json(
        { error: 'supplier_business_id, customer_business_id, item_id, and low_stock_threshold are required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access (supplier must have supplier_management)
    try {
      await assertFeatureAccess(supplier_business_id, 'supplier_management');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Check if threshold already exists
    const existing = await queryOne(
      `SELECT id FROM supplier_item_thresholds
      WHERE supplier_business_id = $1 AND customer_business_id = $2 AND item_id = $3`,
      [supplier_business_id, customer_business_id, item_id]
    );

    if (existing) {
      // Update existing threshold
      const threshold = await queryOne(
        `UPDATE supplier_item_thresholds
        SET low_stock_threshold = $1, updated_at = $2
        WHERE id = $3
        RETURNING *`,
        [low_stock_threshold, new Date(), existing.id]
      );

      return NextResponse.json({
        success: true,
        threshold,
        message: 'Threshold updated successfully'
      });
    }

    // Create new threshold
    const threshold = await queryOne(
      `INSERT INTO supplier_item_thresholds (
        supplier_business_id, customer_business_id, item_id, low_stock_threshold
      )
      VALUES ($1, $2, $3, $4)
      RETURNING *`,
      [supplier_business_id, customer_business_id, item_id, low_stock_threshold]
    );

    return NextResponse.json({
      success: true,
      threshold,
      message: 'Threshold created successfully'
    }, { status: 201 });

  } catch (error: any) {
    console.error('Error creating threshold:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to create threshold' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/suppliers/thresholds?id=xxx
 * Delete a threshold
 */
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const thresholdId = searchParams.get('id');

    if (!thresholdId) {
      return NextResponse.json(
        { error: 'id is required' },
        { status: 400 }
      );
    }

    // Get threshold to find supplier_business_id
    const threshold = await queryOne(`
      SELECT supplier_business_id FROM supplier_item_thresholds WHERE id = $1
    `, [thresholdId]);

    if (!threshold) {
      return NextResponse.json(
        { error: 'Threshold not found' },
        { status: 404 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(threshold.supplier_business_id, 'supplier_management');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await query(
      `DELETE FROM supplier_item_thresholds WHERE id = $1`,
      [thresholdId]
    );

    return NextResponse.json({
      success: true,
      message: 'Threshold deleted successfully'
    });

  } catch (error: any) {
    console.error('Error deleting threshold:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to delete threshold' },
      { status: 500 }
    );
  }
}

