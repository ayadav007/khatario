import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/profit-margin
 * Get item profit margin report (selling price vs purchase price)
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
      await assertReportAccess(businessId, 'advanced');
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
      dateFilter += ` AND i.invoice_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND i.invoice_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    // Get items with their sales and purchase data
    const profitMargin = await db.queryRows(`
      SELECT 
        item.id,
        item.name as item_name,
        item.code,
        item.purchase_price,
        item.selling_price,
        COALESCE(SUM(ii.quantity) FILTER (WHERE i.status != 'cancelled'), 0) as total_sold_qty,
        COALESCE(SUM(ii.line_total) FILTER (WHERE i.status != 'cancelled'), 0) as total_sales_value,
        COALESCE(AVG(ii.unit_price) FILTER (WHERE i.status != 'cancelled'), 0) as avg_selling_price,
        CASE 
          WHEN item.purchase_price > 0 
          THEN ((item.selling_price - item.purchase_price) / item.purchase_price * 100)
          ELSE 0
        END as margin_percent,
        (item.selling_price - item.purchase_price) as margin_amount
      FROM items item
      LEFT JOIN invoice_items ii ON item.id = ii.item_id
      LEFT JOIN invoices i ON ii.invoice_id = i.id AND i.deleted_at IS NULL
      WHERE item.business_id = $1 
        AND item.is_active = true
        ${dateFilter.replace(/i\.invoice_date/g, 'i.invoice_date')}
      GROUP BY item.id, item.name, item.code, item.purchase_price, item.selling_price
      HAVING COALESCE(SUM(ii.quantity) FILTER (WHERE i.status != 'cancelled'), 0) > 0
      ORDER BY margin_percent DESC
    `, queryParams);

    // Calculate totals
    const totals = profitMargin.reduce((acc, row) => {
      acc.total_items += 1;
      acc.total_sold_qty += parseFloat(row.total_sold_qty || 0);
      acc.total_sales_value += parseFloat(row.total_sales_value || 0);
      return acc;
    }, {
      total_items: 0,
      total_sold_qty: 0,
      total_sales_value: 0,
    });

    return NextResponse.json({
      profitMargin,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating profit margin report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

