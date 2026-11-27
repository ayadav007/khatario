import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { countBusinessesOnPlan, moveBusinessesToCurrentTerms } from '@/lib/admin-plan-edit';
import { countBusinessesOnOlderTerms } from '@/lib/subscription/plan-terms';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/plans/[planId]/terms
 * How many businesses are on the plan and how many of them are on older terms (they kept what they had
 * when an "only new customers" change was saved).
 */
export async function GET(request: NextRequest, { params }: { params: { planId: string } }) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
    if (!auth.ok) return auth.response;
    const { planId } = params;
    const plan = await db.queryOne(`SELECT id FROM subscription_plans WHERE id = $1`, [planId]);
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });
    return NextResponse.json({
      planId,
      affected_businesses: await countBusinessesOnPlan(planId),
      on_older_terms: await countBusinessesOnOlderTerms(planId),
    });
  } catch (error: any) {
    console.error('Error fetching plan terms:', error);
    return NextResponse.json({ error: error.message || 'Failed to fetch plan terms' }, { status: 500 });
  }
}

/**
 * POST /api/admin/plans/[planId]/terms
 * Body: { action: 'move_to_current', confirm_older_terms_count: number }
 * Moves every business on older terms of this plan to the plan's current terms. The count must equal the
 * current number on older terms (GET `on_older_terms`), otherwise 409 with the current count. Logged.
 */
export async function POST(request: NextRequest, { params }: { params: { planId: string } }) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
    if (!auth.ok) return auth.response;
    const { planId } = params;
    const body = await request.json();
    if (body?.action !== 'move_to_current') {
      return NextResponse.json({ error: 'action must be "move_to_current".' }, { status: 400 });
    }
    const plan = await db.queryOne(`SELECT id FROM subscription_plans WHERE id = $1`, [planId]);
    if (!plan) return NextResponse.json({ error: 'Plan not found' }, { status: 404 });

    const result = await moveBusinessesToCurrentTerms({
      planId,
      adminId: auth.admin.id,
      confirmOlderTermsCount: body.confirm_older_terms_count,
    });
    if (!result.ok) {
      return NextResponse.json(
        {
          error: `${result.onOlderTerms} ${result.onOlderTerms === 1 ? 'business is' : 'businesses are'} on older terms. Confirm the number to move them.`,
          code: 'CONFIRMATION_REQUIRED',
          on_older_terms: result.onOlderTerms,
        },
        { status: 409 },
      );
    }
    clearAllSubscriptionCaches();
    return NextResponse.json({ success: true, moved: result.moved });
  } catch (error: any) {
    console.error('Error moving businesses to current plan terms:', error);
    return NextResponse.json({ error: error.message || 'Failed to move businesses' }, { status: 500 });
  }
}
