import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { dueSummaryBusinessIds, sendOwnerSummary } from '@/lib/whatsapp/owner-summary';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/cron/owner-daily-summary — run every 15 minutes.
 * Sends the evening business summary to each linked owner whose chosen time (Indian time) has
 * passed today, at most once per day, through the business's own WhatsApp number.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    const ids = await dueSummaryBusinessIds();
    const results = { due: ids.length, sent: 0, noTemplate: 0, failed: 0, skipped: 0 };
    for (const businessId of ids) {
      const res = await sendOwnerSummary(businessId);
      if (res.sent) results.sent++;
      else if (res.reason === 'no_template') results.noTemplate++;
      else if (res.reason === 'failed') results.failed++;
      else results.skipped++;
    }
    return NextResponse.json({ ok: true, ...results });
  } catch (err) {
    console.error('[cron/owner-daily-summary] failed:', err);
    return NextResponse.json({ ok: false, error: 'Owner summary run failed' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  return POST(request);
}
