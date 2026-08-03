import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getOutstandingGst } from '@/lib/gst/gst-settlement';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gst/outstanding?as_on_date=YYYY-MM-DD&branch_id=optional
 * Ledger balances for output GST + RCM (2155) as at date.
 */
export const GET = withPremiumSubscriptionApi({}, async ({ request, businessId, userId }) => {
  try {
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
        businessId,
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
        businessId,
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
      businessId,
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
});
