import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows } from '@/lib/db';
import { getCacheKey, getCached, setCache } from '@/lib/cache';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
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
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    // Get user's accessible branch IDs if userId provided
    let accessibleBranchIds: string[] = [];
    if (userId) {
      try {
        const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
        accessibleBranchIds = await getUserAccessibleBranchIds(userId);
        console.log(`[Dashboard Overview] User ${userId} accessible branches:`, accessibleBranchIds);
        if (accessibleBranchIds.length === 0) {
          // User has no branch access - return empty results
          console.log(`[Dashboard Overview] User ${userId} has no branch access, returning empty results`);
          return NextResponse.json({
            sales: 0,
            purchases: 0,
            collection: 0,
            cogs: 0,
            profit: 0,
            receivables: { total: 0, aging: { current: 0, days_1_15: 0, days_16_30: 0, days_31_45: 0, days_45_plus: 0 } },
            payables: { total: 0, aging: { current: 0, days_1_15: 0, days_16_30: 0, days_31_45: 0, days_45_plus: 0 } },
            recentInvoices: [],
            draftInvoicesCount: 0,
            lowStockItems: [],
            invoiceAlerts: { overdue: { count: 0, total_amount: 0 }, due_tomorrow: { count: 0, total_amount: 0 }, due_in_3_days: { count: 0, total_amount: 0 } }
          });
        }
      } catch (error) {
        console.error('[Dashboard Overview] Error fetching user accessible branches:', error);
        // If error fetching branches, return empty results to be safe
        return NextResponse.json({
          sales: 0,
          purchases: 0,
          collection: 0,
          cogs: 0,
          profit: 0,
          receivables: { total: 0, aging: { current: 0, days_1_15: 0, days_16_30: 0, days_31_45: 0, days_45_plus: 0 } },
          payables: { total: 0, aging: { current: 0, days_1_15: 0, days_16_30: 0, days_31_45: 0, days_45_plus: 0 } },
          recentInvoices: [],
          draftInvoicesCount: 0,
          lowStockItems: [],
          invoiceAlerts: { overdue: { count: 0, total_amount: 0 }, due_tomorrow: { count: 0, total_amount: 0 }, due_in_3_days: { count: 0, total_amount: 0 } }
        });
      }
    }

    const branchIdParam = searchParams.get('branch_id');

    /** Same admin resolution as GET /api/invoices (branch scope for counts). */
    let isAdmin = false;
    if (userId) {
      try {
        const { checkUserPermission } = await import('@/lib/permissions');
        isAdmin = await checkUserPermission(userId, 'settings', 'read');
      } catch {
        isAdmin = false;
      }
      if (!isAdmin) {
        const u = await queryOne<{ is_primary_admin: boolean }>(
          'SELECT is_primary_admin FROM users WHERE id = $1',
          [userId]
        );
        isAdmin = u?.is_primary_admin || false;
      }
    }

    // Check cache first (include userId in cache key if provided for branch-specific caching)
    const params: Record<string, string> = { business_id: businessId };
    if (userId) params.user_id = userId;
    if (startDate) params.start_date = startDate;
    if (endDate) params.end_date = endDate;
    if (branchIdParam) params.branch_id = branchIdParam;
    const cacheKey = getCacheKey('/api/dashboard/overview', params);
    const cached = getCached(cacheKey);
    if (cached) {
      return NextResponse.json(cached);
    }

    // Build date filter for invoices
    let invoiceDateFilter = '';
    let invoiceParams: any[] = [businessId];
    let invoiceParamIndex = 2;
    if (startDate && endDate) {
      invoiceDateFilter = `AND invoice_date >= $${invoiceParamIndex} AND invoice_date <= $${invoiceParamIndex + 1}`;
      invoiceParams.push(startDate, endDate);
      invoiceParamIndex += 2;
    } else {
      // Default to today
      invoiceDateFilter = `AND invoice_date = CURRENT_DATE`;
    }

    // Add branch filter for invoices
    const invoiceBranchFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($${invoiceParamIndex}::uuid[])` : '';
    if (accessibleBranchIds.length > 0) {
      invoiceParams.push(accessibleBranchIds);
    }

    // Build date filter for purchases
    let purchaseDateFilter = '';
    let purchaseParams: any[] = [businessId];
    let purchaseParamIndex = 2;
    if (startDate && endDate) {
      purchaseDateFilter = `AND bill_date >= $${purchaseParamIndex} AND bill_date <= $${purchaseParamIndex + 1}`;
      purchaseParams.push(startDate, endDate);
      purchaseParamIndex += 2;
    } else {
      purchaseDateFilter = `AND bill_date = CURRENT_DATE`;
    }

    // Add branch filter for purchases
    const purchaseBranchFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($${purchaseParamIndex}::uuid[])` : '';
    if (accessibleBranchIds.length > 0) {
      purchaseParams.push(accessibleBranchIds);
    }

    // COGS params (Cost of Goods Sold)
    let cogsDateFilter = '';
    let cogsParams: any[] = [businessId];
    let cogsParamIndex = 2;
    if (startDate && endDate) {
      cogsDateFilter = `AND inv.invoice_date >= $${cogsParamIndex} AND inv.invoice_date <= $${cogsParamIndex + 1}`;
      cogsParams.push(startDate, endDate);
      cogsParamIndex += 2;
    } else {
      cogsDateFilter = `AND inv.invoice_date = CURRENT_DATE`;
    }
    const cogsBranchFilter = accessibleBranchIds.length > 0 ? `AND inv.branch_id = ANY($${cogsParamIndex}::uuid[])` : '';
    if (accessibleBranchIds.length > 0) {
      cogsParams.push(accessibleBranchIds);
    }

    // Collection (customer payments received in period)
    let collectionDateFilter = '';
    let collectionParams: any[] = [businessId];
    let collectionParamIndex = 2;
    if (startDate && endDate) {
      collectionDateFilter = `AND payment_date >= $${collectionParamIndex} AND payment_date <= $${collectionParamIndex + 1}`;
      collectionParams.push(startDate, endDate);
      collectionParamIndex += 2;
    } else {
      collectionDateFilter = `AND payment_date = CURRENT_DATE`;
    }
    const collectionBranchFilter =
      accessibleBranchIds.length > 0 ? `AND branch_id = ANY($${collectionParamIndex}::uuid[])` : '';
    if (accessibleBranchIds.length > 0) {
      collectionParams.push(accessibleBranchIds);
    }

    // 1–4. Sales, Purchases, COGS, Collection in parallel
    const [salesRes, purchasesRes, cogsRes, collectionRes] = await Promise.all([
      queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(grand_total), 0) as total 
         FROM invoices 
         WHERE business_id = $1 ${invoiceDateFilter} 
           AND deleted_at IS NULL
           AND status = 'final'
           AND (document_type IS NULL OR document_type != 'proforma_invoice')
           ${invoiceBranchFilter}`,
        invoiceParams
      ),
      queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(grand_total), 0) as total 
         FROM purchases 
         WHERE business_id = $1 ${purchaseDateFilter} 
           AND deleted_at IS NULL
           AND status != 'cancelled'
           ${purchaseBranchFilter}`,
        purchaseParams
      ),
      queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(ii.quantity * COALESCE(i.purchase_price, 0)), 0) as total
         FROM invoice_items ii
         JOIN invoices inv ON ii.invoice_id = inv.id AND inv.deleted_at IS NULL
         LEFT JOIN items i ON ii.item_id = i.id
         WHERE inv.business_id = $1 
           ${cogsDateFilter}
           AND inv.status = 'final'
           AND (inv.document_type IS NULL OR inv.document_type != 'proforma_invoice')
           AND i.id IS NOT NULL
           ${cogsBranchFilter}`,
        cogsParams
      ),
      queryOne<{ total: number }>(
        `SELECT COALESCE(SUM(ABS(amount)), 0) as total
         FROM payments
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND type = 'receivable'
           ${collectionDateFilter}
           ${collectionBranchFilter}`,
        collectionParams
      ),
    ]);

    // 4–5. Receivables and Payables rows in parallel (then we compute aging below)
    const receivablesParams = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const receivablesBranchFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($2::uuid[])` : '';
    const payablesParams = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const payablesBranchFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($2::uuid[])` : '';

    const [receivablesInvoices, payablesPurchases] = await Promise.all([
      queryRows<{
        id: string;
        invoice_date: string;
        due_date: string | null;
        grand_total: number;
        paid_amount: number;
      }>(
        `SELECT 
          id,
          invoice_date,
          due_date,
          grand_total,
          COALESCE(paid_amount, 0) as paid_amount
         FROM invoices
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND status = 'final'
           AND (document_type IS NULL OR document_type != 'proforma_invoice')
           AND (grand_total - COALESCE(paid_amount, 0)) > 0
           ${receivablesBranchFilter}`,
        receivablesParams
      ),
      queryRows<{
        id: string;
        bill_date: string;
        grand_total: number;
        paid_amount: number;
      }>(
        `SELECT 
          id,
          bill_date,
          grand_total,
          COALESCE(paid_amount, 0) as paid_amount
         FROM purchases
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND status != 'cancelled'
           AND (grand_total - COALESCE(paid_amount, 0)) > 0
           ${payablesBranchFilter}`,
        payablesParams
      ),
    ]);

    const receivablesAging = {
      current: 0,
      days_1_15: 0,
      days_16_30: 0,
      days_31_45: 0,
      days_45_plus: 0,
      total: 0
    };

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    receivablesInvoices.forEach((inv) => {
      const outstanding = Number(inv.grand_total) - Number(inv.paid_amount || 0);
      if (outstanding <= 0) return;

      const dueDate = inv.due_date ? new Date(inv.due_date) : new Date(inv.invoice_date);
      dueDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((today.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24));

      receivablesAging.total += outstanding;

      if (daysDiff <= 0) {
        receivablesAging.current += outstanding;
      } else if (daysDiff <= 15) {
        receivablesAging.days_1_15 += outstanding;
      } else if (daysDiff <= 30) {
        receivablesAging.days_16_30 += outstanding;
      } else if (daysDiff <= 45) {
        receivablesAging.days_31_45 += outstanding;
      } else {
        receivablesAging.days_45_plus += outstanding;
      }
    });

    const payablesAging = {
      current: 0,
      days_1_15: 0,
      days_16_30: 0,
      days_31_45: 0,
      days_45_plus: 0,
      total: 0
    };

    payablesPurchases.forEach((purchase) => {
      const outstanding = Number(purchase.grand_total) - Number(purchase.paid_amount || 0);
      if (outstanding <= 0) return;

      const billDate = new Date(purchase.bill_date);
      billDate.setHours(0, 0, 0, 0);
      const daysDiff = Math.floor((today.getTime() - billDate.getTime()) / (1000 * 60 * 60 * 24));

      payablesAging.total += outstanding;

      if (daysDiff <= 0) {
        payablesAging.current += outstanding;
      } else if (daysDiff <= 15) {
        payablesAging.days_1_15 += outstanding;
      } else if (daysDiff <= 30) {
        payablesAging.days_16_30 += outstanding;
      } else if (daysDiff <= 45) {
        payablesAging.days_31_45 += outstanding;
      } else {
        payablesAging.days_45_plus += outstanding;
      }
    });

    // 5–9. Recent invoices, low stock, and invoice alerts in parallel
    const recentInvoicesParams = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const recentInvoicesBranchFilter = accessibleBranchIds.length > 0 
      ? `AND i.branch_id IS NOT NULL AND i.branch_id = ANY($2::uuid[])` 
      : '';
    const alertParams = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const alertBranchFilter = accessibleBranchIds.length > 0 ? `AND branch_id = ANY($2::uuid[])` : '';

    // 6. Low Stock Items - filter by branch if user has branch access
    let lowStockItemsSql = '';
    let lowStockItemsParams: any[] = [businessId];
    
    if (accessibleBranchIds.length > 0) {
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
        LIMIT 5
      `;
      lowStockItemsParams.push(accessibleBranchIds);
    } else {
      // Business-level aggregate on items.current_stock (see migration 159)
      lowStockItemsSql = `
        SELECT * FROM items 
        WHERE business_id = $1 AND current_stock <= min_stock AND is_active = true
        ORDER BY current_stock ASC
        LIMIT 5
      `;
    }

    // Draft count — must match GET /api/invoices?status=draft (same branch rules), not "last 5 rows" heuristic
    let draftCountSql = `
      SELECT COUNT(*)::int as c FROM invoices i
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND i.status = 'draft'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
    `;
    const draftCountParams: any[] = [businessId];
    if (branchIdParam && branchIdParam !== 'ALL' && branchIdParam !== 'all') {
      draftCountSql += ` AND i.branch_id = $2`;
      draftCountParams.push(branchIdParam);
    } else if (!isAdmin) {
      if (accessibleBranchIds.length === 0) {
        draftCountSql += ` AND false`;
      } else {
        draftCountSql += ` AND i.branch_id = ANY($2::uuid[])`;
        draftCountParams.push(accessibleBranchIds);
      }
    }

    const [recentInvoices, lowStockItems, overdueInvoices, dueTomorrow, dueIn3Days, draftCountRow] =
      await Promise.all([
      queryRows(
        `SELECT i.*, c.name as customer_name, c.email as customer_email, c.phone as customer_phone
         FROM invoices i
         LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
         WHERE i.business_id = $1
           AND i.deleted_at IS NULL
           ${recentInvoicesBranchFilter}
         ORDER BY i.created_at DESC
         LIMIT 5`,
        recentInvoicesParams
      ),
      queryRows(lowStockItemsSql, lowStockItemsParams),
      queryOne<{ count: number; total_amount: number }>(
        `SELECT 
          COUNT(*) as count,
          COALESCE(SUM(balance_amount), 0) as total_amount
         FROM invoices
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND status = 'final'
           AND payment_status IN ('unpaid', 'partially_paid')
           AND DATE(due_date) < CURRENT_DATE
           ${alertBranchFilter}`,
        alertParams
      ),
      queryOne<{ count: number; total_amount: number }>(
        `SELECT 
          COUNT(*) as count,
          COALESCE(SUM(grand_total), 0) as total_amount
         FROM invoices
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND status = 'final'
           AND payment_status IN ('unpaid', 'partially_paid')
           AND DATE(due_date) = CURRENT_DATE + INTERVAL '1 day'
           ${alertBranchFilter}`,
        alertParams
      ),
      queryOne<{ count: number; total_amount: number }>(
        `SELECT 
          COUNT(*) as count,
          COALESCE(SUM(grand_total), 0) as total_amount
         FROM invoices
         WHERE business_id = $1
           AND deleted_at IS NULL
           AND status = 'final'
           AND payment_status IN ('unpaid', 'partially_paid')
           AND DATE(due_date) > CURRENT_DATE
           AND DATE(due_date) <= CURRENT_DATE + INTERVAL '3 days'
           ${alertBranchFilter}`,
        alertParams
      ),
      queryOne<{ c: number }>(draftCountSql, draftCountParams),
    ]);

    const draftInvoicesCount = Number(draftCountRow?.c ?? 0);

    const sales = Number(salesRes?.total || 0);
    const purchases = Number(purchasesRes?.total || 0);
    const collection = Number(collectionRes?.total || 0);
    const cogs = Number(cogsRes?.total || 0);
    const profit = sales - cogs; // Gross Profit = Sales - COGS

    const result = {
      sales,
      purchases,
      collection,
      cogs,
      profit,
      receivables: {
        total: receivablesAging.total,
        aging: receivablesAging
      },
      payables: {
        total: payablesAging.total,
        aging: payablesAging
      },
      recentInvoices,
      draftInvoicesCount,
      lowStockItems,
      invoiceAlerts: {
        overdue: {
          count: Number(overdueInvoices?.count || 0),
          total_amount: Number(overdueInvoices?.total_amount || 0)
        },
        due_tomorrow: {
          count: Number(dueTomorrow?.count || 0),
          total_amount: Number(dueTomorrow?.total_amount || 0)
        },
        due_in_3_days: {
          count: Number(dueIn3Days?.count || 0),
          total_amount: Number(dueIn3Days?.total_amount || 0)
        }
      }
    };

    // Cache the result
    setCache(cacheKey, result);

    return NextResponse.json(result);

  } catch (error: any) {
    console.error('Dashboard overview error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

