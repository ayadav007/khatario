import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales-summary
 * Get sales summary report for a date range
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

    // Total sales summary
    // Only count finalized invoices (not drafts or proforma) as per GST rules
    // GST time of supply: invoice is considered a sale when finalized, regardless of payment status
    const summary = await db.queryOne(`
      SELECT 
        COUNT(*) FILTER (WHERE status = 'final' AND (document_type IS NULL OR document_type != 'proforma_invoice')) as total_invoices,
        COALESCE(SUM(grand_total) FILTER (WHERE status = 'final' AND (document_type IS NULL OR document_type != 'proforma_invoice')), 0) as total_sales,
        COALESCE(SUM(paid_amount) FILTER (WHERE status = 'final' AND (document_type IS NULL OR document_type != 'proforma_invoice')), 0) as total_collected,
        COALESCE(SUM(balance_amount) FILTER (WHERE status = 'final' AND (document_type IS NULL OR document_type != 'proforma_invoice')), 0) as total_pending,
        COALESCE(SUM(tax_total) FILTER (WHERE status = 'final' AND (document_type IS NULL OR document_type != 'proforma_invoice')), 0) as total_tax
      FROM invoices
      WHERE business_id = $1 ${dateFilter}
        AND deleted_at IS NULL
    `, queryParams);

    // Sales by customer
    const byCustomer = await db.queryRows(`
      SELECT 
        c.id, c.name,
        COUNT(i.id) as invoice_count,
        COALESCE(SUM(i.grand_total), 0) as total_amount
      FROM customers c
      INNER JOIN invoices i ON c.id = i.customer_id AND i.deleted_at IS NULL
      WHERE i.business_id = $1 
        AND c.deleted_at IS NULL
        AND i.status = 'final'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
        ${dateFilter}
      GROUP BY c.id, c.name
      ORDER BY total_amount DESC
      LIMIT 10
    `, queryParams);

    // Sales by payment status (only final invoices for accurate reporting)
    const byStatus = await db.queryRows(`
      SELECT 
        payment_status,
        COUNT(*) as count,
        COALESCE(SUM(grand_total), 0) as amount
      FROM invoices
      WHERE business_id = $1 AND deleted_at IS NULL AND status = 'final' ${dateFilter}
      GROUP BY payment_status
    `, queryParams);

    return NextResponse.json({
      summary,
      byCustomer,
      byStatus,
    });
  } catch (error: any) {
    console.error('Error generating sales summary:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

