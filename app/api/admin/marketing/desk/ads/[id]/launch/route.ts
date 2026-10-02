import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/platform-auth';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { launchMarketingAd } from '@/lib/marketing/ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const ad = await launchMarketingAd(params.id);
    await logAdminAction(auth.admin.id, 'marketing_ad_launch', 'marketing_ad', ad.id);
    return NextResponse.json({ ad });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not launch the ad';
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
