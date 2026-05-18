import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/damaged
 * Get damaged/wastage stock report
 * This looks for stock movements with type 'adjustment' and notes indicating damage/wastage
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

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

    let dateFilter = '';
    const queryParams: any[] = [businessId];
    let paramIndex = 2;

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

    // Look for adjustment movements with negative quantities (reductions) that indicate damage/wastage
    const damaged = await db.queryRows(`
      SELECT 
        sm.id,
        sm.created_at as damage_date,
        i.name as item_name,
        i.code,
        i.unit,
        i.purchase_price,
        ABS(sm.quantity) as damaged_qty,
        (ABS(sm.quantity) * i.purchase_price) as damage_value,
        sm.notes
      FROM stock_movements sm
      INNER JOIN items i ON sm.item_id = i.id
      WHERE sm.business_id = $1
        AND sm.type = 'adjustment'
        AND sm.quantity < 0
        ${dateFilter}
      ORDER BY sm.created_at DESC
    `, queryParams);

    // Calculate totals
    const totals = damaged.reduce((acc, row) => {
      acc.total_items += 1;
      acc.total_qty += parseFloat(row.damaged_qty || 0);
      acc.total_value += parseFloat(row.damage_value || 0);
      return acc;
    }, {
      total_items: 0,
      total_qty: 0,
      total_value: 0,
    });

    return NextResponse.json({
      damaged,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating damaged stock report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

