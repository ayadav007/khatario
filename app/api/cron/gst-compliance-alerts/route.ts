import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runGstComplianceAlerts } from '@/lib/gst/compliance/engine';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/gst-compliance-alerts?as_on=YYYY-MM-DD&notify=true
 * Daily GST compliance checks for every operational business with a GSTIN. Sends bell
 * notifications (and email for critical alerts) only when an alert is new or reaches a new stage,
 * so running it more than once a day is harmless. Recommended: 09:00 IST.
 * A run with `as_on` is silent unless `notify=true`, so test dates never reach customers.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const params = new URL(request.url).searchParams;
  const asOn = params.get('as_on');
  if (asOn && !/^\d{4}-\d{2}-\d{2}$/.test(asOn)) {
    return NextResponse.json({ error: 'as_on must be YYYY-MM-DD' }, { status: 400 });
  }
  const notify = asOn ? params.get('notify') === 'true' : true;
  try {
    const summary = await runGstComplianceAlerts({ asOn: asOn ?? undefined, notify });
    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('[cron/gst-compliance-alerts] failed:', error);
    return NextResponse.json({ error: 'GST compliance run failed', details: error?.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
