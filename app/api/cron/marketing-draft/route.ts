import { NextRequest, NextResponse } from 'next/server';
import { assertCronAuthorized } from '@/lib/cron-auth';
import { ensureDailyMarketingDraft } from '@/lib/marketing/posts';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const denied = assertCronAuthorized(request);
  if (denied) return denied;
  try {
    const result = await ensureDailyMarketingDraft();
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Draft cron failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
