import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { runProbationAutoConfirm } from '@/lib/hr/probation-auto-confirm';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;

  const businessId = request.nextUrl.searchParams.get('business_id') ?? undefined;
  const result = await runProbationAutoConfirm(businessId);
  return NextResponse.json({ ok: true, ...result });
}

export async function POST(request: NextRequest) {
  return GET(request);
}
