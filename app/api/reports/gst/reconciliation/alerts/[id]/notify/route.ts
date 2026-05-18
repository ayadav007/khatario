import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { resolveBranchId } from '@/lib/branch-helpers';
import {
  deliverGstReconciliationAlertNotifications,
  parseGstAlertDetailsRecord,
  minimalGstr13bResultFromAlertDetails,
} from '@/lib/gst/gstr13b-notifications';
import { getGstReconciliationAlertById } from '@/lib/gst/gstr13b-alerts';
import type { GstReconciliationAlertSeverity } from '@/lib/gst/gstr13b-alerts';

/**
 * POST /api/reports/gst/reconciliation/alerts/:id/notify?force=true
 * Manual test / resend (async fire-and-forget).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const business_id = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!business_id) {
      return NextResponse.json({ error: 'business_id is required' }, { status: 400 });
    }
    if (!userId) {
      return NextResponse.json({ error: 'user_id is required for authorization' }, { status: 400 });
    }

    const { id: alertId } = params;
    if (!alertId) {
      return NextResponse.json({ error: 'alert id is required' }, { status: 400 });
    }

    try {
      await assertReportAccess(business_id, 'gst');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const alert = await getGstReconciliationAlertById(alertId, business_id);
    if (!alert) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const force = searchParams.get('force') === 'true' || searchParams.get('force') === '1';
    const branchIdParam = searchParams.get('branch_id');

    let authBranchId: string;
    try {
      authBranchId = await resolveBranchId({
        branchId: alert.branch_id ?? (branchIdParam || undefined),
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
        branchId: authBranchId,
        resource: { business_id, branch_id: authBranchId },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const details = parseGstAlertDetailsRecord(alert.details);
    if (!details) {
      return NextResponse.json({ error: 'Alert details are incomplete; cannot build notification' }, { status: 400 });
    }

    const summary = (alert.summary && String(alert.summary).trim()) || 'GST reconciliation alert';
    const severity = (alert.severity as GstReconciliationAlertSeverity) || 'medium';
    const branchForResult = alert.branch_id ?? authBranchId;

    const syntheticResult = minimalGstr13bResultFromAlertDetails(
      details,
      alert.mode,
      alert.gst_period,
      branchForResult
    );

    void deliverGstReconciliationAlertNotifications({
      alertId: alert.id,
      businessId: business_id,
      branchId: alert.branch_id,
      gstPeriod: alert.gst_period,
      mode: alert.mode,
      severity,
      summary,
      details,
      result: syntheticResult,
      triggerReason: 'manual',
      forceDelivery: force,
    });

    return NextResponse.json({ ok: true, queued: true, force });
  } catch (error: any) {
    console.error('GST alert manual notify error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to queue notification' },
      { status: 500 }
    );
  }
}
