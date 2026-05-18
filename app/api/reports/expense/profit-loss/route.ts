import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/expense/profit-loss
 * Get Profit & Loss report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
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

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
        businessId: businessId,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json(
          { error: error.message },
          { status: 400 }
        );
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json(
          { error: error.message },
          { status: 500 }
        );
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission
    try {
      await authorize(userId, 'report', 'read', {
        businessId,
        branchId: finalBranchId,
        resource: {
          business_id: businessId,
          branch_id: finalBranchId,
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

    // Get Sales (Income)
    // Only count finalized invoices (not drafts or proforma) as per GST rules
    const sales = await db.queryOne(`
      SELECT 
        COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_sales,
        COALESCE(SUM(i.tax_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as tax_collected,
        COUNT(*) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')) as invoice_count
      FROM invoices i
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        ${dateFilter.replace(/transaction_date/g, 'i.invoice_date')}
    `, queryParams);

    // Get Purchases (Cost of Goods Sold)
    const purchases = await db.queryOne(`
      SELECT 
        COALESCE(SUM(p.grand_total) FILTER (WHERE p.status != 'cancelled'), 0) as total_purchases,
        COALESCE(SUM(p.tax_total) FILTER (WHERE p.status != 'cancelled'), 0) as tax_paid,
        COUNT(*) FILTER (WHERE p.status != 'cancelled') as purchase_count
      FROM purchases p
      WHERE p.business_id = $1 
        AND p.deleted_at IS NULL
        ${dateFilter.replace(/transaction_date/g, 'p.bill_date')}
    `, queryParams);

    // Get Expenses
    const expenses = await db.queryOne(`
      SELECT 
        COALESCE(SUM(e.amount), 0) as total_expenses,
        COUNT(*) as expense_count
      FROM expenses e
      WHERE e.business_id = $1 
        ${dateFilter.replace(/transaction_date/g, 'e.expense_date')}
    `, queryParams);

    const totalSales = parseFloat(sales?.total_sales || 0);
    const totalPurchases = parseFloat(purchases?.total_purchases || 0);
    const totalExpenses = parseFloat(expenses?.total_expenses || 0);
    const grossProfit = totalSales - totalPurchases;
    const netProfit = grossProfit - totalExpenses;

    return NextResponse.json({
      income: {
        sales: totalSales,
        tax_collected: parseFloat(sales?.tax_collected || 0),
        invoice_count: parseInt(sales?.invoice_count || 0),
      },
      cogs: {
        purchases: totalPurchases,
        tax_paid: parseFloat(purchases?.tax_paid || 0),
        purchase_count: parseInt(purchases?.purchase_count || 0),
      },
      expenses: {
        total: totalExpenses,
        expense_count: parseInt(expenses?.expense_count || 0),
      },
      gross_profit: grossProfit,
      net_profit: netProfit,
    });
  } catch (error: any) {
    console.error('Error generating profit & loss report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

