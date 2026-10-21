import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { requireStrictSession } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

export const dynamic = 'force-dynamic';

/**
 * GET /api/dashboard/receivables
 * Get invoices with outstanding balance (same logic as dashboard)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;
    const businessId = session.businessId;
    const userId = session.userId;

    try {
      await authorize(userId, 'dashboard', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // Get user's accessible branch IDs if userId provided
    let accessibleBranchIds: string[] = [];
    if (userId) {
      try {
        const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
        accessibleBranchIds = await getUserAccessibleBranchIds(userId);
        if (accessibleBranchIds.length === 0) {
          return NextResponse.json({ invoices: [] });
        }
      } catch (error) {
        console.error('Error fetching user accessible branches:', error);
      }
    }

    const params = accessibleBranchIds.length > 0 ? [businessId, accessibleBranchIds] : [businessId];
    const branchFilter = accessibleBranchIds.length > 0 ? `AND i.branch_id = ANY($2::uuid[])` : '';

    // Use the same SQL logic as dashboard overview
    const invoices = await queryRows(
      `SELECT 
        i.*,
        c.name as customer_name,
        c.phone as customer_phone
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        AND i.status = 'final'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
        AND i.balance_amount > 0
        ${branchFilter}
      ORDER BY i.invoice_date DESC, i.created_at DESC`,
      params
    );

    return NextResponse.json({ invoices });
  } catch (error: any) {
    console.error('Error fetching receivables:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

