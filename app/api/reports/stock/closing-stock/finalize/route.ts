import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { finalizeClosingStock } from '@/lib/services/closing-stock-valuator';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';

/**
 * POST /api/reports/stock/closing-stock/finalize
 * Finalize closing stock snapshot
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { business_id, financial_year_id } = body;
    const userId = getUserIdFromRequest(request, body);

    if (!business_id || !financial_year_id) {
      return NextResponse.json(
        { error: 'business_id and financial_year_id are required' },
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
      await assertReportAccess(business_id, 'advanced');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    // AUTHORIZATION: Check read permission for inventory report (finalize is a read action)
    try {
      await authorize(userId, 'report.inventory', 'read', {
        businessId: business_id,
        resource: {
          business_id,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    await finalizeClosingStock(business_id, financial_year_id, userId);

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Error finalizing closing stock:', error);
    return NextResponse.json(
      { error: 'Failed to finalize closing stock', details: error.message },
      { status: 500 }
    );
  }
}

