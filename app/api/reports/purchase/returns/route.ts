import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/purchase/returns
 * Get purchase return report
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
      dateFilter += ` AND pr.return_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND pr.return_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const returns = await db.queryRows(`
      SELECT 
        pr.id,
        pr.return_number,
        pr.return_date,
        COALESCE(p.bill_number, 'N/A') as purchase_bill_number,
        COALESCE(s.name, 'Unknown Supplier') as supplier_name,
        pr.grand_total,
        pr.refund_amount,
        pr.refund_status,
        pr.reason
      FROM purchase_returns pr
      LEFT JOIN purchases p ON pr.purchase_id = p.id AND p.deleted_at IS NULL
      LEFT JOIN suppliers s ON pr.supplier_id = s.id
      WHERE pr.business_id = $1 ${dateFilter}
      ORDER BY pr.return_date DESC, pr.return_number DESC
    `, queryParams);

    // Calculate totals
    const totals = returns.reduce((acc, row) => {
      acc.total_returns += 1;
      acc.total_amount += parseFloat(row.grand_total || 0);
      acc.total_refunded += parseFloat(row.refund_amount || 0);
      if (row.refund_status === 'pending') acc.pending_count += 1;
      return acc;
    }, {
      total_returns: 0,
      total_amount: 0,
      total_refunded: 0,
      pending_count: 0,
    });

    return NextResponse.json({
      returns,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating purchase return report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

