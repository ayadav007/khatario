import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runShiftRosterAbsentMarking } from '@/lib/hr/shift-overtime/roster-absent';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('business_id') ?? undefined;
  const targetDate = searchParams.get('date') ?? undefined;

  const result = await runShiftRosterAbsentMarking({ businessId, targetDate });
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
