import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { getGstAuditComparison } from '@/lib/gst/gst-filing';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gst/audit-comparison?period=YYYY-MM&branch_id=optional
 * Stored filing snapshot vs freshly recalculated GSTR-3B (net payable delta + warnings).
 */
export const GET = withPremiumSubscriptionApi({}, async ({ request, businessId, userId }) => {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period');
    const branchIdParam = searchParams.get('branch_id');

    if (!period) {
      return NextResponse.json({ error: 'period (YYYY-MM) is required' }, { status: 400 });
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

    try {
      await enforceAccess({
        businessId,
        userId,
        branchId: finalBranchId,
        feature: FeatureKeys.LEDGER_ACCOUNTING,
      });
    } catch (e) {
      const res = enforceAccessErrorResponse(e);
      if (res) return res;
      throw e;
    }

    const payload = await getGstAuditComparison({
      businessId,
      branchId: finalBranchId,
      gstPeriod: period.trim(),
    });

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('GST audit-comparison error:', error);
    const msg = error?.message || 'Audit comparison failed';
    const status = msg.includes('No GST filing snapshot') ? 404 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
});
