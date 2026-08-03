import { NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, enforceAccessErrorResponse } from '@/lib/enforce-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { applyGstSetoff } from '@/lib/gst/gst-settlement';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * POST /api/gst/setoff
 * Post GST ITC set-off to the ledger (voucher_type gst_setoff).
 */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  try {
    const parsed = (body ?? {}) as {
      from?: string;
      to?: string;
      branch_id?: string;
      entry_date?: string;
      narration_prefix?: string;
      mode?: 'period' | 'balance';
      gst_period?: string;
      as_on_date?: string;
      lock_period_after?: boolean;
    };
    const from = parsed.from;
    const to = parsed.to;
    const branchIdParam = parsed.branch_id;
    const entryDate = parsed.entry_date;
    const narrationPrefix = parsed.narration_prefix;
    const mode = parsed.mode;
    const gst_period = parsed.gst_period;
    const as_on_date = parsed.as_on_date;
    const lock_period_after = parsed.lock_period_after;

    if (!from || !to) {
      return NextResponse.json({ error: 'from and to (YYYY-MM-DD) are required' }, { status: 400 });
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam,
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
      await authorize(userId, 'journal', 'create', {
        businessId,
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

    const result = await applyGstSetoff({
      businessId,
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
});
