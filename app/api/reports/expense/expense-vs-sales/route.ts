import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/expense/expense-vs-sales
 * Get expense vs sales comparison report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const period = searchParams.get('period') || 'day'; // 'day', 'week', 'month'

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

    let groupByClause = '';
    if (period === 'day') {
      groupByClause = 'DATE(transaction_date)';
    } else if (period === 'week') {
      groupByClause = `DATE_TRUNC('week', transaction_date)`;
    } else if (period === 'month') {
      groupByClause = `DATE_TRUNC('month', transaction_date)`;
    }

    // Get sales by period
    // Only count finalized invoices (not drafts or proforma) as per GST rules
    const sales = await db.queryRows(`
      SELECT 
        ${groupByClause.replace(/transaction_date/g, 'i.invoice_date')} as period,
        COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as sales
      FROM invoices i
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        ${dateFilter.replace(/transaction_date/g, 'i.invoice_date')}
      GROUP BY ${groupByClause.replace(/transaction_date/g, 'i.invoice_date')}
    `, queryParams);

    // Get expenses by period
    const expenses = await db.queryRows(`
      SELECT 
        ${groupByClause.replace(/transaction_date/g, 'e.expense_date')} as period,
        COALESCE(SUM(e.amount), 0) as expenses
      FROM expenses e
      WHERE e.business_id = $1 
        ${dateFilter.replace(/transaction_date/g, 'e.expense_date')}
      GROUP BY ${groupByClause.replace(/transaction_date/g, 'e.expense_date')}
    `, queryParams);

    // Combine
    const allPeriods = new Set<string>();
    sales.forEach(s => allPeriods.add(s.period));
    expenses.forEach(e => allPeriods.add(e.period));

    const comparison = Array.from(allPeriods).sort().map(period => {
      const sale = sales.find(s => s.period === period);
      const expense = expenses.find(e => e.period === period);
      
      const salesAmount = parseFloat(sale?.sales || 0);
      const expenseAmount = parseFloat(expense?.expenses || 0);
      const ratio = salesAmount > 0 ? (expenseAmount / salesAmount * 100) : 0;

      return {
        period,
        sales: salesAmount,
        expenses: expenseAmount,
        ratio: ratio.toFixed(2),
        net: salesAmount - expenseAmount,
      };
    });

    // Calculate totals
    const totals = comparison.reduce((acc, row) => {
      acc.total_sales += row.sales;
      acc.total_expenses += row.expenses;
      return acc;
    }, {
      total_sales: 0,
      total_expenses: 0,
    } as {
      total_sales: number;
      total_expenses: number;
      total_ratio: number;
      net: number;
    });

    (totals as any).total_ratio = totals.total_sales > 0 ? (totals.total_expenses / totals.total_sales * 100) : 0;
    (totals as any).net = totals.total_sales - totals.total_expenses;

    return NextResponse.json({
      period,
      comparison,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating expense vs sales report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

