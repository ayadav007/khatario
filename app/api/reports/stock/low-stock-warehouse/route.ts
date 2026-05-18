import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/low-stock-warehouse
 * Get low stock items per warehouse based on warehouse-specific reorder points
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id'); // Optional: filter by warehouse

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

    let query = `
      SELECT 
        bl.id as warehouse_id,
        bl.name as warehouse_name,
        i.id as item_id,
        i.name as item_name,
        i.code as item_code,
        i.unit,
        COALESCE(ls.current_stock_qty, 0) as current_stock,
        COALESCE(ls.min_stock_qty, 0) as min_stock,
        CASE 
          WHEN COALESCE(ls.current_stock_qty, 0) <= 0 THEN 'out_of_stock'
          WHEN COALESCE(ls.min_stock_qty, 0) > 0 
            AND COALESCE(ls.current_stock_qty, 0) <= COALESCE(ls.min_stock_qty, 0) THEN 'low_stock'
          ELSE 'in_stock'
        END as stock_status
      FROM business_locations bl
      CROSS JOIN items i
      LEFT JOIN location_stock ls ON ls.location_id = bl.id AND ls.item_id = i.id
      WHERE bl.business_id = $1
        AND bl.is_active = true
        AND i.business_id = $1
        AND i.is_active = true
        AND i.item_type = 'goods'
    `;

    const params: any[] = [businessId];

    if (warehouseId) {
      query += ` AND bl.id = $2`;
      params.push(warehouseId);
    }

    // Filter for low stock or out of stock
    query += `
      AND (
        COALESCE(ls.current_stock_qty, 0) <= 0
        OR (COALESCE(ls.min_stock_qty, 0) > 0 
            AND COALESCE(ls.current_stock_qty, 0) <= COALESCE(ls.min_stock_qty, 0))
      )
    `;

    query += ` ORDER BY bl.name, i.name`;

    const lowStockItems = await queryRows(query, params);

    // Group by warehouse
    const groupedByWarehouse: Record<string, any> = {};
    let totalLowStockItems = 0;
    let totalOutOfStockItems = 0;

    for (const item of lowStockItems) {
      const warehouseId = item.warehouse_id;
      if (!groupedByWarehouse[warehouseId]) {
        groupedByWarehouse[warehouseId] = {
          warehouse_id: warehouseId,
          warehouse_name: item.warehouse_name,
          items: []
        };
      }

      const stockStatus = item.stock_status;
      if (stockStatus === 'out_of_stock') {
        totalOutOfStockItems++;
      } else {
        totalLowStockItems++;
      }

      groupedByWarehouse[warehouseId].items.push({
        item_id: item.item_id,
        item_name: item.item_name,
        item_code: item.item_code,
        unit: item.unit,
        current_stock: parseFloat(item.current_stock?.toString() || '0'),
        min_stock: parseFloat(item.min_stock?.toString() || '0'),
        stock_status: stockStatus
      });
    }

    return NextResponse.json({
      warehouses: Object.values(groupedByWarehouse),
      summary: {
        total_warehouses: Object.keys(groupedByWarehouse).length,
        total_low_stock_items: totalLowStockItems,
        total_out_of_stock_items: totalOutOfStockItems,
        total_items: lowStockItems.length
      }
    });
  } catch (error: any) {
    console.error('Error fetching low stock warehouse report:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
