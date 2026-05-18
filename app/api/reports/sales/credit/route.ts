import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales/credit
 * Get credit sales report (invoices with outstanding balance)
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
      dateFilter += ` AND i.invoice_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND i.invoice_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const creditSales = await db.queryRows(`
      SELECT 
        i.id,
        i.invoice_number,
        i.invoice_date,
        i.due_date,
        COALESCE(c.name, 'Cash Sale') as customer_name,
        c.phone,
        c.gstin,
        i.grand_total,
        i.paid_amount,
        i.balance_amount,
        i.payment_status,
        CASE 
          WHEN i.due_date < CURRENT_DATE AND i.balance_amount > 0 THEN 'overdue'
          WHEN i.due_date >= CURRENT_DATE AND i.balance_amount > 0 THEN 'pending'
          ELSE 'paid'
        END as status_category
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        AND i.status != 'cancelled'
        AND i.balance_amount > 0
        ${dateFilter}
      ORDER BY 
        CASE status_category
          WHEN 'overdue' THEN 1
          WHEN 'pending' THEN 2
          ELSE 3
        END,
        i.due_date ASC,
        i.invoice_date DESC
    `, queryParams);

    // Calculate totals
    const totals = creditSales.reduce((acc, row) => {
      acc.total_invoices++;
      acc.total_sales += parseFloat(row.grand_total || 0);
      acc.total_collected += parseFloat(row.paid_amount || 0);
      acc.total_outstanding += parseFloat(row.balance_amount || 0);
      if (row.status_category === 'overdue') {
        acc.total_overdue += parseFloat(row.balance_amount || 0);
        acc.overdue_invoices++;
      }
      return acc;
    }, {
      total_invoices: 0,
      total_sales: 0,
      total_collected: 0,
      total_outstanding: 0,
      total_overdue: 0,
      overdue_invoices: 0,
    });

    return NextResponse.json({
      creditSales,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating credit sales report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

