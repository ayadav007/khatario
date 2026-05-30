import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { LIMIT_KEY_BY_TYPE, type LimitCheckType } from '@/lib/subscription/limit-registry';
import { getLowestPlanForLimit } from '@/lib/subscription/limit-plan-recommendation';

/**
 * GET /api/subscriptions/limit-plan?limit_type=items&current=14
 * Lowest paid plan that would allow one more unit than `current`.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;

    const limitType = searchParams.get('limit_type') as LimitCheckType | null;
    const currentRaw = searchParams.get('current');
    const current = currentRaw != null ? parseInt(currentRaw, 10) : NaN;

    if (!limitType || !(limitType in LIMIT_KEY_BY_TYPE)) {
      return NextResponse.json({ error: 'Invalid limit_type' }, { status: 400 });
    }
    if (Number.isNaN(current) || current < 0) {
      return NextResponse.json({ error: 'current must be a non-negative integer' }, { status: 400 });
    }

    const recommendedPlan = await getLowestPlanForLimit(limitType, current);

    return NextResponse.json({ recommendedPlan });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching limit plan recommendation:', error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
