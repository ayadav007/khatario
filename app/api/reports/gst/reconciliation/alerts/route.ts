import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { assertReportAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  countOpenGstReconciliationAlertsBySeverity,
  listGstReconciliationAlerts,
} from '@/lib/gst/gstr13b-alerts';
import type { Gstr13bReconciliationMode } from '@/lib/gst/gstr1-3b-reconciliation';
import { resolveBranchId } from '@/lib/branch-helpers';

const MODES: Gstr13bReconciliationMode[] = ['live_vs_live', 'filed_vs_live', 'filed_vs_filed'];

/**
 * GET /api/reports/gst/reconciliation/alerts?period=YYYY-MM&branch_id=&mode=&status=&limit=
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
    const modeRaw = searchParams.get('mode')?.trim();
    const statusRaw = searchParams.get('status')?.trim() as 'open' | 'resolved' | 'all' | undefined;
    const limitRaw = searchParams.get('limit');
    const limitParsed = limitRaw ? parseInt(limitRaw, 10) : 100;

    if (modeRaw && !MODES.includes(modeRaw as Gstr13bReconciliationMode)) {
      return NextResponse.json({ error: `mode must be one of: ${MODES.join(', ')}` }, { status: 400 });
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

    const status =
      statusRaw === 'open' || statusRaw === 'resolved' ? statusRaw : 'all';

    const limitClamped = Math.min(200, Math.max(1, Number.isFinite(limitParsed) ? limitParsed : 100));

    const alerts = await listGstReconciliationAlerts({
      businessId: business_id,
      gstPeriod: period || undefined,
      branchId: finalBranchId,
      mode: modeRaw ? (modeRaw as Gstr13bReconciliationMode) : undefined,
      status,
      limit: limitClamped,
    });

    const open_counts_by_severity = await countOpenGstReconciliationAlertsBySeverity({
      businessId: business_id,
      gstPeriod: period || undefined,
      branchId: finalBranchId,
      mode: modeRaw ? (modeRaw as Gstr13bReconciliationMode) : undefined,
    });

    return NextResponse.json({ alerts, open_counts_by_severity });
  } catch (error: any) {
    console.error('GST reconciliation alerts list error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to list alerts' },
      { status: 500 }
    );
  }
}
