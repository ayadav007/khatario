import { NextRequest, NextResponse } from 'next/server';
import { logAdminAction } from '@/lib/platform-auth';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { generateMarketingAd } from '@/lib/marketing/ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const budget = Number(body.daily_budget_rupees);
    const ad = await generateMarketingAd({
      adminId: auth.admin.id,
      angle: String(body.angle || ''),
      dailyBudgetRupees: Number.isFinite(budget) ? budget : undefined,
    });
    await logAdminAction(auth.admin.id, 'marketing_ad_draft', 'marketing_ad', ad.id);
    return NextResponse.json({ ad });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not generate an ad';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
