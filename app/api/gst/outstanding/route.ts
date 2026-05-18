import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getOutstandingGst } from '@/lib/gst/gst-settlement';

/**
 * GET /api/gst/outstanding?as_on_date=YYYY-MM-DD&branch_id=optional
 * Ledger balances for output GST + RCM (2155) as at date.
 */
export async function GET(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const asOnDate = searchParams.get('as_on_date');
    const branchIdParam = searchParams.get('branch_id');

    if (!asOnDate) {
      return NextResponse.json({ error: 'as_on_date is required (YYYY-MM-DD)' }, { status: 400 });
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam || undefined,
        businessId: business_id,
      });
    } catch (error: any) {
      if (error.code === 'BRANCH_NOT_FOUND' || error.code === 'BRANCH_BUSINESS_MISMATCH' || error.code === 'BRANCH_INACTIVE') {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'journal', 'read', {
        businessId: business_id,
        branchId: finalBranchId,
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const consolidated = searchParams.get('consolidated') === '1' || searchParams.get('consolidated') === 'true';

    const result = await getOutstandingGst({
      businessId: business_id,
      asOnDate,
      branchId: consolidated ? null : finalBranchId,
    });

    return NextResponse.json({
      ...result,
      branch_scope: consolidated ? 'all_branches' : finalBranchId,
    });
  } catch (error: any) {
    console.error('GST outstanding error:', error);
    return NextResponse.json({ error: error?.message || 'Failed to load outstanding GST' }, { status: 500 });
  }
}
