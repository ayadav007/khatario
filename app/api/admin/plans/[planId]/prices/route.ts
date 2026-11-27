import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { scheduleKbReindex } from '@/lib/rag/queue';
import {
  applyPlanPriceEdit,
  countBusinessesOnPlan,
  loadPlanPricesPaise,
  planEditFailureResponse,
} from '@/lib/admin-plan-edit';
import { countBusinessesOnOlderTerms } from '@/lib/subscription/plan-terms';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/plans/[planId]/prices
 * The plan's current monthly, yearly and three-year prices in paise, how many businesses are on the plan
 * (`affected_businesses`) and how many of them are on older terms (`on_older_terms`).
 */
export async function GET(request: NextRequest, { params }: { params: { planId: string } }) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
    if (!auth.ok) return auth.response;
    const { planId } = params;
    const prices = await loadPlanPricesPaise(planId);
    if (!prices) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json({
      planId,
      prices,
      affected_businesses: await countBusinessesOnPlan(planId),
      on_older_terms: await countBusinessesOnOlderTerms(planId),
    });
  } catch (error: any) {
    console.error('Error fetching plan prices:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch plan prices' }, { status: 500 });
  }
}

/**
 * POST /api/admin/plans/[planId]/prices
 * Body: { prices: { price_monthly?: paise, price_yearly?: paise, price_3year?: paise },
 *         confirm_affected_count: number, scope: 'everyone' | 'new_customers' }
 * Prices are whole paise: 0 or at least 100 (Rs 1), never negative. confirm_affected_count must equal the number of
 * businesses on the plan (GET `affected_businesses`) and scope is required when there are any: "everyone" changes the
 * price for all of them at their next purchase; "new_customers" leaves the businesses already on the plan paying
 * what they pay now for as long as they stay on it. Logged with before and after in paise and the choice made.
 */
export async function POST(request: NextRequest, { params }: { params: { planId: string } }) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
    if (!auth.ok) return auth.response;

    const { planId } = params;
    const { prices, confirm_affected_count, scope } = await request.json();

    const plan = await db.queryOne(`SELECT id FROM subscription_plans WHERE id = $1`, [planId]);
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    const result = await applyPlanPriceEdit({
      planId,
      adminId: auth.admin.id,
      prices,
      confirmAffectedCount: confirm_affected_count,
      scope,
    });
    if (!result.ok) return planEditFailureResponse(result);

    // Plan prices are read by checkout, the plan lists and the over-limit caches: clear what they hold.
    clearAllSubscriptionCaches();
    scheduleKbReindex({ target: 'plans', reason: 'plan_prices_saved' });

    return NextResponse.json({
      success: true,
      affected_businesses: result.affected,
      scope: result.scope,
      businesses_pinned: result.pinned,
      message: 'Plan prices updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating plan prices:', error);
    return NextResponse.json({ error: error.message || 'Failed to update plan prices' }, { status: 500 });
  }
}
