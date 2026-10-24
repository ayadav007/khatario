/**
 * WhatsApp inbox housekeeping (all businesses):
 * - chats owned by a removed or deactivated agent go back to Requesting;
 * - intervened chats whose customer has been silent for 24h are auto-resolved
 *   (only for businesses with the auto-resolve setting on).
 *
 * Call: GET /api/cron/whatsapp-auto-resolve
 */
import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { autoResolveStale, releaseOrphaned } from '@/lib/whatsapp/inbox-ownership';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  try {
    const released = await releaseOrphaned();
    const autoResolved = await autoResolveStale();
    return NextResponse.json({ released, auto_resolved: autoResolved });
  } catch (error: any) {
    console.error('[cron whatsapp-auto-resolve] failed:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
