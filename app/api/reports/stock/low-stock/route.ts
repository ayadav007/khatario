import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/low-stock
 * Get low stock report (items below minimum stock level)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const warehouseId = searchParams.get('warehouse_id');

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

    // Get user's accessible branch IDs for stock filtering
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      // Continue without branch filtering if error
    }

    // Calculate branch-specific stock if user has branch access
    let lowStockSql = '';
    const params: any[] = [businessId];
    
    if (accessibleBranchIds.length > 0) {
      // Calculate branch-specific stock from stock_movements
      lowStockSql = `
        SELECT 
          i.id,
          i.name as item_name,
          i.code,
          i.unit,
          COALESCE(
            (SELECT SUM(
              CASE 
                WHEN sm.type = 'in' THEN sm.quantity
                WHEN sm.type = 'out' THEN -sm.quantity
                WHEN sm.type = 'adjustment' THEN sm.quantity
                ELSE 0
              END
            )
            FROM stock_movements sm
            LEFT JOIN invoices inv ON sm.reference_type = 'sale' AND sm.reference_id = inv.id AND inv.deleted_at IS NULL
            LEFT JOIN purchases pur ON sm.reference_type = 'purchase' AND sm.reference_id = pur.id AND pur.deleted_at IS NULL
            WHERE sm.item_id = i.id 
            AND (
              (sm.reference_type = 'sale' AND inv.branch_id = ANY($2::uuid[]))
              OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($2::uuid[]))
            )
            ), 
            i.current_stock
          ) as current_stock,
          i.min_stock,
          i.purchase_price,
          i.selling_price,
          COALESCE(
            (SELECT SUM(
              CASE 
                WHEN sm.type = 'in' THEN sm.quantity
                WHEN sm.type = 'out' THEN -sm.quantity
                WHEN sm.type = 'adjustment' THEN sm.quantity
                ELSE 0
              END
            )
            FROM stock_movements sm
            LEFT JOIN invoices inv ON sm.reference_type = 'sale' AND sm.reference_id = inv.id AND inv.deleted_at IS NULL
            LEFT JOIN purchases pur ON sm.reference_type = 'purchase' AND sm.reference_id = pur.id AND pur.deleted_at IS NULL
            WHERE sm.item_id = i.id 
            AND (
              (sm.reference_type = 'sale' AND inv.branch_id = ANY($2::uuid[]))
              OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($2::uuid[]))
            )
            ), 
            i.current_stock
          ) * i.purchase_price as stock_value,
          (i.min_stock - COALESCE(
            (SELECT SUM(
              CASE 
                WHEN sm.type = 'in' THEN sm.quantity
                WHEN sm.type = 'out' THEN -sm.quantity
                WHEN sm.type = 'adjustment' THEN sm.quantity
                ELSE 0
              END
            )
            FROM stock_movements sm
            LEFT JOIN invoices inv ON sm.reference_type = 'sale' AND sm.reference_id = inv.id AND inv.deleted_at IS NULL
            LEFT JOIN purchases pur ON sm.reference_type = 'purchase' AND sm.reference_id = pur.id AND pur.deleted_at IS NULL
            WHERE sm.item_id = i.id 
            AND (
              (sm.reference_type = 'sale' AND inv.branch_id = ANY($2::uuid[]))
              OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($2::uuid[]))
            )
            ), 
            i.current_stock
          )) as shortage
        FROM items i
        WHERE i.business_id = $1 
          AND i.is_active = true
          AND COALESCE(
            (SELECT SUM(
              CASE 
                WHEN sm.type = 'in' THEN sm.quantity
                WHEN sm.type = 'out' THEN -sm.quantity
                WHEN sm.type = 'adjustment' THEN sm.quantity
                ELSE 0
              END
            )
            FROM stock_movements sm
            LEFT JOIN invoices inv ON sm.reference_type = 'sale' AND sm.reference_id = inv.id AND inv.deleted_at IS NULL
            LEFT JOIN purchases pur ON sm.reference_type = 'purchase' AND sm.reference_id = pur.id AND pur.deleted_at IS NULL
            WHERE sm.item_id = i.id 
            AND (
              (sm.reference_type = 'sale' AND inv.branch_id = ANY($2::uuid[]))
              OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($2::uuid[]))
            )
            ), 
            i.current_stock
          ) <= i.min_stock
        ORDER BY (i.min_stock - COALESCE(
          (SELECT SUM(
            CASE 
              WHEN sm.type = 'in' THEN sm.quantity
              WHEN sm.type = 'out' THEN -sm.quantity
              WHEN sm.type = 'adjustment' THEN sm.quantity
              ELSE 0
            END
          )
          FROM stock_movements sm
          LEFT JOIN invoices inv ON sm.reference_type = 'sale' AND sm.reference_id = inv.id AND inv.deleted_at IS NULL
          LEFT JOIN purchases pur ON sm.reference_type = 'purchase' AND sm.reference_id = pur.id AND pur.deleted_at IS NULL
          WHERE sm.item_id = i.id 
          AND (
            (sm.reference_type = 'sale' AND inv.branch_id = ANY($2::uuid[]))
            OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($2::uuid[]))
          )
          ), 
          i.current_stock
        )) DESC, i.name
      `;
      params.push(accessibleBranchIds);
    } else {
      // No branch filtering - use business-level stock
      lowStockSql = `
        SELECT 
          i.id,
          i.name as item_name,
          i.code,
          i.unit,
          i.current_stock,
          i.min_stock,
          i.purchase_price,
          i.selling_price,
          (i.current_stock * i.purchase_price) as stock_value,
          (i.min_stock - i.current_stock) as shortage
        FROM items i
        WHERE i.business_id = $1 
          AND i.is_active = true
          AND i.current_stock <= i.min_stock
        ORDER BY (i.min_stock - i.current_stock) DESC, i.name
      `;
    }

    const lowStock = await db.queryRows(lowStockSql, params);

    // Calculate totals
    const totals = lowStock.reduce((acc, row) => {
      acc.total_items += 1;
      acc.total_shortage += parseFloat(row.shortage || 0);
      acc.total_value += parseFloat(row.stock_value || 0);
      return acc;
    }, {
      total_items: 0,
      total_shortage: 0,
      total_value: 0,
    });

    return NextResponse.json({
      lowStock,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating low stock report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

