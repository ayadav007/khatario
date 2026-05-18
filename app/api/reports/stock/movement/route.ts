import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/movement
 * Get stock movement report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id');
    const itemId = searchParams.get('item_id'); // Optional filter
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const type = searchParams.get('type'); // 'in', 'out', 'adjustment' or null for all

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

    // CRITICAL: Enforce subscription report access
    try {
      await assertReportAccess(businessId, 'basic');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission for inventory report
    try {
      await authorize(userId, 'report.inventory', 'read', {
        businessId,
        warehouseId: warehouseId || undefined,
        resource: {
          business_id: businessId,
          warehouse_id: warehouseId || null,
        },
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

    let itemFilter = '';
    let typeFilter = '';
    let dateFilter = '';
    let branchFilter = '';
    const queryParams: any[] = [businessId];
    let paramIndex = 2;

    // Filter by branch if user has branch access
    if (accessibleBranchIds.length > 0) {
      // Filter stock movements by branch from reference transactions
      branchFilter = ` AND (
        (sm.reference_type = 'sale' AND EXISTS (
          SELECT 1 FROM invoices inv 
          WHERE inv.id = sm.reference_id 
          AND inv.deleted_at IS NULL
          AND inv.branch_id = ANY($${paramIndex}::uuid[])
        ))
        OR (sm.reference_type = 'purchase' AND EXISTS (
          SELECT 1 FROM purchases pur 
          WHERE pur.id = sm.reference_id 
          AND pur.deleted_at IS NULL
          AND pur.branch_id = ANY($${paramIndex}::uuid[])
        ))
        OR (sm.reference_type = 'adjustment' AND EXISTS (
          SELECT 1 FROM inventory_adjustments ia
          LEFT JOIN warehouses w ON ia.location_id = w.id
          LEFT JOIN branch_warehouses bw ON bw.warehouse_id = w.id
          WHERE ia.id = sm.reference_id
          AND (
            w.branch_id = ANY($${paramIndex}::uuid[])
            OR bw.branch_id = ANY($${paramIndex}::uuid[])
          )
        ))
      )`;
      queryParams.push(accessibleBranchIds);
      paramIndex++;
    }

    if (itemId) {
      itemFilter = ` AND sm.item_id = $${paramIndex}`;
      queryParams.push(itemId);
      paramIndex++;
    }

    if (type) {
      typeFilter = ` AND sm.type = $${paramIndex}`;
      queryParams.push(type);
      paramIndex++;
    }

    if (fromDate) {
      dateFilter += ` AND sm.created_at >= $${paramIndex}::date`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND sm.created_at <= $${paramIndex}::date + INTERVAL '1 day'`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const movements = await db.queryRows(`
      SELECT 
        sm.id,
        sm.created_at as movement_date,
        i.name as item_name,
        i.code as item_code,
        i.unit,
        sm.type,
        sm.quantity,
        sm.reference_type,
        sm.reference_id,
        sm.notes
      FROM stock_movements sm
      INNER JOIN items i ON sm.item_id = i.id
      WHERE sm.business_id = $1
        ${itemFilter}
        ${typeFilter}
        ${dateFilter}
        ${branchFilter}
      ORDER BY sm.created_at DESC
    `, queryParams);

    // Calculate totals by type
    const totals = movements.reduce((acc, row) => {
      const qty = parseFloat(row.quantity || 0);
      if (row.type === 'in') {
        acc.total_in += qty;
      } else if (row.type === 'out') {
        acc.total_out += qty;
      } else {
        acc.total_adjustment += qty;
      }
      return acc;
    }, {
      total_in: 0,
      total_out: 0,
      total_adjustment: 0,
    });

    return NextResponse.json({
      movements,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating stock movement report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

