import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/expense/cost-center
 * Get cost center report (advanced - if cost centers are tracked)
 * Note: This assumes cost centers might be tracked in a future enhancement
 * For now, uses expense categories as a proxy for cost centers
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
      dateFilter += ` AND e.expense_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND e.expense_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    // Use expense categories as cost centers (can be enhanced later with dedicated cost_centers table)
    const costCenters = await db.queryRows(`
      SELECT 
        COALESCE(ec.id::text, 'uncategorized') as cost_center_id,
        COALESCE(ec.name, e.category, 'Uncategorized') as cost_center_name,
        COUNT(*) as expense_count,
        COALESCE(SUM(e.amount), 0) as total_amount,
        AVG(e.amount) as avg_amount,
        MIN(e.expense_date) as first_expense,
        MAX(e.expense_date) as last_expense
      FROM expenses e
      LEFT JOIN expense_categories ec ON e.category_id = ec.id
      WHERE e.business_id = $1 
        ${dateFilter}
      GROUP BY ec.id, ec.name, e.category
      ORDER BY total_amount DESC
    `, queryParams);

    // Calculate totals
    const totals = costCenters.reduce((acc, row) => {
      acc.total_expenses += parseInt(row.expense_count);
      acc.total_amount += parseFloat(row.total_amount || 0);
      return acc;
    }, {
      total_expenses: 0,
      total_amount: 0,
    });

    return NextResponse.json({
      costCenters,
      totals,
      note: 'Currently using expense categories as cost centers. A dedicated cost center feature can be added later.',
    });
  } catch (error: any) {
    console.error('Error generating cost center report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

