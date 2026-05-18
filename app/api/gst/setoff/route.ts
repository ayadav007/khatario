import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { applyGstSetoff } from '@/lib/gst/gst-settlement';

/**
 * POST /api/gst/setoff
 * Post GST ITC set-off to the ledger (voucher_type gst_setoff).
 */
export async function POST(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 401 });
    }

    const body = await request.json();
    const from = body.from as string | undefined;
    const to = body.to as string | undefined;
    const branchIdParam = body.branch_id as string | undefined;
    const entryDate = body.entry_date as string | undefined;
    const narrationPrefix = body.narration_prefix as string | undefined;
    const mode = body.mode as 'period' | 'balance' | undefined;
    const gst_period = body.gst_period as string | undefined;
    const as_on_date = body.as_on_date as string | undefined;
    const lock_period_after = body.lock_period_after as boolean | undefined;

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
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
      await authorize(userId, 'journal', 'create', {
        businessId: business_id,
        branchId: finalBranchId,
        entry_date: entryDate || to,
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

    const result = await applyGstSetoff({
      businessId: business_id,
      from,
      to,
      branchId: finalBranchId,
      entryDate,
      narrationPrefix,
      mode,
      gst_period,
      as_on_date,
      lock_period_after,
      locked_by: userId,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GST set-off error:', error);
    const msg = error?.message || 'GST set-off failed';
    const status =
      msg.includes('already settled') || msg.includes('already applied') ? 409 : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
