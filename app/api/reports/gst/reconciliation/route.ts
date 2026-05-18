import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  runGstr13bReconciliation,
  type Gstr13bReconciliationMode,
} from '@/lib/gst/gstr1-3b-reconciliation';
import {
  buildReconciliationUiInsights,
  syncGstReconciliationAlertsFromResult,
} from '@/lib/gst/gstr13b-alerts';

const MODES: Gstr13bReconciliationMode[] = ['live_vs_live', 'filed_vs_live', 'filed_vs_filed'];

/**
 * GET /api/reports/gst/reconciliation?period=YYYY-MM&branch_id=&mode=live_vs_live|filed_vs_live|filed_vs_filed
 * GSTR-1 vs GSTR-3B reconciliation (head-wise, categories, voucher drill-down, audit exceptions).
 */
export async function GET(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period')?.trim();
    const branchIdParam = searchParams.get('branch_id');
    const modeRaw = searchParams.get('mode')?.trim() as Gstr13bReconciliationMode | undefined;

    if (!period || !/^\d{4}-\d{2}$/.test(period)) {
      return NextResponse.json({ error: 'period (YYYY-MM) is required' }, { status: 400 });
    }

    const mode: Gstr13bReconciliationMode = modeRaw ?? 'live_vs_live';
    if (!MODES.includes(mode)) {
      return NextResponse.json(
        { error: `mode must be one of: ${MODES.join(', ')}` },
        { status: 400 }
      );
    }

    try {
      await assertReportAccess(business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { resolveBranchId } = await import('@/lib/branch-helpers');
    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdParam || undefined,
        businessId: business_id,
      });
    } catch (error: any) {
      if (
        error.code === 'BRANCH_NOT_FOUND' ||
        error.code === 'BRANCH_BUSINESS_MISMATCH' ||
        error.code === 'BRANCH_INACTIVE'
      ) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      if (error.code === 'NO_DEFAULT_BRANCH') {
        return NextResponse.json({ error: error.message }, { status: 500 });
      }
      throw error;
    }

    try {
      await authorize(userId, 'report.gst', 'read', {
        businessId: business_id,
        branchId: finalBranchId,
        resource: {
          business_id,
          branch_id: finalBranchId,
        },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const payload = await runGstr13bReconciliation({
      businessId: business_id,
      gstPeriod: period,
      branchId: finalBranchId,
      mode,
    });

    try {
      await syncGstReconciliationAlertsFromResult(business_id, payload);
    } catch (alertErr) {
      console.error('GST reconciliation alert sync failed:', alertErr);
    }

    const insights = buildReconciliationUiInsights(payload);

    return NextResponse.json({ ...payload, insights });
  } catch (error: any) {
    console.error('GST reconciliation error:', error);
    return NextResponse.json(
      { error: error?.message || 'GST reconciliation failed' },
      { status: 500 }
    );
  }
}
