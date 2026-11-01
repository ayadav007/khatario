import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runKhataStatements } from '@/lib/khata/statements';

export const dynamic = 'force-dynamic';

/**
 * GET/POST /api/cron/khata-statements
 * Daily: khata statements for customers whose settlement day is today (IST), then overdue
 * reminders every few days (business setting). Safe to call more than once a day.
 * Schedule once a day in the morning, India time (docs/SERVER_INFRASTRUCTURE.md).
 */
export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}

export async function POST(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  return run();
}

async function run() {
  try {
    const result = await runKhataStatements();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error('[cron khata-statements]', error);
    return NextResponse.json({ ok: false, error: 'Khata statements failed' }, { status: 500 });
  }
}
