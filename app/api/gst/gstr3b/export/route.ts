import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { getGstr3BPortalExport } from '@/lib/gst/gstr3b-portal-export';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gst/gstr3b/export?period=YYYY-MM&branch_id=optional
 * Portal-style GSTR-3B JSON from filing snapshot (when filed/revised) or live ledger generator.
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

    const payload = await getGstr3BPortalExport({
      businessId,
      branchId: finalBranchId,
      gstPeriod: period.trim(),
    });

    return NextResponse.json(payload);
  } catch (error: any) {
    console.error('GSTR-3B export error:', error);
    const msg = error?.message || 'GSTR-3B export failed';
    const status =
      msg.includes('No GST data') || msg.includes('gst_period') || msg.includes('snapshot')
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
});
