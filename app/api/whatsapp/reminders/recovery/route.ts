export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { withWhatsAppBaseApi } from '@/lib/security/premium-module-api';
import { getReminderRecoveryReport } from '@/lib/payment-reminders/recovery';

const YMD = /^\d{4}-\d{2}-\d{2}$/;

function ymd(d: Date): string {
  return new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/**
 * GET /api/whatsapp/reminders/recovery?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Money chased by payment reminders in the period and how much came in afterwards
 * (lib/payment-reminders/recovery.ts). Defaults to the last 90 days.
 */
export const GET = withWhatsAppBaseApi({ managePermission: 'read' }, async ({ request, businessId }) => {
  try {
    const sp = new URL(request.url).searchParams;
    const today = ymd(new Date());
    const to = YMD.test(sp.get('to') ?? '') ? (sp.get('to') as string) : today;
    const from = YMD.test(sp.get('from') ?? '')
      ? (sp.get('from') as string)
      : ymd(new Date(Date.now() - 89 * 86_400_000));
    if (from > to) return NextResponse.json({ error: 'From must be on or before To' }, { status: 400 });
    const report = await getReminderRecoveryReport(businessId, from, to);
    return NextResponse.json(report);
  } catch (error) {
    console.error('[whatsapp/reminders/recovery] GET error:', error);
    return NextResponse.json({ error: 'Failed to load reminder recovery' }, { status: 500 });
  }
});
