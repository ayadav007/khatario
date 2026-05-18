import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { format, startOfDay, startOfWeek, startOfMonth, endOfDay, endOfWeek, endOfMonth } from 'date-fns';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales/summary
 * Get sales summary report aggregated by day/week/month
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const branchIdParam = searchParams.get('branch_id'); // Optional: filter by branch
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');
    const period = searchParams.get('period') || 'day'; // 'day', 'week', 'month'

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

    // AUTHORIZATION: Check read permission (PBAC will check branch access, business ownership)
    // Note: Branch filtering happens AFTER authorization - PBAC enforces scope
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
      dateFilter += ` AND invoice_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND invoice_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    let groupByClause = '';
    let orderByClause = '';

    if (period === 'day') {
      groupByClause = 'DATE(i.invoice_date)';
      orderByClause = 'DATE(i.invoice_date) DESC';
    } else if (period === 'week') {
      groupByClause = `DATE_TRUNC('week', i.invoice_date)`;
      orderByClause = `DATE_TRUNC('week', i.invoice_date) DESC`;
    } else if (period === 'month') {
      groupByClause = `DATE_TRUNC('month', i.invoice_date)`;
      orderByClause = `DATE_TRUNC('month', i.invoice_date) DESC`;
    }

    // Build query with branch filter (scope enforced by PBAC)
    let branchFilter = '';
    // Always filter by resolved branchId
    branchFilter = ` AND i.branch_id = $${paramIndex}`;
    queryParams.push(finalBranchId);
    paramIndex++;

    const summary = await db.queryRows(`
      SELECT 
        ${groupByClause} as period,
        COUNT(*) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')) as total_invoices,
        COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_sales,
        COALESCE(SUM(i.paid_amount) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_collected,
        COALESCE(SUM(i.balance_amount) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_pending,
        COALESCE(SUM(i.tax_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_tax,
        COALESCE(SUM(i.discount_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_discount
      FROM invoices i
      WHERE i.business_id = $1 ${dateFilter} ${branchFilter}
        AND i.deleted_at IS NULL
      GROUP BY ${groupByClause}
      ORDER BY ${orderByClause}
    `, queryParams);

    // Calculate totals
    const totals = summary.reduce((acc, row) => {
      acc.total_invoices += parseInt(row.total_invoices);
      acc.total_sales += parseFloat(row.total_sales || 0);
      acc.total_collected += parseFloat(row.total_collected || 0);
      acc.total_pending += parseFloat(row.total_pending || 0);
      acc.total_tax += parseFloat(row.total_tax || 0);
      acc.total_discount += parseFloat(row.total_discount || 0);
      return acc;
    }, {
      total_invoices: 0,
      total_sales: 0,
      total_collected: 0,
      total_pending: 0,
      total_tax: 0,
      total_discount: 0,
    });

    return NextResponse.json({
      period,
      summary,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating sales summary report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

