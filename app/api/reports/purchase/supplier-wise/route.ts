import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/purchase/supplier-wise
 * Get supplier-wise purchase report
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

    const suppliers = await db.queryRows(`
      SELECT 
        COALESCE(s.id, 'unknown') as supplier_id,
        COALESCE(s.name, 'Unknown Supplier') as supplier_name,
        COALESCE(s.phone, '') as phone,
        COALESCE(s.gstin, '') as gstin,
        COUNT(p.id) as purchase_count,
        COALESCE(SUM(p.grand_total), 0) as total_purchases,
        COALESCE(SUM(p.paid_amount), 0) as total_paid,
        COALESCE(SUM(p.grand_total - p.paid_amount), 0) as total_pending
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.business_id = $1 ${dateFilter}
        AND p.deleted_at IS NULL
        AND p.status != 'cancelled'
      GROUP BY s.id, s.name, s.phone, s.gstin
      ORDER BY total_purchases DESC
    `, queryParams);

    // Calculate totals
    const totals = suppliers.reduce((acc, row) => {
      acc.total_purchases += parseFloat(row.total_purchases || 0);
      acc.total_paid += parseFloat(row.total_paid || 0);
      acc.total_pending += parseFloat(row.total_pending || 0);
      return acc;
    }, {
      total_purchases: 0,
      total_paid: 0,
      total_pending: 0,
    });

    return NextResponse.json({
      suppliers,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating supplier-wise purchase report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

