import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/party/payables
 * Get outstanding payables report (purchases with balance)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const supplierId = searchParams.get('supplier_id'); // Optional filter

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

    // Get user's accessible branch IDs
    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
    } catch (error) {
      console.error('Error fetching user accessible branches:', error);
      return NextResponse.json(
        { error: 'Failed to validate branch access' },
        { status: 500 }
      );
    }

    if (accessibleBranchIds.length === 0) {
      return NextResponse.json(
        { error: 'You do not have access to any branches' },
        { status: 403 }
      );
    }

    // CRITICAL: Resolve branch_id using helper (handles default branch fallback)
    const { resolveBranchId, validateUserBranchAccess } = await import('@/lib/branch-helpers');
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

    // CRITICAL: Verify user has access to the resolved branch
    const hasAccess = await validateUserBranchAccess(userId, finalBranchId);
    if (!hasAccess) {
      return NextResponse.json(
        { error: 'You do not have access to this branch' },
        { status: 403 }
      );
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
    let supplierFilter = '';
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

    if (supplierId) {
      supplierFilter += ` AND p.supplier_id = $${paramIndex}`;
      queryParams.push(supplierId);
      paramIndex++;
    }

    const payables = await db.queryRows(`
      SELECT 
        p.id,
        p.bill_number,
        p.bill_date,
        s.name as supplier_name,
        s.phone as supplier_phone,
        s.gstin as supplier_gstin,
        p.grand_total,
        p.paid_amount,
        (p.grand_total - p.paid_amount) as outstanding
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.business_id = $1 
        AND p.deleted_at IS NULL
        AND p.status != 'cancelled'
        AND (p.grand_total - p.paid_amount) > 0
        ${dateFilter}
        ${supplierFilter}
      ORDER BY p.bill_date DESC
    `, queryParams);

    // Calculate totals
    const totals = payables.reduce((acc, row) => {
      acc.total_outstanding += parseFloat(row.outstanding || 0);
      acc.total_purchases += 1;
      return acc;
    }, {
      total_outstanding: 0,
      total_purchases: 0,
    });

    return NextResponse.json({
      payables,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating payables report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

