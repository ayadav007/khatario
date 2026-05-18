import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/summary
 * Get stock summary report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const warehouseId = searchParams.get('warehouse_id'); // Optional: filter by warehouse
    const categoryId = searchParams.get('category_id'); // Optional filter

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

    // AUTHORIZATION: Check read permission for inventory report (PBAC will check warehouse access, business ownership)
    // Note: Warehouse filtering happens AFTER authorization - PBAC enforces scope
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

    let categoryFilter = '';
    const queryParams: any[] = [businessId];
    let paramIndex = 2;

    if (categoryId) {
      categoryFilter = ` AND i.category_id = $${paramIndex}`;
      queryParams.push(categoryId);
      paramIndex++;
    }

    // Calculate branch-specific stock if user has branch access
    let stockSql = '';
    if (accessibleBranchIds.length > 0) {
      queryParams.push(accessibleBranchIds);
      // Calculate stock per branch from stock_movements
      stockSql = `
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
              (sm.reference_type = 'sale' AND inv.branch_id = ANY($${paramIndex}::uuid[]))
              OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($${paramIndex}::uuid[]))
            )
            ), 
            i.current_stock
          ) as current_stock,
          i.min_stock,
          i.opening_stock,
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
              (sm.reference_type = 'sale' AND inv.branch_id = ANY($${paramIndex}::uuid[]))
              OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($${paramIndex}::uuid[]))
            )
            ), 
            i.current_stock
          ) * i.purchase_price as stock_value,
          CASE 
            WHEN COALESCE(
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
                (sm.reference_type = 'sale' AND inv.branch_id = ANY($${paramIndex}::uuid[]))
                OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($${paramIndex}::uuid[]))
              )
              ), 
              i.current_stock
            ) <= 0 THEN 'out_of_stock'
            WHEN COALESCE(
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
                (sm.reference_type = 'sale' AND inv.branch_id = ANY($${paramIndex}::uuid[]))
                OR (sm.reference_type = 'purchase' AND pur.branch_id = ANY($${paramIndex}::uuid[]))
              )
              ), 
              i.current_stock
            ) <= i.min_stock THEN 'low_stock'
            ELSE 'in_stock'
          END as stock_status
        FROM items i
        WHERE i.business_id = $1 
          AND i.is_active = true
          ${categoryFilter}
        ORDER BY i.name
      `;
    } else {
      // No branch filtering - use business-level stock
      stockSql = `
        SELECT 
          i.id,
          i.name as item_name,
          i.code,
          i.unit,
          i.current_stock,
          i.min_stock,
          i.opening_stock,
          i.purchase_price,
          i.selling_price,
          (i.current_stock * i.purchase_price) as stock_value,
          CASE 
            WHEN i.current_stock <= 0 THEN 'out_of_stock'
            WHEN i.current_stock <= i.min_stock THEN 'low_stock'
            ELSE 'in_stock'
          END as stock_status
        FROM items i
        WHERE i.business_id = $1 
          AND i.is_active = true
          ${categoryFilter}
        ORDER BY i.name
      `;
    }

    const stock = await db.queryRows(stockSql, queryParams);

    // Calculate totals
    const totals = stock.reduce((acc, row) => {
      acc.total_items += 1;
      acc.total_quantity += parseFloat(row.current_stock || 0);
      acc.total_value += parseFloat(row.stock_value || 0);
      if (row.stock_status === 'out_of_stock') acc.out_of_stock += 1;
      if (row.stock_status === 'low_stock') acc.low_stock += 1;
      return acc;
    }, {
      total_items: 0,
      total_quantity: 0,
      total_value: 0,
      out_of_stock: 0,
      low_stock: 0,
    });

    return NextResponse.json({
      stock,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating stock summary report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

