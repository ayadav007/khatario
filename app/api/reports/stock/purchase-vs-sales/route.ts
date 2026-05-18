import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/stock/purchase-vs-sales
 * Get item purchase vs sales comparison report
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
      dateFilter += ` AND transaction_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND transaction_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    // Get purchase data
    const purchaseData = await db.queryRows(`
      SELECT 
        pi.item_id,
        SUM(pi.quantity) as purchased_qty,
        SUM(pi.line_total) as purchased_value,
        AVG(pi.unit_price) as avg_purchase_price
      FROM purchase_items pi
      INNER JOIN purchases p ON pi.purchase_id = p.id AND p.deleted_at IS NULL
      WHERE p.business_id = $1 
        AND p.status != 'cancelled'
        ${dateFilter.replace(/transaction_date/g, 'p.bill_date')}
      GROUP BY pi.item_id
    `, queryParams);

    // Get sales data
    const salesData = await db.queryRows(`
      SELECT 
        ii.item_id,
        SUM(ii.quantity) as sold_qty,
        SUM(ii.line_total) as sold_value,
        AVG(ii.unit_price) as avg_sale_price
      FROM invoice_items ii
      INNER JOIN invoices i ON ii.invoice_id = i.id AND i.deleted_at IS NULL
      WHERE i.business_id = $1 
        AND i.status != 'cancelled'
        ${dateFilter.replace(/transaction_date/g, 'i.invoice_date')}
      GROUP BY ii.item_id
    `, queryParams);

    // Combine and match with items
    const items = await db.queryRows(`
      SELECT id, name, code, unit, current_stock
      FROM items
      WHERE business_id = $1 AND is_active = true
    `, [businessId]);

    const comparison = items.map(item => {
      const purchase = purchaseData.find(p => p.item_id === item.id) || {
        purchased_qty: 0,
        purchased_value: 0,
        avg_purchase_price: 0,
      };
      const sales = salesData.find(s => s.item_id === item.id) || {
        sold_qty: 0,
        sold_value: 0,
        avg_sale_price: 0,
      };

      return {
        item_id: item.id,
        item_name: item.name,
        code: item.code,
        unit: item.unit,
        current_stock: parseFloat(item.current_stock || 0),
        purchased_qty: parseFloat(purchase.purchased_qty || 0),
        purchased_value: parseFloat(purchase.purchased_value || 0),
        avg_purchase_price: parseFloat(purchase.avg_purchase_price || 0),
        sold_qty: parseFloat(sales.sold_qty || 0),
        sold_value: parseFloat(sales.sold_value || 0),
        avg_sale_price: parseFloat(sales.avg_sale_price || 0),
        profit: parseFloat(sales.sold_value || 0) - parseFloat(purchase.purchased_value || 0),
      };
    }).filter(item => item.purchased_qty > 0 || item.sold_qty > 0);

    // Calculate totals
    const totals = comparison.reduce((acc, row) => {
      acc.total_purchased_qty += row.purchased_qty;
      acc.total_purchased_value += row.purchased_value;
      acc.total_sold_qty += row.sold_qty;
      acc.total_sold_value += row.sold_value;
      acc.total_profit += row.profit;
      return acc;
    }, {
      total_purchased_qty: 0,
      total_purchased_value: 0,
      total_sold_qty: 0,
      total_sold_value: 0,
      total_profit: 0,
    });

    return NextResponse.json({
      comparison,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating purchase vs sales report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

