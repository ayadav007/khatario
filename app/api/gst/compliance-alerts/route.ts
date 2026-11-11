import { NextResponse } from 'next/server';
import {
  dismissComplianceAlert,
  evaluateBusinessCompliance,
  listActiveComplianceAlerts,
  listResolvedComplianceAlerts,
  restoreComplianceAlert,
  syncComplianceAlerts,
  type StoredAlert,
} from '@/lib/gst/compliance/engine';
import { todayIst } from '@/lib/gst/time-limits';
import { gstComplianceGuard as guard } from '@/lib/gst/compliance/route-guard';
import { withPremiumSubscriptionApi } from '@/lib/security/premium-module-api';

export const dynamic = 'force-dynamic';

const shape = (a: StoredAlert) => ({
  ...a,
  amount: a.amount == null ? null : Number(a.amount),
  dismissed: a.dismissed_stage === a.stage,
});

/** 1 April of the Indian FY that contains `asOn`. */
function fyStart(asOn: string): string {
  const year = Number(asOn.slice(0, 4));
  return `${Number(asOn.slice(5, 7)) >= 4 ? year : year - 1}-04-01`;
}

/**
 * GET /api/gst/compliance-alerts
 * Re-runs the checks for this business (without sending notifications) and returns active alerts,
 * those dismissed at their current stage, and alerts resolved this FY.
 */
export const GET = withPremiumSubscriptionApi({}, async ({ businessId, userId }) => {
  const denied = await guard(userId, businessId);
  if (denied) return denied;
  try {
    const evaluation = await evaluateBusinessCompliance(businessId);
    await syncComplianceAlerts(businessId, evaluation, { notify: false });
    const [active, resolved] = await Promise.all([
      listActiveComplianceAlerts(businessId),
      listResolvedComplianceAlerts(businessId, fyStart(todayIst())),
    ]);
    const shaped = active.map(shape);
    return NextResponse.json({
      alerts: shaped.filter((a) => !a.dismissed),
      dismissed: shaped.filter((a) => a.dismissed),
      resolved: resolved.map(shape),
      checked_at: new Date().toISOString(),
      skipped: evaluation.skipped ?? null,
    });
  } catch (error: any) {
    console.error('GST compliance alerts error:', error);
    return NextResponse.json({ error: 'Could not check GST compliance' }, { status: 500 });
  }
});

/**
 * POST /api/gst/compliance-alerts
 *   { alert_id, action: 'dismiss', reason } hides it until its stage changes and records why;
 *   { alert_id, action: 'restore' } shows it again.
 * There is no manual "resolve": an alert resolves only when its check stops finding the problem.
 */
export const POST = withPremiumSubscriptionApi({ parseJsonBody: true }, async ({ body, businessId, userId }) => {
  const denied = await guard(userId, businessId);
  if (denied) return denied;
  const { alert_id, action, reason } = (body ?? {}) as { alert_id?: string; action?: string; reason?: unknown };
  if ((action !== 'dismiss' && action !== 'restore') || !alert_id || !/^[0-9a-f-]{36}$/i.test(alert_id)) {
    return NextResponse.json({ error: 'alert_id and action "dismiss" or "restore" are required' }, { status: 400 });
  }
  let ok: boolean;
  if (action === 'dismiss') {
    const why = typeof reason === 'string' ? reason.trim() : '';
    if (why.length < 3 || why.length > 300) {
      return NextResponse.json({ error: 'Give a reason for dismissing this alert (3 to 300 characters)' }, { status: 400 });
    }
    ok = await dismissComplianceAlert(businessId, alert_id, userId, why);
  } else {
    ok = await restoreComplianceAlert(businessId, alert_id);
  }
  return ok ? NextResponse.json({ success: true }) : NextResponse.json({ error: 'Alert not found' }, { status: 404 });
});
