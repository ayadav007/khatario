import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales/payment-mode
 * Get sales report grouped by payment mode (Cash, UPI, Card, etc.)
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

    // Get sales by payment mode from payments table
    const byPaymentMode = await db.queryRows(`
      SELECT 
        COALESCE(p.payment_mode, 'cash') as payment_mode,
        COUNT(DISTINCT p.reference_id) FILTER (WHERE p.reference_type = 'invoice') as invoice_count,
        COALESCE(SUM(p.amount) FILTER (WHERE p.reference_type = 'invoice'), 0) as total_amount
      FROM payments p
      INNER JOIN invoices i ON p.reference_id = i.id AND p.reference_type = 'invoice' AND i.deleted_at IS NULL
      WHERE p.business_id = $1 
        AND p.deleted_at IS NULL
        AND p.type = 'receivable'
        AND i.status = 'final'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
        ${dateFilter}
      GROUP BY p.payment_mode
      ORDER BY total_amount DESC
    `, queryParams);

    // Get unpaid invoices
    const unpaidInvoices = await db.queryRows(`
      SELECT 
        COUNT(*) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice') AND i.balance_amount > 0) as invoice_count,
        COALESCE(SUM(i.balance_amount) FILTER (WHERE i.status = 'final' AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice') AND i.balance_amount > 0), 0) as total_amount
      FROM invoices i
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        AND i.status = 'final'
        AND (i.document_type IS NULL OR i.document_type != 'proforma_invoice')
        AND i.balance_amount > 0
        AND NOT EXISTS (
          SELECT 1 FROM payments p 
          WHERE p.reference_id = i.id 
            AND p.reference_type = 'invoice'
            AND p.business_id = $1
            AND p.deleted_at IS NULL
        )
        ${dateFilter}
    `, queryParams);

    // Add unpaid to the results if there are any
    if (unpaidInvoices[0] && parseFloat(unpaidInvoices[0].total_amount) > 0) {
      byPaymentMode.push({
        payment_mode: 'unpaid',
        invoice_count: unpaidInvoices[0].invoice_count,
        total_amount: unpaidInvoices[0].total_amount,
      });
    }

    // Calculate totals
    const totals = byPaymentMode.reduce((acc, row) => {
      acc.total_invoices += parseInt(row.invoice_count || 0);
      acc.total_amount += parseFloat(row.total_amount || 0);
      return acc;
    }, {
      total_invoices: 0,
      total_amount: 0,
    });

    return NextResponse.json({
      byPaymentMode,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating payment mode sales report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

