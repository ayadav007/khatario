import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runLeaveYearEndForDueBusinesses } from '@/lib/hr/leave/leave-year-end';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const count = await runLeaveYearEndForDueBusinesses();
  return NextResponse.json({ ok: true, businesses_processed: count });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
