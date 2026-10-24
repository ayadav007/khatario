import { NextResponse } from 'next/server';
import {
  dismissComplianceAlert,
  evaluateBusinessCompliance,
  listActiveComplianceAlerts,
  syncComplianceAlerts,
} from '@/lib/gst/compliance/engine';
import { gstComplianceGuard as guard } from '@/lib/gst/compliance/route-guard';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

/**
 * GET /api/gst/compliance-alerts
 * Re-runs the checks for this business (without sending notifications) and returns active alerts.
 * `include_dismissed=true` also returns alerts dismissed at their current stage.
 */
export const GET = withPremiumSubscriptionApi({}, async ({ request, businessId, userId }) => {
  const denied = await guard(userId, businessId);
  if (denied) return denied;
  try {
    const evaluation = await evaluateBusinessCompliance(businessId);
    await syncComplianceAlerts(businessId, evaluation, { notify: false });
    const includeDismissed = new URL(request.url).searchParams.get('include_dismissed') === 'true';
    const alerts = (await listActiveComplianceAlerts(businessId)).map((a) => ({
      ...a,
      amount: a.amount == null ? null : Number(a.amount),
      dismissed: a.dismissed_stage === a.stage,
    }));
    return NextResponse.json({
      alerts: includeDismissed ? alerts : alerts.filter((a) => !a.dismissed),
      dismissed_count: alerts.filter((a) => a.dismissed).length,
      skipped: evaluation.skipped ?? null,
    });
  } catch (error: any) {
    console.error('GST compliance alerts error:', error);
    return NextResponse.json({ error: 'Could not check GST compliance' }, { status: 500 });
  }
});

/** POST /api/gst/compliance-alerts  body: { alert_id, action: 'dismiss' } — hides it until its stage changes. */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  const denied = await guard(userId, businessId);
  if (denied) return denied;
  const { alert_id, action } = (body ?? {}) as { alert_id?: string; action?: string };
  if (action !== 'dismiss' || !alert_id || !/^[0-9a-f-]{36}$/i.test(alert_id)) {
    return NextResponse.json({ error: 'alert_id and action "dismiss" are required' }, { status: 400 });
  }
  const ok = await dismissComplianceAlert(businessId, alert_id, userId);
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Alert not found' }, { status: 404 });
});
