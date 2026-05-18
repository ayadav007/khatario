import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/expense/monthly-profit
 * Get monthly profit trend report
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

    // Get monthly sales
    // Only count finalized invoices (not drafts or proforma) as per GST rules
    const monthlySales = await db.queryRows(`
      SELECT 
        DATE_TRUNC('month', i.invoice_date) as month,
        COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as sales
      FROM invoices i
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        ${dateFilter.replace(/transaction_date/g, 'i.invoice_date')}
      GROUP BY DATE_TRUNC('month', i.invoice_date)
      ORDER BY month
    `, queryParams);

    // Get monthly purchases
    const monthlyPurchases = await db.queryRows(`
      SELECT 
        DATE_TRUNC('month', p.bill_date) as month,
        COALESCE(SUM(p.grand_total) FILTER (WHERE p.status != 'cancelled'), 0) as purchases
      FROM purchases p
      WHERE p.business_id = $1 
        AND p.deleted_at IS NULL
        ${dateFilter.replace(/transaction_date/g, 'p.bill_date')}
      GROUP BY DATE_TRUNC('month', p.bill_date)
      ORDER BY month
    `, queryParams);

    // Get monthly expenses
    const monthlyExpenses = await db.queryRows(`
      SELECT 
        DATE_TRUNC('month', e.expense_date) as month,
        COALESCE(SUM(e.amount), 0) as expenses
      FROM expenses e
      WHERE e.business_id = $1 
        ${dateFilter.replace(/transaction_date/g, 'e.expense_date')}
      GROUP BY DATE_TRUNC('month', e.expense_date)
      ORDER BY month
    `, queryParams);

    // Combine all months
    const allMonths = new Set<string>();
    monthlySales.forEach(s => allMonths.add(s.month));
    monthlyPurchases.forEach(p => allMonths.add(p.month));
    monthlyExpenses.forEach(e => allMonths.add(e.month));

    const trends = Array.from(allMonths).sort().map(month => {
      const sales = monthlySales.find(s => s.month === month);
      const purchases = monthlyPurchases.find(p => p.month === month);
      const expenses = monthlyExpenses.find(e => e.month === month);
      
      const salesAmount = parseFloat(sales?.sales || 0);
      const purchaseAmount = parseFloat(purchases?.purchases || 0);
      const expenseAmount = parseFloat(expenses?.expenses || 0);
      const grossProfit = salesAmount - purchaseAmount;
      const netProfit = grossProfit - expenseAmount;

      return {
        month,
        sales: salesAmount,
        purchases: purchaseAmount,
        expenses: expenseAmount,
        gross_profit: grossProfit,
        net_profit: netProfit,
      };
    });

    return NextResponse.json({
      trends,
    });
  } catch (error: any) {
    console.error('Error generating monthly profit trend report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

