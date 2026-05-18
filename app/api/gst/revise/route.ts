import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { calendarMonthBounds } from '@/lib/gst/gst-period-lock';
import { reviseGstReturn } from '@/lib/gst/gst-filing';

/**
 * POST /api/gst/revise
 * Move a filed return to `revised` so books can be corrected (GSTR-3B amendment workflow).
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
    const gst_period = body.gst_period as string | undefined;
    const branchIdParam = body.branch_id as string | undefined;
    const notes = body.notes as string | undefined;

    if (!gst_period) {
      return NextResponse.json({ error: 'gst_period (YYYY-MM) is required' }, { status: 400 });
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

    const { end: periodEnd } = calendarMonthBounds(gst_period);

    try {
      await authorize(userId, 'journal', 'create', {
        businessId: business_id,
        branchId: finalBranchId,
        entry_date: periodEnd,
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

    const filing = await reviseGstReturn({
      businessId: business_id,
      branchId: finalBranchId,
      gstPeriod: gst_period.trim(),
      userId,
      notes: notes ?? null,
    });

    return NextResponse.json({ filing });
  } catch (error: any) {
    console.error('GST revise error:', error);
    const msg = error?.message || 'GST revise failed';
    const status =
      msg.includes('Only filed') || msg.includes('No GST filing') || msg.includes('gst_period')
        ? 400
        : 500;
    return NextResponse.json({ error: msg }, { status });
  }
}
