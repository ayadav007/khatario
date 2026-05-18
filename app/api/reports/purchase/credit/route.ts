import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/purchase/credit
 * Get credit purchases report (unpaid purchases)
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
      dateFilter += ` AND p.bill_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND p.bill_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const creditPurchases = await db.queryRows(`
      SELECT 
        p.id,
        p.bill_number,
        p.bill_date,
        COALESCE(s.name, 'Unknown Supplier') as supplier_name,
        p.grand_total,
        p.paid_amount,
        (p.grand_total - p.paid_amount) as balance_amount,
        CASE 
          WHEN (p.grand_total - p.paid_amount) > 0 AND p.bill_date < CURRENT_DATE - INTERVAL '30 days' THEN 'overdue'
          WHEN (p.grand_total - p.paid_amount) > 0 THEN 'pending'
          ELSE 'paid'
        END as status_category
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.business_id = $1 
        AND p.deleted_at IS NULL
        AND p.status != 'cancelled'
        AND (p.grand_total - p.paid_amount) > 0
        ${dateFilter}
      ORDER BY p.bill_date DESC
    `, queryParams);

    // Calculate totals
    const totals = creditPurchases.reduce((acc, row) => {
      acc.total_purchases += 1;
      acc.total_sales += parseFloat(row.grand_total || 0);
      acc.total_outstanding += parseFloat(row.balance_amount || 0);
      if (row.status_category === 'overdue') {
        acc.total_overdue += parseFloat(row.balance_amount || 0);
      }
      return acc;
    }, {
      total_purchases: 0,
      total_sales: 0,
      total_outstanding: 0,
      total_overdue: 0,
    });

    return NextResponse.json({
      creditPurchases,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating credit purchases report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

