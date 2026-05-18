import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import {
  getUserIdFromRequest,
  getBusinessIdFromRequest,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * Get dashboard summary data
 * GET /api/dashboard?business_id=xxx&date=2024-01-15
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId =
      getSessionScopedBusinessId(request) ?? getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const date = searchParams.get('date') || new Date().toISOString().split('T')[0];

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }

    // Get user's accessible branch IDs if userId provided
    let accessibleBranchIds: string[] = [];
    if (userId) {
      try {
        const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
        accessibleBranchIds = await getUserAccessibleBranchIds(userId);
        if (accessibleBranchIds.length === 0) {
          // User has no branch access - return empty results
          return NextResponse.json({
            kpis: { todaySales: 0, todayPurchases: 0, receivables: 0, payables: 0 },
            recentInvoices: [],
            lowStockItems: [],
          });
        }
      } catch (error) {
        console.error('Error fetching user accessible branches:', error);
        // Continue without branch filtering if error
      }
    }

    // Today's Sales
    const todaySalesParams = accessibleBranchIds.length > 0 ? [businessId, date, accessibleBranchIds] : [businessId, date];
    const todaySalesFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($3::uuid[])` : '';
    const todaySales = await queryOne<{ total: number }>(`
      SELECT COALESCE(SUM(grand_total), 0) as total
      FROM invoices
      WHERE business_id = $1 
        AND deleted_at IS NULL
        AND invoice_date = $2 
        AND status IN ('final', 'paid')
        ${todaySalesFilter}
    `, todaySalesParams);

    // Today's Purchases
    const todayPurchasesParams = accessibleBranchIds.length > 0 ? [businessId, date, accessibleBranchIds] : [businessId, date];
    const todayPurchasesFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($3::uuid[])` : '';
    const todayPurchases = await queryOne<{ total: number }>(`
      SELECT COALESCE(SUM(grand_total), 0) as total
      FROM purchases
      WHERE business_id = $1 
        AND deleted_at IS NULL
        AND bill_date = $2 
        AND status IN ('final', 'paid')
        ${todayPurchasesFilter}
    `, todayPurchasesParams);

    // Total Receivables
    // Only count finalized invoices (not proforma) as receivables
    const receivablesParams = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const receivablesFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($2::uuid[])` : '';
    const receivables = await queryOne<{ total: number }>(`
      SELECT COALESCE(SUM(balance_amount), 0) as total
      FROM invoices
      WHERE business_id = $1 
        AND deleted_at IS NULL
        AND status = 'final'
        AND (document_type IS NULL OR document_type != 'proforma_invoice')
        AND balance_amount > 0
        ${receivablesFilter}
    `, receivablesParams);

    // Total Payables
    const payablesParams = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const payablesFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($2::uuid[])` : '';
    const payables = await queryOne<{ total: number }>(`
      SELECT COALESCE(SUM(grand_total - paid_amount), 0) as total
      FROM purchases
      WHERE business_id = $1 
        AND deleted_at IS NULL
        AND status IN ('final', 'paid')
        AND (grand_total - paid_amount) > 0
        ${payablesFilter}
    `, payablesParams);

    // Recent Invoices
    const recentInvoicesParams = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const recentInvoicesFilter = accessibleBranchIds.length > 0 
      ? `AND i.branch_id IS NOT NULL AND i.branch_id = ANY($2::uuid[])` 
      : '';
    const recentInvoices = await queryRows<any>(`
      SELECT 
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.grand_total,
        i.status,
        i.paid_amount,
        i.balance_amount,
        c.name as customer_name
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        ${recentInvoicesFilter}
      ORDER BY i.created_at DESC
      LIMIT 10
    `, recentInvoicesParams);

    // Low Stock Items - filter by branch if user has branch access
    let lowStockItemsSql = '';
    let lowStockItemsParams: any[] = [businessId];
    
    if (accessibleBranchIds.length > 0) {
      // Sum branch_item_stock across branches the user can access (falls back to items.current_stock if no rows)
      lowStockItemsSql = `
        SELECT 
          i.id,
          i.name,
          COALESCE(
            (SELECT SUM(bis.quantity) FROM branch_item_stock bis
             WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = ANY($2::uuid[])),
            i.current_stock,
            0
          ) as current_stock,
          i.min_stock,
          i.unit
        FROM items i
        WHERE i.business_id = $1
          AND i.is_active = true
          AND COALESCE(
            (SELECT SUM(bis.quantity) FROM branch_item_stock bis
             WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = ANY($2::uuid[])),
            i.current_stock,
            0
          ) <= COALESCE(i.min_stock, 0)
        ORDER BY (
          COALESCE(
            (SELECT SUM(bis.quantity) FROM branch_item_stock bis
             WHERE bis.business_id = i.business_id AND bis.item_id = i.id AND bis.branch_id = ANY($2::uuid[])),
            i.current_stock,
            0
          ) - COALESCE(i.min_stock, 0)
        ) ASC
        LIMIT 10
      `;
      lowStockItemsParams.push(accessibleBranchIds);
    } else {
      // No branch scope: items.current_stock is the denormalized business aggregate (see migration 159 COMMENT)
      lowStockItemsSql = `
        SELECT 
          id,
          name,
          current_stock,
          min_stock,
          unit
        FROM items
        WHERE business_id = $1
          AND is_active = true
          AND current_stock <= min_stock
        ORDER BY (current_stock - min_stock) ASC
        LIMIT 10
      `;
    }
    
    const lowStockItems = await queryRows<any>(lowStockItemsSql, lowStockItemsParams);

    return NextResponse.json({
      kpis: {
        todaySales: todaySales?.total || 0,
        todayPurchases: todayPurchases?.total || 0,
        receivables: receivables?.total || 0,
        payables: payables?.total || 0,
      },
      recentInvoices: recentInvoices.map((inv) => ({
        id: inv.id,
        number: inv.invoice_number,
        customer: inv.customer_name || 'Walk-in Customer',
        date: inv.invoice_date,
        amount: inv.grand_total,
        status: inv.balance_amount === 0 ? 'paid' : inv.status === 'final' ? 'unpaid' : inv.status,
      })),
      lowStockItems: lowStockItems.map((item) => ({
        id: item.id,
        name: item.name,
        stock: parseFloat(item.current_stock),
        minStock: parseFloat(item.min_stock),
        status: item.current_stock === 0 ? 'critical' : item.current_stock <= item.min_stock ? 'low' : 'ok',
      })),
    });
  } catch (error: any) {
    console.error('Error fetching dashboard data:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

