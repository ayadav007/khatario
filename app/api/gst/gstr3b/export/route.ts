import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { getGstr3BPortalExport } from '@/lib/gst/gstr3b-portal-export';

/**
 * GET /api/gst/gstr3b/export?period=YYYY-MM&branch_id=optional
 * Portal-style GSTR-3B JSON from filing snapshot (when filed/revised) or live ledger generator.
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

    try {
      await enforceAccess({
        businessId: business_id,
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
      businessId: business_id,
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
}
