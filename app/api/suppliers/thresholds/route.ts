import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows, queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

/**
 * GET /api/suppliers/thresholds?supplier_business_id=xxx
 * Get all thresholds set by a supplier
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  try {
    const { searchParams } = new URL(request.url);
    const supplierBusinessId = searchParams.get('supplier_business_id');

    if (!supplierBusinessId) {
      return NextResponse.json(
        { error: 'supplier_business_id is required' },
        { status: 400 }
      );
    }

    if (supplierBusinessId !== auth.businessId) {
      return NextResponse.json(
        { error: 'You can only view your own thresholds', code: 'TENANT_MISMATCH' },
        { status: 403 }
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
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

  // Retired: reorder levels now come from the customer's own items (min_stock) and alerts go
  // to the item's default supplier. See lib/low-stock-checker.ts.
  return NextResponse.json(
    {
      error: "Supplier-set thresholds are retired. Alerts now follow each customer's own reorder levels.",
      code: 'THRESHOLDS_RETIRED',
    },
    { status: 410 }
  );
}

/**
 * DELETE /api/suppliers/thresholds?id=xxx
 * Delete a threshold
 */
export async function DELETE(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;

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

    if (String(threshold.supplier_business_id) !== auth.businessId) {
      return NextResponse.json(
        { error: 'You can only delete your own thresholds', code: 'TENANT_MISMATCH' },
        { status: 403 }
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

