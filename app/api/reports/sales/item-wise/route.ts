import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/sales/item-wise
 * Get item-wise sales report aggregating sales by item
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

    const items = await db.queryRows(`
      SELECT 
        COALESCE(ii.item_id, ii.id::text) as item_id,
        ii.item_name,
        ii.hsn_sac,
        COALESCE(it.unit, ii.unit, 'pcs') as unit,
        SUM(ii.quantity) as total_quantity,
        AVG(ii.unit_price) as avg_unit_price,
        SUM(ii.line_total) as total_amount,
        SUM(ii.discount_amount) as total_discount,
        SUM(ii.tax_amount) as total_tax,
        SUM(ii.taxable_value) as total_taxable_value,
        COUNT(DISTINCT ii.invoice_id) FILTER (WHERE i.status != 'cancelled') as invoice_count
      FROM invoice_items ii
      INNER JOIN invoices i ON ii.invoice_id = i.id AND i.deleted_at IS NULL
      LEFT JOIN items it ON ii.item_id = it.id
      WHERE i.business_id = $1 
        AND i.deleted_at IS NULL
        AND i.status != 'cancelled' 
        ${dateFilter}
      GROUP BY 
        COALESCE(ii.item_id, ii.id::text),
        ii.item_name,
        ii.hsn_sac,
        COALESCE(it.unit, ii.unit, 'pcs')
      ORDER BY total_amount DESC
    `, queryParams);

    // Calculate totals
    const totals = items.reduce((acc, item) => {
      acc.total_quantity += parseFloat(item.total_quantity || 0);
      acc.total_amount += parseFloat(item.total_amount || 0);
      acc.total_discount += parseFloat(item.total_discount || 0);
      acc.total_tax += parseFloat(item.total_tax || 0);
      acc.total_taxable_value += parseFloat(item.total_taxable_value || 0);
      return acc;
    }, {
      total_quantity: 0,
      total_amount: 0,
      total_discount: 0,
      total_tax: 0,
      total_taxable_value: 0,
    });

    return NextResponse.json({
      items,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating item-wise sales report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

