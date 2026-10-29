/**
 * Connect lead sources (all businesses): pull new IndiaMART buy-leads for every connected business
 * that has not been pulled in the last 5 minutes (IndiaMART's own limit). Each new enquiry becomes a
 * lead on the pipeline (its chat links when the buyer messages); an enquiry is never imported twice.
 *
 * Call: GET /api/cron/whatsapp-lead-sources (every 10 minutes)
 */
import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { syncAllIndiaMart } from '@/lib/whatsapp/lead-sources';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    const runs = await syncAllIndiaMart();
    return NextResponse.json({
      businesses: runs.length,
      imported: runs.reduce((n, r) => n + r.imported, 0),
      errors: runs.filter((r) => r.error).length,
    });
  } catch (error: any) {
    console.error('[cron whatsapp-lead-sources] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
