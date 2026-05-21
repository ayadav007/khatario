import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/dashboard/collection
 * Customer payments received in the selected period (matches dashboard overview collection KPI).
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

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
      return NextResponse.json({ error: 'Business ID is required' }, { status: 400 });
    }

    let accessibleBranchIds: string[] = [];
    try {
      const { getUserAccessibleBranchIds } = await import('@/lib/branch-access');
      accessibleBranchIds = await getUserAccessibleBranchIds(userId);
      if (accessibleBranchIds.length === 0) {
        return NextResponse.json({ payments: [] });
      }
    } catch {
      return NextResponse.json({ payments: [] });
    }

    let dateFilter = '';
    const params: unknown[] = [businessId];
    let paramIndex = 2;

    if (startDate && endDate) {
      dateFilter = `AND p.payment_date >= $${paramIndex} AND p.payment_date <= $${paramIndex + 1}`;
      params.push(startDate, endDate);
      paramIndex += 2;
    } else {
      dateFilter = `AND p.payment_date = CURRENT_DATE`;
    }

    const branchFilter =
      accessibleBranchIds.length > 0 ? `AND p.branch_id = ANY($${paramIndex}::uuid[])` : '';
    if (accessibleBranchIds.length > 0) {
      params.push(accessibleBranchIds);
    }

    const payments = await queryRows(
      `SELECT
        p.*,
        c.name AS customer_name,
        i.invoice_number,
        i.id AS invoice_id
      FROM payments p
      LEFT JOIN customers c ON p.customer_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN invoices i
        ON p.reference_type = 'invoice'
        AND p.reference_id = i.id
        AND i.deleted_at IS NULL
      WHERE p.business_id = $1
        AND p.deleted_at IS NULL
        AND p.type = 'receivable'
        ${dateFilter}
        ${branchFilter}
      ORDER BY p.payment_date DESC, p.created_at DESC`,
      params
    );

    return NextResponse.json({ payments });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error fetching collection payments:', error);
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 }
    );
  }
}
