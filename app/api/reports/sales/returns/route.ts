import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales/returns
 * Get sales return report (credit notes)
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
      dateFilter += ` AND cn.credit_note_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND cn.credit_note_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const returns = await db.queryRows(`
      SELECT 
        cn.id,
        cn.credit_note_number,
        cn.credit_note_date,
        cn.original_invoice_date,
        i.invoice_number,
        c.name as customer_name,
        c.gstin as customer_gstin,
        cn.reason,
        cn.subtotal,
        cn.tax_total,
        cn.cgst_total,
        cn.sgst_total,
        cn.igst_total,
        cn.grand_total,
        cn.refund_status,
        cn.refund_amount,
        cn.refund_mode,
        cn.refund_date
      FROM credit_notes cn
      LEFT JOIN customers c ON cn.customer_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN invoices i ON cn.invoice_id = i.id AND i.deleted_at IS NULL
      WHERE cn.business_id = $1 ${dateFilter}
      ORDER BY cn.credit_note_date DESC, cn.credit_note_number DESC
    `, queryParams);

    // Calculate totals
    const totals = returns.reduce((acc, row) => {
      acc.total_returns++;
      acc.total_amount += parseFloat(row.grand_total || 0);
      acc.total_tax += parseFloat(row.tax_total || 0);
      acc.total_refunded += parseFloat(row.refund_amount || 0);
      if (row.refund_status === 'refunded') {
        acc.refunded_count++;
      } else if (row.refund_status === 'adjusted') {
        acc.adjusted_count++;
      } else {
        acc.pending_count++;
      }
      return acc;
    }, {
      total_returns: 0,
      total_amount: 0,
      total_tax: 0,
      total_refunded: 0,
      refunded_count: 0,
      adjusted_count: 0,
      pending_count: 0,
    });

    return NextResponse.json({
      returns,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating sales returns report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

