import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { calendarMonthBounds } from '@/lib/gst/gst-period-lock';
import { fileGstReturn } from '@/lib/gst/gst-filing';
import { parseGstDueDateBodyOverrides } from '@/lib/gst/gst-org-filing';

/**
 * POST /api/gst/file
 * Mark GST return as filed after settlement + payment + GSTR-3B critical checks; locks period.
 * Optional body: `interest_as_on_date` (YYYY-MM-DD) caps interest/challan window; defaults to filing date.
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
    const interest_payment_date = body.interest_payment_date as string | undefined;
    const interest_as_on_date = body.interest_as_on_date as string | undefined;
    const { override: dueDateOverride, due_date_inputs_from_request } = parseGstDueDateBodyOverrides(
      (body ?? {}) as Record<string, unknown>
    );

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

    const result = await fileGstReturn({
      businessId: business_id,
      branchId: finalBranchId,
      gstPeriod: gst_period.trim(),
      userId,
      notes: notes ?? null,
      interest_payment_date: interest_payment_date ?? null,
      interest_as_on_date: interest_as_on_date ?? null,
      dueDateOverride,
      due_date_inputs_from_request,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    console.error('GST file error:', error);
    const msg = error?.message || 'GST filing failed';
    let status = 500;
    if (msg.includes('already filed')) {
      status = 409;
    } else if (
      msg.includes('set-off not applied') ||
      msg.includes('payment pending') ||
      msg.includes('Resolve warnings') ||
      msg.includes('gst_period') ||
      msg.includes('YYYY-MM')
    ) {
      status = 400;
    }
    return NextResponse.json({ error: msg }, { status });
  }
}
