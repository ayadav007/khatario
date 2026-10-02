import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { liveAdPerformance } from '@/lib/marketing/ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

function isoDate(value: string | null): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const since = isoDate(request.nextUrl.searchParams.get('since')) || today;
  const until = isoDate(request.nextUrl.searchParams.get('until')) || today;
  try {
    const ads = await liveAdPerformance(since, until);
    return NextResponse.json({
      since,
      until,
      note: 'Numbers come from Meta and can lag. The automatic stop rule uses the last 7 days, not this date range.',
      ads,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not load performance';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
