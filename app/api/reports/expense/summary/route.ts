import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/expense/summary
 * Get expense summary report
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
      await assertReportAccess(businessId, 'basic');
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
      dateFilter += ` AND e.expense_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND e.expense_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    let groupByClause = '';
    let orderByClause = '';

    if (period === 'day') {
      groupByClause = 'DATE(e.expense_date)';
      orderByClause = 'DATE(e.expense_date) DESC';
    } else if (period === 'week') {
      groupByClause = `DATE_TRUNC('week', e.expense_date)`;
      orderByClause = `DATE_TRUNC('week', e.expense_date) DESC`;
    } else if (period === 'month') {
      groupByClause = `DATE_TRUNC('month', e.expense_date)`;
      orderByClause = `DATE_TRUNC('month', e.expense_date) DESC`;
    }

    const summary = await db.queryRows(`
      SELECT 
        ${groupByClause} as period,
        COUNT(*) as total_expenses,
        COALESCE(SUM(e.amount), 0) as total_amount
      FROM expenses e
      WHERE e.business_id = $1 
        ${dateFilter}
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause}
    `, queryParams);

    // Calculate totals
    const totals = summary.reduce((acc, row) => {
      acc.total_expenses += parseInt(row.total_expenses);
      acc.total_amount += parseFloat(row.total_amount || 0);
      return acc;
    }, {
      total_expenses: 0,
      total_amount: 0,
    });

    return NextResponse.json({
      period,
      summary,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating expense summary report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

