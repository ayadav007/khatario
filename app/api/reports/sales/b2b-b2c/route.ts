import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales/b2b-b2c
 * Get B2B vs B2C sales report
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
      await assertReportAccess(businessId, 'gst');
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

    // AUTHORIZATION: Check read permission for GST report
    try {
      await authorize(userId, 'report.gst', 'read', {
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

    // Determine B2B vs B2C based on customer GSTIN and supply_type
    const salesByType = await db.queryRows(`
      SELECT 
        CASE 
          WHEN i.supply_type = 'b2b' THEN 'B2B'
          WHEN i.supply_type IN ('b2c_large', 'b2c_small') THEN 'B2C'
          WHEN c.gstin IS NOT NULL AND c.gstin != '' THEN 'B2B'
          WHEN i.customer_id IS NULL THEN 'B2C (Cash Sale)'
          ELSE 'B2C'
        END as sale_type,
        COUNT(*) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')) as invoice_count,
        COALESCE(SUM(i.grand_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_sales,
        COALESCE(SUM(i.subtotal) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_taxable_value,
        COALESCE(SUM(i.tax_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_tax,
        COALESCE(SUM(i.cgst_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_cgst,
        COALESCE(SUM(i.sgst_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_sgst,
        COALESCE(SUM(i.igst_total) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_igst,
        COALESCE(SUM(i.paid_amount) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_collected,
        COALESCE(SUM(i.balance_amount) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')), 0) as total_pending
      FROM invoices i
      LEFT JOIN customers c ON i.customer_id = c.id AND c.deleted_at IS NULL
      WHERE i.business_id = $1 AND i.deleted_at IS NULL ${dateFilter}
      GROUP BY 
        CASE 
          WHEN i.supply_type = 'b2b' THEN 'B2B'
          WHEN i.supply_type IN ('b2c_large', 'b2c_small') THEN 'B2C'
          WHEN c.gstin IS NOT NULL AND c.gstin != '' THEN 'B2B'
          WHEN i.customer_id IS NULL THEN 'B2C (Cash Sale)'
          ELSE 'B2C'
        END
      ORDER BY sale_type
    `, queryParams);

    // Calculate totals
    const totals = salesByType.reduce((acc, row) => {
      acc.total_invoices += parseInt(row.invoice_count || 0);
      acc.total_sales += parseFloat(row.total_sales || 0);
      acc.total_taxable_value += parseFloat(row.total_taxable_value || 0);
      acc.total_tax += parseFloat(row.total_tax || 0);
      acc.total_collected += parseFloat(row.total_collected || 0);
      acc.total_pending += parseFloat(row.total_pending || 0);
      return acc;
    }, {
      total_invoices: 0,
      total_sales: 0,
      total_taxable_value: 0,
      total_tax: 0,
      total_collected: 0,
      total_pending: 0,
    });

    return NextResponse.json({
      salesByType,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating B2B vs B2C sales report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

