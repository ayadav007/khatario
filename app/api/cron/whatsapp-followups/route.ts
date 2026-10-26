/**
 * WhatsApp follow-up reminders (all businesses): notify each agent once when a reminder falls due.
 * Reminders set to cancel on reply are dropped instead when the customer has written since.
 * Rows are claimed before notifying, so overlapping runs are safe.
 *
 * Call: GET /api/cron/whatsapp-followups (every 5 minutes)
 */
import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runDueFollowupReminders } from '@/lib/whatsapp/followups';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    return NextResponse.json(await runDueFollowupReminders());
  } catch (error: any) {
    console.error('[cron whatsapp-followups] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
