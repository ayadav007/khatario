import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales/party-wise
 * Get party-wise (customer-wise) sales report
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

    const parties = await db.queryRows(`
      SELECT 
        COALESCE(c.id, 'cash_sale') as customer_id,
        COALESCE(c.name, 'Cash Sale') as customer_name,
        c.phone,
        c.gstin,
        c.city,
        c.state,
        COUNT(i.id) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')) as invoice_count,
        COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_sales,
        COALESCE(SUM(i.paid_amount) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_collected,
        COALESCE(SUM(i.balance_amount) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_pending,
        COALESCE(SUM(i.tax_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_tax,
        COALESCE(SUM(i.discount_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_discount
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1 AND i.deleted_at IS NULL ${dateFilter}
      GROUP BY 
        COALESCE(c.id, 'cash_sale'),
        COALESCE(c.name, 'Cash Sale'),
        c.phone,
        c.gstin,
        c.city,
        c.state
      ORDER BY total_sales DESC
    `, queryParams);

    // Calculate totals
    const totals = parties.reduce((acc, party) => {
      acc.total_invoices += parseInt(party.invoice_count);
      acc.total_sales += parseFloat(party.total_sales || 0);
      acc.total_collected += parseFloat(party.total_collected || 0);
      acc.total_pending += parseFloat(party.total_pending || 0);
      acc.total_tax += parseFloat(party.total_tax || 0);
      acc.total_discount += parseFloat(party.total_discount || 0);
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
      parties,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating party-wise sales report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

