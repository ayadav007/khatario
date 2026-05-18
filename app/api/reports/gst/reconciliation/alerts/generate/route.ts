import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { generateReconciliationAlerts } from '@/lib/gst/gstr13b-alerts';
import type { Gstr13bReconciliationMode } from '@/lib/gst/gstr1-3b-reconciliation';
import { resolveBranchId } from '@/lib/branch-helpers';

const MODES: Gstr13bReconciliationMode[] = ['live_vs_live', 'filed_vs_live', 'filed_vs_filed'];

/**
 * POST /api/reports/gst/reconciliation/alerts/generate
 * Body: { period: "YYYY-MM", mode?: ..., branch_id?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const period = typeof body.period === 'string' ? body.period.trim() : '';
    const modeRaw = body.mode as Gstr13bReconciliationMode | undefined;
    const branchIdBody = typeof body.branch_id === 'string' ? body.branch_id : undefined;

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

    let finalBranchId: string;
    try {
      finalBranchId = await resolveBranchId({
        branchId: branchIdBody || undefined,
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
        resource: { business_id, branch_id: finalBranchId },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const { result, alertId, alertAction } = await generateReconciliationAlerts({
      businessId: business_id,
      gstPeriod: period,
      branchId: finalBranchId,
      mode,
    });

    return NextResponse.json({
      alert_id: alertId,
      alert_action: alertAction,
      reconciliation_status: result.status,
    });
  } catch (error: any) {
    console.error('GST reconciliation alerts generate error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to generate alerts' },
      { status: 500 }
    );
  }
}
