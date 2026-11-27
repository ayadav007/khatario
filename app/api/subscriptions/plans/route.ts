import { NextRequest, NextResponse } from 'next/server';
import { getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { normalizePlatformModule } from '@/lib/platform-modules';
import { productLineForModule } from '@/lib/subscription/plan-module';
import { listPlansOfferedTo } from '@/lib/subscription/plan-offers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions/plans[?module_key=billing|hr|connect]
 * The plans this business may be offered (in-app change-plan screens and the phone app): plans on sale,
 * plus the plan the business is on now. Each plan carries `offer` (on_sale, current, renewable,
 * selectable). The business is the signed-in session's; with no session only plans on sale are listed.
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getSessionScopedBusinessId(request);
    const moduleKey = normalizePlatformModule(request.nextUrl.searchParams.get('module_key'));
    const plans = await listPlansOfferedTo(businessId, {
      productLine: moduleKey ? productLineForModule(moduleKey) : null,
    });
    return NextResponse.json({ plans });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching subscription plans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription plans', details: message },
      { status: 500 },
    );
  }
}
