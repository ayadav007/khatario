import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { getStockValue, ValuationMethod } from '@/lib/stock-valuation';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/valuation
 * Generate stock valuation report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    // Accept warehouse_id (new) or location_id (legacy) - both refer to warehouse ID
    const warehouseId = searchParams.get('warehouse_id') || searchParams.get('location_id');
    const branchIdParam = searchParams.get('branch_id');
    const asOnDate = searchParams.get('as_on_date'); // Optional: date for historical valuation
    const valuationMethod = (searchParams.get('valuation_method') || 'simple') as ValuationMethod;
    // locationId is used for the location_stock table query (column name is location_id but references warehouses.id)
    const locationId = warehouseId; // Use warehouseId for location_stock queries

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
      await assertReportAccess(businessId, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission for inventory report
    // If warehouse is specified, also check warehouse access
    try {
      // First check report access
      await authorize(userId, 'report.inventory', 'read', {
        businessId,
        warehouseId: warehouseId || undefined,
        resource: {
          business_id: businessId,
          warehouse_id: warehouseId || null,
        },
      });

      // If warehouse is specified, also check warehouse read permission
      if (warehouseId) {
        // Fetch warehouse to pass as resource for authorization
        const { queryOne } = await import('@/lib/db');
        const warehouse = await queryOne(
          'SELECT * FROM warehouses WHERE id = $1 AND business_id = $2',
          [warehouseId, businessId]
        );

        if (!warehouse) {
          return NextResponse.json(
            { error: 'Warehouse not found' },
            { status: 404 }
          );
        }

        // Check warehouse read permission
        await authorize(userId, 'warehouse', 'read', {
          businessId,
          warehouseId: warehouseId,
          resource: warehouse,
        });
      }
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get all items (or items with stock)
    let sql: string;
    let params: any[];

    if (locationId) {
      sql = `
        SELECT 
          i.id,
          i.name,
          i.code,
          i.unit,
          ls.current_stock_qty as current_stock,
          i.purchase_price,
          i.valuation_method,
          i.track_batch,
          i.track_serial
        FROM items i
        JOIN location_stock ls ON i.id = ls.item_id
        WHERE i.business_id = $1 AND ls.location_id = $2 AND i.is_active = true
      `;
      params = [businessId, locationId];
    } else if (branchIdParam) {
      sql = `
        SELECT 
          i.id,
          i.name,
          i.code,
          i.unit,
          COALESCE(bis.quantity, i.current_stock, 0) as current_stock,
          i.purchase_price,
          i.valuation_method,
          i.track_batch,
          i.track_serial
        FROM items i
        LEFT JOIN branch_item_stock bis
          ON bis.item_id = i.id AND bis.business_id = i.business_id AND bis.branch_id = $2::uuid
        WHERE i.business_id = $1 AND i.is_active = true
      `;
      params = [businessId, branchIdParam];
    } else {
      sql = `
        SELECT 
          i.id,
          i.name,
          i.code,
          i.unit,
          i.current_stock,
          i.purchase_price,
          i.valuation_method,
          i.track_batch,
          i.track_serial
        FROM items i
        WHERE i.business_id = $1 AND i.is_active = true
      `;
      params = [businessId];
    }

    sql += ` ORDER BY i.name ASC`;

    const items = await queryRows(sql, params);

    const reportItems: any[] = [];
    let totalValue = 0;

    for (const item of items) {
      const stockQty = parseFloat(item.current_stock?.toString() || '0');
      
      if (stockQty <= 0) continue; // Skip items with no stock

      const itemValuationMethod = (item.valuation_method || valuationMethod) as ValuationMethod;
      
      // Get stock value using the valuation method
      const stockValue = await getStockValue(
        item.id,
        itemValuationMethod,
        businessId,
        locationId || undefined,
        branchIdParam && !locationId ? branchIdParam : undefined
      );

      const unitCost = stockQty > 0 ? stockValue / stockQty : 0;

      reportItems.push({
        item_id: item.id,
        item_name: item.name,
        item_code: item.code,
        unit: item.unit,
        quantity: stockQty,
        unit_cost: unitCost,
        total_value: stockValue,
        valuation_method: itemValuationMethod,
        track_batch: item.track_batch,
        track_serial: item.track_serial,
      });

      totalValue += stockValue;
    }

    return NextResponse.json({
      report: {
        as_on_date: asOnDate || new Date().toISOString().split('T')[0],
        valuation_method: valuationMethod,
        location_id: locationId || null,
        items: reportItems,
        total_value: totalValue,
        item_count: reportItems.length,
      },
    });
  } catch (error: any) {
    console.error('Error generating stock valuation report:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
