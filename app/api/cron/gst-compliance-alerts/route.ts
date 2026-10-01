import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runGstComplianceAlerts } from '@/lib/gst/compliance/engine';

export const dynamic = 'force-dynamic';

/**
 * POST /api/cron/gst-compliance-alerts?as_on=YYYY-MM-DD
 * Daily GST compliance checks (Rule 37, 30 November deadline, GSTR-3B due dates) for every
 * operational business with a GSTIN. Notifies only when an alert is new or reaches a new stage,
 * so running it more than once a day is harmless. Recommended: 09:00 IST.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const asOn = new URL(request.url).searchParams.get('as_on');
  if (asOn && !/^\d{4}-\d{2}-\d{2}$/.test(asOn)) {
    return NextResponse.json({ error: 'as_on must be YYYY-MM-DD' }, { status: 400 });
  }
  try {
    const summary = await runGstComplianceAlerts({ asOn: asOn ?? undefined });
    return NextResponse.json({ success: true, summary });
  } catch (error: any) {
    console.error('[cron/gst-compliance-alerts] failed:', error);
    return NextResponse.json({ error: 'GST compliance run failed', details: error?.message }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
