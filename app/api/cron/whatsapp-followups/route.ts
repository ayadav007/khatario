/**
 * WhatsApp follow-up reminders (all businesses): notify each agent once when a reminder falls due.
 * Reminders set to cancel on reply are dropped instead when the customer has written since.
 * Rows are claimed before notifying, so overlapping runs are safe.
 * Also rewrites the lead summary of chats that have gone quiet (lib/whatsapp/lead-summary).
 *
 * Call: GET /api/cron/whatsapp-followups (every 5 minutes)
 */
import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runDueFollowupReminders } from '@/lib/whatsapp/followups';
import { runDueLeadSummaries } from '@/lib/whatsapp/lead-summary';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    const reminders = await runDueFollowupReminders();
    const summaries = await runDueLeadSummaries().catch((error) => {
      console.error('[cron whatsapp-followups] lead summaries failed:', error);
      return { error: error instanceof Error ? error.message : String(error) };
    });
    return NextResponse.json({ ...reminders, summaries });
  } catch (error: any) {
    console.error('[cron whatsapp-followups] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
