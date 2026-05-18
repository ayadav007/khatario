import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/purchase/tax-wise
 * Get tax-wise purchase report
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
      dateFilter += ` AND p.bill_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND p.bill_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const taxWise = await db.queryRows(`
      SELECT 
        COALESCE(pi.tax_rate, 0) as tax_rate,
        COALESCE(pi.hsn_sac, 'N/A') as hsn_sac,
        SUM(pi.quantity) as total_quantity,
        SUM(pi.taxable_value) as total_taxable_value,
        SUM(pi.cgst_amount) as total_cgst,
        SUM(pi.sgst_amount) as total_sgst,
        SUM(pi.igst_amount) as total_igst,
        SUM(pi.tax_amount) as total_tax
      FROM purchase_items pi
      INNER JOIN purchases p ON pi.purchase_id = p.id AND p.deleted_at IS NULL
      WHERE p.business_id = $1 
        AND p.status != 'cancelled'
        ${dateFilter}
      GROUP BY pi.tax_rate, pi.hsn_sac
      ORDER BY pi.tax_rate DESC, pi.hsn_sac
    `, queryParams);

    // Calculate totals
    const totals = taxWise.reduce((acc, row) => {
      acc.total_taxable_value += parseFloat(row.total_taxable_value || 0);
      acc.total_tax += parseFloat(row.total_tax || 0);
      acc.total_cgst += parseFloat(row.total_cgst || 0);
      acc.total_sgst += parseFloat(row.total_sgst || 0);
      acc.total_igst += parseFloat(row.total_igst || 0);
      return acc;
    }, {
      total_taxable_value: 0,
      total_tax: 0,
      total_cgst: 0,
      total_sgst: 0,
      total_igst: 0,
    });

    return NextResponse.json({
      taxWise,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating tax-wise purchase report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

