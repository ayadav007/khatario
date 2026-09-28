import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runRecurringInvoices } from '@/lib/invoices/recurring';

export const dynamic = 'force-dynamic';

function todayIst(): string {
  return new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
}

/** GET/POST /api/cron/recurring-invoices — raise every recurring invoice due today (IST). */
async function handle(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const results = await runRecurringInvoices(getPool(), { today: todayIst() });
    const created = results.reduce((s, r) => s + r.created.length, 0);
    const failed = results.filter((r) => r.error).length;
    return NextResponse.json({ ok: true, created, failed, results });
  } catch (error: any) {
    console.error('recurring-invoices cron failed:', error);
    return NextResponse.json({ error: error.message || 'Cron failed' }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
