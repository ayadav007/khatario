import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { getStockValue, ValuationMethod } from '@/lib/stock-valuation';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

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

    if (String(valuationMethod) === 'lifo') {
      return NextResponse.json(
        { error: 'LIFO is not permitted under AS 2 / Ind AS 2. Use FIFO or weighted average.', code: 'LIFO_NOT_ALLOWED' },
        { status: 400 }
      );
    }

    const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
    const warehouseMode = !locationId && (await isWarehouseModeEnabled(businessId));

    // Get all items (or items with stock)
    let sql: string;
    let params: any[];

    if (warehouseMode) {
      // In warehouse mode stock lives in location_stock; items.current_stock and
      // branch_item_stock are not maintained.
      sql = `
        SELECT 
          i.id,
          i.name,
          i.code,
          i.unit,
          COALESCE(ws.qty, 0) as current_stock,
          i.purchase_price,
          i.valuation_method,
          i.track_batch,
          i.track_serial
        FROM items i
        LEFT JOIN (
          SELECT ls.item_id, SUM(ls.current_stock_qty) AS qty
            FROM location_stock ls
            JOIN warehouses w ON w.id = ls.location_id AND w.business_id = $1
           WHERE $2::uuid IS NULL
              OR w.branch_id = $2::uuid
              OR EXISTS (SELECT 1 FROM branch_warehouses bw WHERE bw.warehouse_id = w.id AND bw.branch_id = $2::uuid)
           GROUP BY ls.item_id
        ) ws ON ws.item_id = i.id
        WHERE i.business_id = $1 AND i.is_active = true
      `;
      params = [businessId, branchIdParam || null];
    } else if (locationId) {
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
          COALESCE(
            bis.quantity,
            CASE WHEN $3::boolean AND NOT EXISTS (
              SELECT 1 FROM branch_item_stock x WHERE x.item_id = i.id AND x.business_id = i.business_id
            ) THEN i.current_stock END,
            0
          ) as current_stock,
          i.purchase_price,
          i.valuation_method,
          i.track_batch,
          i.track_serial
        FROM items i
        LEFT JOIN branch_item_stock bis
          ON bis.item_id = i.id AND bis.business_id = i.business_id AND bis.branch_id = $2::uuid
        WHERE i.business_id = $1 AND i.is_active = true
      `;
      const { isDefaultBranch } = await import('@/lib/branch-helpers');
      params = [businessId, branchIdParam, await isDefaultBranch(branchIdParam, businessId)];
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

    const today = new Date().toISOString().split('T')[0];
    const historical = !!asOnDate && /^\d{4}-\d{2}-\d{2}$/.test(asOnDate) && asOnDate < today;
    if (historical && branchIdParam && !locationId) {
      return NextResponse.json(
        {
          error: 'Historical valuation is available business-wide or per warehouse. Remove the branch filter or pick a warehouse.',
          code: 'AS_ON_DATE_BRANCH_UNSUPPORTED',
        },
        { status: 400 }
      );
    }
    let after = new Map<string, number>();
    const { weightedAverageCosts } = await import('@/lib/inventory/cogs-posting');
    // AS 2: inventory is carried at cost (weighted average of purchases), not at the master price.
    const wac = await weightedAverageCosts(undefined, businessId, items.map((i: any) => i.id), historical ? asOnDate! : today);
    if (historical) {
      const { movementsAfter } = await import('@/lib/inventory/stock-as-of');
      after = await movementsAfter(businessId, asOnDate!, { locationId });
    }

    const reportItems: any[] = [];
    let totalValue = 0;

    for (const item of items) {
      const currentQty = parseFloat(item.current_stock?.toString() || '0');
      const stockQty = historical
        ? Math.round((currentQty - (after.get(item.id) || 0)) * 1000) / 1000
        : currentQty;

      if (stockQty <= 0) continue; // Skip items with no stock

      const batchFifo = !historical && item.valuation_method === 'fifo' && item.track_batch === true;
      const itemValuationMethod = (batchFifo ? 'fifo' : 'weighted_avg') as ValuationMethod;

      const batchValue = batchFifo
        ? await getStockValue(item.id, 'fifo', businessId, locationId || undefined)
        : 0;
      const stockValue = batchFifo && batchValue > 0
        ? Math.round(batchValue * 100) / 100
        : Math.round(stockQty * (wac.get(item.id) ?? (Number(item.purchase_price) || 0)) * 100) / 100;

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
        as_on_date: historical ? asOnDate : today,
        valuation_method: 'weighted_avg',
        stock_source: warehouseMode ? 'warehouses' : locationId ? 'warehouse' : branchIdParam ? 'branch' : 'business',
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
