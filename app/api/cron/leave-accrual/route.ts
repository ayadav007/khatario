import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runLeaveAccrualForAllBusinesses } from '@/lib/hr/leave/leave-accrual';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const result = await runLeaveAccrualForAllBusinesses();
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
