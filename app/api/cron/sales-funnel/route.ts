import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runDueFollowups, runLifecycleChecks } from '@/lib/sales-funnel/followups';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * POST /api/cron/sales-funnel (every 5 minutes)
 * Marks WhatsApp leads activated (first invoice) or converted (paid plan), then sends due
 * follow-ups: free-form inside the 24-hour window, approved templates outside it.
 */
export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const lifecycle = await runLifecycleChecks();
    const followups = await runDueFollowups();
    return NextResponse.json({ ok: true, lifecycle, followups });
  } catch (err) {
    console.error('[cron/sales-funnel] failed:', err);
    return NextResponse.json({ ok: false, error: 'Sales funnel cron failed' }, { status: 500 });
  }
}

export const GET = POST;
