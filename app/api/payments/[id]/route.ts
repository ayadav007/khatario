import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { getUserAccessibleBranchIds } from '@/lib/branch-access';
import { isPrimaryAdminForBusiness } from '@/lib/enforce-access';

/**
 * GET /api/payments/[id]
 * Single payment with joined customer/supplier names.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const paymentId = params.id;
    const userId = getUserIdFromRequest(request);
    const businessScope = getBusinessIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    if (!businessScope) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    const row = await queryOne<Record<string, unknown>>(
      `
      SELECT
        p.*,
        c.name AS customer_name,
        s.name AS supplier_name
      FROM payments p
      LEFT JOIN customers c ON c.id = p.customer_id AND c.deleted_at IS NULL
      LEFT JOIN suppliers s ON s.id = p.supplier_id
      WHERE p.id = $1 AND p.business_id = $2 AND p.deleted_at IS NULL
      `,
      [paymentId, businessScope]
    );

    if (!row) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    const businessId = String(row.business_id);
    const branchId = row.branch_id as string | null;

    try {
      await authorize(userId, 'payments', 'read', {
        resourceId: paymentId,
        branchId: branchId || undefined,
        businessId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const accessibleBranchIds = await getUserAccessibleBranchIds(userId).catch(() => [] as string[]);
    const primary = await isPrimaryAdminForBusiness(userId, businessId).catch(() => false);

    if (!primary && accessibleBranchIds.length > 0 && branchId && !accessibleBranchIds.includes(branchId)) {
      return NextResponse.json({ error: 'Payment not found' }, { status: 404 });
    }

    return NextResponse.json({ payment: row });
  } catch (error: any) {
    console.error('Error fetching payment', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
