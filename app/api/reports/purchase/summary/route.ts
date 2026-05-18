import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/purchase/summary
 * Get purchase summary report aggregated by day/week/month
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
      dateFilter += ` AND bill_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND bill_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    let groupByClause = '';
    let orderByClause = '';

    if (period === 'day') {
      groupByClause = 'DATE(p.bill_date)';
      orderByClause = 'DATE(p.bill_date) DESC';
    } else if (period === 'week') {
      groupByClause = `DATE_TRUNC('week', p.bill_date)`;
      orderByClause = `DATE_TRUNC('week', p.bill_date) DESC`;
    } else if (period === 'month') {
      groupByClause = `DATE_TRUNC('month', p.bill_date)`;
      orderByClause = `DATE_TRUNC('month', p.bill_date) DESC`;
    }

    const summary = await db.queryRows(`
      SELECT 
        ${groupByClause} as period,
        COUNT(*) FILTER (WHERE p.status != 'cancelled') as total_purchases,
        COALESCE(SUM(p.grand_total) FILTER (WHERE p.status != 'cancelled'), 0) as total_purchases_amount,
        COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status != 'cancelled'), 0) as total_paid,
        COALESCE(SUM(p.grand_total) FILTER (WHERE p.status != 'cancelled'), 0) - 
        COALESCE(SUM(p.paid_amount) FILTER (WHERE p.status != 'cancelled'), 0) as total_pending,
        COALESCE(SUM(p.tax_total) FILTER (WHERE p.status != 'cancelled'), 0) as total_tax
      FROM purchases p
      WHERE p.business_id = $1 ${dateFilter}
      AND p.deleted_at IS NULL
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause}
    `, queryParams);

    // Calculate totals
    const totals = summary.reduce((acc, row) => {
      acc.total_purchases += parseInt(row.total_purchases);
      acc.total_purchases_amount += parseFloat(row.total_purchases_amount || 0);
      acc.total_paid += parseFloat(row.total_paid || 0);
      acc.total_pending += parseFloat(row.total_pending || 0);
      acc.total_tax += parseFloat(row.total_tax || 0);
      return acc;
    }, {
      total_purchases: 0,
      total_purchases_amount: 0,
      total_paid: 0,
      total_pending: 0,
      total_tax: 0,
    });

    return NextResponse.json({
      period,
      summary,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating purchase summary report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

