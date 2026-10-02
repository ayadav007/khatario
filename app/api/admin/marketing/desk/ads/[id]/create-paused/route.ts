import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/platform-auth';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { createPausedMarketingAd } from '@/lib/marketing/ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 60;

type Params = { params: { id: string } };

export async function POST(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const ad = await createPausedMarketingAd(params.id);
    await logAdminAction(auth.admin.id, 'marketing_ad_create_paused', 'marketing_ad', ad.id, {
      meta_ad_id: ad.meta_ad_id,
    });
    return NextResponse.json({ ad });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not create the paused ad';
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
