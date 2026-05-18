import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import * as db from '@/lib/db';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * GET /api/reports/party/advances
 * Get advance received/paid report
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    const branchIdParam = searchParams.get('branch_id');
    const type = searchParams.get('type'); // 'received' or 'paid' or null for all
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

    let typeFilter = '';
    let dateFilter = '';
    const queryParams: any[] = [businessId];
    let paramIndex = 2;

    if (type) {
      typeFilter += ` AND ap.type = $${paramIndex}`;
      queryParams.push(type);
      paramIndex++;
    }

    if (fromDate) {
      dateFilter += ` AND ap.payment_date >= $${paramIndex}`;
      queryParams.push(fromDate);
      paramIndex++;
    }

    if (toDate) {
      dateFilter += ` AND ap.payment_date <= $${paramIndex}`;
      queryParams.push(toDate);
      paramIndex++;
    }

    const advances = await db.queryRows(`
      SELECT 
        ap.id,
        ap.type,
        ap.payment_date,
        ap.amount,
        ap.tax_rate,
        ap.cgst + ap.sgst + ap.igst as tax_amount,
        ap.is_adjusted,
        ap.adjustment_date,
        CASE 
          WHEN ap.type = 'received' THEN c.name
          ELSE s.name
        END as party_name,
        CASE 
          WHEN ap.type = 'received' THEN c.phone
          ELSE s.phone
        END as party_phone,
        CASE 
          WHEN ap.type = 'received' THEN ap.adjusted_invoice_id::text
          ELSE ap.adjusted_purchase_id::text
        END as adjusted_reference
      FROM advance_payments ap
      LEFT JOIN customers c ON ap.customer_id = c.id AND c.deleted_at IS NULL
      LEFT JOIN suppliers s ON ap.supplier_id = s.id
      WHERE ap.business_id = $1 
        ${typeFilter}
        ${dateFilter}
      ORDER BY ap.payment_date DESC
    `, queryParams);

    // Calculate totals
    const totals = advances.reduce((acc, row) => {
      const amount = parseFloat(row.amount || 0);
      if (row.type === 'received') {
        acc.total_received += amount;
        acc.received_count += 1;
        if (!row.is_adjusted) acc.unadjusted_received += amount;
      } else {
        acc.total_paid += amount;
        acc.paid_count += 1;
        if (!row.is_adjusted) acc.unadjusted_paid += amount;
      }
      return acc;
    }, {
      total_received: 0,
      total_paid: 0,
      received_count: 0,
      paid_count: 0,
      unadjusted_received: 0,
      unadjusted_paid: 0,
    });

    return NextResponse.json({
      advances,
      totals,
    });
  } catch (error: any) {
    console.error('Error generating advances report:', error);
    return NextResponse.json(
      { error: 'Failed to generate report', details: error.message },
      { status: 500 }
    );
  }
}

