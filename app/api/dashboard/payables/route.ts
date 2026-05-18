import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/dashboard/payables
 * Get purchases with outstanding balance (same logic as dashboard)
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'Business ID is required' },
        { status: 400 }
      );
    }

    // Get user's accessible branch IDs if userId provided
    let accessibleBranchIds: string[] = [];
    if (userId) {
      try {
        const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
        accessibleBranchIds = await getUserAccessibleBranchIds(userId);
        if (accessibleBranchIds.length === 0) {
          return NextResponse.json({ purchases: [] });
        }
      } catch (error) {
        console.error('Error fetching user accessible branches:', error);
      }
    }

    const params = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const branchFilter = accessibleBranchIds.length > 0 ? `AND p.branch_id = ANY($2::uuid[])` : '';

    // Use the same SQL logic as dashboard overview
    const purchases = await queryRows(
      `SELECT 
        p.*,
        s.name as supplier_name,
        s.phone as supplier_phone
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.business_id = $1 
        AND p.deleted_at IS NULL
        AND p.status != 'cancelled' 
        AND p.status != 'draft'
        AND (p.grand_total - COALESCE(p.paid_amount, 0)) > 0
        ${branchFilter}
      ORDER BY p.bill_date DESC, p.created_at DESC`,
      params
    );

    return NextResponse.json({ purchases });
  } catch (error: any) {
    console.error('Error fetching payables:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

