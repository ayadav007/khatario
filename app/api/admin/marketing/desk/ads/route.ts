import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { listMarketingAds } from '@/lib/marketing/ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const ads = await listMarketingAds();
    return NextResponse.json({ ads });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not load ads';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
