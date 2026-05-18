import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne } from '@/lib/db';
import {
  createQuantityAdjustment,
  createValueAdjustment,
  QuantityAdjustmentParams,
  ValueAdjustmentParams,
  ReasonCode
} from '@/lib/inventory-adjustment-service';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';

/**
 * GET /api/inventory-adjustments
 * List inventory adjustments with filters
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const itemId = searchParams.get('item_id');
    const variantId = searchParams.get('variant_id');
    const locationId = searchParams.get('location_id');
    const adjustmentType = searchParams.get('adjustment_type');
    const reasonCode = searchParams.get('reason_code');
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = (page - 1) * limit;

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
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

    // AUTHORIZATION: Check read permission (PBAC will check warehouse access, business ownership)
    try {
      await authorize(userId, 'inventory_adjustment', 'read', {
        businessId,
        warehouseId: locationId || undefined,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs for filtering
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // Continue without branch filtering if error
    }

    // Build query with filters
    // Filter by warehouse's branch_id if user has branch access
    let branchFilter = '';
    const params: any[] = [businessId];
    let paramIndex = 2;
    
    if (accessibleBranchIds.length > 0) {
      // Filter by warehouse's branch_id - warehouses can be linked to branches via branch_id or branch_warehouses
      branchFilter = ` AND (
        ia.location_id IS NULL 
        OR EXISTS (
          SELECT 1 FROM warehouses w 
          WHERE w.id = ia.location_id 
          AND (w.branch_id = ANY($${paramIndex}::uuid[]) OR w.branch_id IS NULL)
        )
        OR EXISTS (
          SELECT 1 FROM branch_warehouses bw
          WHERE bw.warehouse_id = ia.location_id
          AND bw.branch_id = ANY($${paramIndex}::uuid[])
        )
      )`;
      params.push(accessibleBranchIds);
      paramIndex++;
    }

    let query = `
      SELECT 
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
      WHERE ia.business_id = $1
      ${branchFilter}
    `;

    if (itemId) {
      query += ` AND ia.item_id = $${paramIndex}`;
      params.push(itemId);
      paramIndex++;
    }

    if (variantId) {
      query += ` AND ia.variant_id = $${paramIndex}`;
      params.push(variantId);
      paramIndex++;
    }

    if (locationId) {
      query += ` AND ia.location_id = $${paramIndex}`;
      params.push(locationId);
      paramIndex++;
    }

    if (adjustmentType) {
      query += ` AND ia.adjustment_type = $${paramIndex}`;
      params.push(adjustmentType);
      paramIndex++;
    }

    if (reasonCode) {
      query += ` AND ia.reason_code = $${paramIndex}`;
      params.push(reasonCode);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND ia.adjustment_date >= $${paramIndex}`;
      params.push(startDate);
      paramIndex++;
    }

    if (endDate) {
      query += ` AND ia.adjustment_date <= $${paramIndex}`;
      params.push(endDate);
      paramIndex++;
    }

    // Get total count
    const countQuery = query.replace(
      /SELECT[\s\S]*?FROM/,
      'SELECT COUNT(*) as total FROM'
    );
    const countResult = await queryOne(countQuery, params);
    const total = parseInt(countResult?.total || '0');

    // Add ordering and pagination
    query += ` ORDER BY ia.adjustment_date DESC, ia.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const adjustments = await queryRows(query, params);

    return NextResponse.json({
      adjustments,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit)
      }
    });
  } catch (error: any) {
    console.error('Error fetching inventory adjustments:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/inventory-adjustments
 * Create a new inventory adjustment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getBusinessIdFromRequest(request, body);
    const {
      adjustment_type,
      item_id,
      variant_id,
      location_id,
      branch_id,
      direction, // For quantity adjustments
      quantity, // For quantity adjustments
      value_change, // For value adjustments
      reason_code,
      reason_notes,
      notes,
      adjustment_date,
      gst_impact // For value adjustments
    } = body;

    const created_by = body.created_by || getUserIdFromRequest(request, body);

    // Validation
    if (!business_id || !adjustment_type || !item_id || !reason_code || !adjustment_date) {
      return NextResponse.json(
        { error: 'Missing required fields: business_id, adjustment_type, item_id, reason_code, adjustment_date' },
        { status: 400 }
      );
    }

    if (!created_by) {
      return NextResponse.json(
        { error: 'created_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // CRITICAL: Enforce subscription feature access
    try {
      await assertFeatureAccess(business_id, 'purchase_inventory_adjustments');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check create permission (inventory adjustments are part of items module)
    try {
      await authorize(created_by, 'items', 'create');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // PBAC: Check warehouse access if warehouse mode is enabled and location_id provided
    if (location_id) {
      const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
      const warehouseModeEnabled = await isWarehouseModeEnabled(business_id);
      
      if (warehouseModeEnabled) {
        const { checkUserWarehouseAccess } = await import('@/lib/warehouse-access');
        const warehouseAccess = await checkUserWarehouseAccess(created_by, location_id);
        
        if (!warehouseAccess?.can_create_transactions) {
          return NextResponse.json(
            { 
              error: 'No access to warehouse. You do not have permission to create transactions in this warehouse.',
              warehouse_id: location_id,
              code: 'WAREHOUSE_ACCESS_DENIED'
            },
            { status: 403 }
          );
        }
      }
    }

    if (adjustment_type !== 'QUANTITY' && adjustment_type !== 'VALUE') {
      return NextResponse.json(
        { error: 'adjustment_type must be QUANTITY or VALUE' },
        { status: 400 }
      );
    }

    let result;

    if (adjustment_type === 'QUANTITY') {
      // Quantity adjustment validation
      if (!direction || !quantity) {
        return NextResponse.json(
          { error: 'direction and quantity are required for quantity adjustments' },
          { status: 400 }
        );
      }

      if (direction !== 'INCREASE' && direction !== 'DECREASE') {
        return NextResponse.json(
          { error: 'direction must be INCREASE or DECREASE' },
          { status: 400 }
        );
      }

      if (quantity <= 0) {
        return NextResponse.json(
          { error: 'quantity must be greater than zero' },
          { status: 400 }
        );
      }

      const params: QuantityAdjustmentParams = {
        businessId: business_id,
        itemId: item_id,
        variantId: variant_id || null,
        locationId: location_id || null,
        branchId: branch_id || null,
        direction: direction as 'INCREASE' | 'DECREASE',
        quantity: parseFloat(quantity),
        reasonCode: reason_code as ReasonCode,
        reasonNotes: reason_notes || undefined,
        notes: notes || undefined,
        adjustmentDate: adjustment_date,
        createdBy: created_by || undefined
      };

      result = await createQuantityAdjustment(params);
    } else {
      // Value adjustment validation
      if (value_change === undefined || value_change === null) {
        return NextResponse.json(
          { error: 'value_change is required for value adjustments' },
          { status: 400 }
        );
      }

      if (parseFloat(value_change) === 0) {
        return NextResponse.json(
          { error: 'value_change cannot be zero' },
          { status: 400 }
        );
      }

      const params: ValueAdjustmentParams = {
        businessId: business_id,
        itemId: item_id,
        variantId: variant_id || null,
        locationId: location_id || null,
        branchId: branch_id || null,
        valueChange: parseFloat(value_change),
        reasonCode: reason_code as ReasonCode,
        reasonNotes: reason_notes || undefined,
        notes: notes || undefined,
        adjustmentDate: adjustment_date,
        createdBy: created_by || undefined,
        gstImpact: gst_impact ? parseFloat(gst_impact) : undefined
      };

      result = await createValueAdjustment(params);
    }

    return NextResponse.json({
      success: true,
      adjustment: result
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating inventory adjustment:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
