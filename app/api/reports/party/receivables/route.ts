import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/party/receivables
 * Get outstanding receivables report (invoices with balance)
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const customerId = searchParams.get('customer_id'); // Optional filter

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

    // AUTHORIZATION: Check read permission (PBAC will check branch access, business ownership)
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
    let customerFilter = '';
    const queryParams: any[] = [businessId];
    let paramIndex = 2;

    if (fromDate) {
      dateFilter += ` AND i.invoice_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND i.invoice_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    if (customerId) {
      customerFilter += ` AND i.customer_id = $${paramIndex}`;
      queryParams.push(customerId);
      paramIndex++;
    }

    const receivables = await db.queryRows(`
      SELECT 
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        c.name as customer_name,
        c.phone as customer_phone,
        c.gstin as customer_gstin,
        i.grand_total,
        i.paid_amount,
        (i.grand_total - i.paid_amount) as outstanding,
        CASE 
          WHEN i.due_date IS NOT NULL AND i.due_date < CURRENT_DATE AND (i.grand_total - i.paid_amount) > 0 
            THEN CURRENT_DATE - i.due_date
          ELSE 0
        END as days_overdue
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        AND i.status = 'final'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
        AND (i.grand_total - i.paid_amount) > 0
        ${dateFilter}
        ${customerFilter}
      ORDER BY i.invoice_date DESC, i.due_date ASC
    `, queryParams);

    // Calculate totals
    const totals = receivables.reduce((acc, row) => {
      acc.total_outstanding += parseFloat(row.outstanding || 0);
      acc.total_invoices += 1;
      if (parseInt(row.days_overdue || 0) > 0) {
        acc.total_overdue += parseFloat(row.outstanding || 0);
        acc.overdue_count += 1;
      }
      return acc;
    }, {
      total_outstanding: 0,
      total_invoices: 0,
      total_overdue: 0,
      overdue_count: 0,
    });

    return NextResponse.json({
      receivables,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating receivables report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

