import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';

/**
 * GET /api/inventory-adjustments/[id]
 * Get a single inventory adjustment by ID
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = searchParams.get('business_id');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(businessId, 'purchase_inventory_adjustments');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const adjustment = await queryOne(
      `SELECT 
        ia.*,
        i.name as item_name,
        i.code as item_code,
        i.unit as item_unit,
        iv.variant_name,
        bl.name as location_name,
        u.name as created_by_name
      FROM inventory_adjustments ia
      LEFT JOIN items i ON ia.item_id = i.id
      LEFT JOIN item_variants iv ON ia.variant_id = iv.id
      LEFT JOIN business_locations bl ON ia.location_id = bl.id
      LEFT JOIN users u ON ia.created_by = u.id
      WHERE ia.id = $1 AND ia.business_id = $2`,
      [params.id, businessId]
    );

    if (!adjustment) {
      return NextResponse.json(
        { error: 'Adjustment not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({ adjustment });
  } catch (error: any) {
    console.error('Error fetching inventory adjustment:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
