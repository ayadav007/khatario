import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { listGstReconciliationAlertHistory } from '@/lib/gst/gstr13b-alerts';
import { resolveBranchId } from '@/lib/branch-helpers';

/**
 * GET /api/reports/gst/reconciliation/alerts/history?alert_id=UUID&limit=50&branch_id=
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
    const alertId = searchParams.get('alert_id')?.trim();
    const branchIdParam = searchParams.get('branch_id');
    const limitRaw = searchParams.get('limit');
    const limit = limitRaw ? parseInt(limitRaw, 10) : 50;

    if (!alertId) {
      return NextResponse.json({ error: 'alert_id is required' }, { status: 400 });
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
        resource: { business_id, branch_id: finalBranchId },
      });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const history = await listGstReconciliationAlertHistory({
      businessId: business_id,
      alertId,
      limit: Number.isFinite(limit) ? limit : 50,
    });

    return NextResponse.json({ history });
  } catch (error: any) {
    console.error('GST reconciliation alert history error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to load alert history' },
      { status: 500 }
    );
  }
}
