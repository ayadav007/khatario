import { NextRequest, NextResponse } from 'next/server';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { updateMarketingAdDraft } from '@/lib/marketing/ads';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: { id: string } };

export async function PATCH(request: NextRequest, { params }: Params) {
  const auth = await requirePlatformRequest(request, 'admin');
  if (!auth.ok) return auth.response;
  try {
    const body = await request.json();
    const budget = Number(body.daily_budget_rupees);
    const ad = await updateMarketingAdDraft({
      id: params.id,
      headline: typeof body.headline === 'string' ? body.headline : undefined,
      primaryText: typeof body.primary_text === 'string' ? body.primary_text : undefined,
      dailyBudgetRupees: Number.isFinite(budget) && budget > 0 ? budget : undefined,
    });
    return NextResponse.json({ ad });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Could not update the ad';
    const status = /not found/i.test(message) ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
