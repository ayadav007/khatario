import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { scheduleKbReindex } from '@/lib/rag/queue';
import { applyPlanLimitEdit, confirmationRequired, countBusinessesOnPlan } from '@/lib/admin-plan-edit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/plans/[planId]/limits
 * 
 * Returns all limits with their values for a specific plan.
 * Used by admin UI to display plan limits.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { planId: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_subscriptions');
    if (!auth.ok) return auth.response;

    const { planId } = params;

    // Verify plan exists
    const plan = await db.queryOne(
      `SELECT id FROM subscription_plans WHERE id = $1`,
      [planId]
    );

    if (!plan) {
      return NextResponse.json(
        { error: 'Plan not found' },
        { status: 404 }
      );
    }

    // Fetch all limits with values for this plan
    const limits = await db.query(
      `SELECT 
        pl.limit_key,
        pl.category,
        pl.label,
        pl.description,
        pl.unit,
        pl.default_value,
        pl.sort_order,
        COALESCE(spl.limit_value, pl.default_value) as limit_value
      FROM platform_limits pl
      LEFT JOIN subscription_plan_limits spl 
        ON pl.limit_key = spl.limit_key AND spl.plan_id = $1
      WHERE pl.is_active = true
      ORDER BY pl.category, pl.sort_order`,
      [planId]
    );

    // Group by category
    const grouped = limits.rows.reduce((acc: any, l: any) => {
      if (!acc[l.category]) {
        acc[l.category] = [];
      }
      acc[l.category].push({
        limit_key: l.limit_key,
        label: l.label,
        description: l.description,
        unit: l.unit,
        limit_value: l.limit_value,
        default_value: l.default_value,
        sort_order: l.sort_order
      });
      return acc;
    }, {});

    return NextResponse.json({
      planId,
      affected_businesses: await countBusinessesOnPlan(planId),
      limits: grouped,
      categories: Object.keys(grouped)
    });
  } catch (error: any) {
    console.error('Error fetching plan limits:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch plan limits' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/plans/[planId]/limits
 * 
 * Updates limit values for a specific plan.
 * Body: { limits: { [limitKey]: limitValue }, confirm_affected_count: number }
 * confirm_affected_count must equal the number of businesses currently on the plan (returned by GET as
 * affected_businesses); otherwise 409 with the current count. The change is written to the admin audit log.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { planId: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
    if (!auth.ok) return auth.response;

    const { planId } = params;
    const { limits, confirm_affected_count } = await request.json(); // { limit_key: limit_value }

    if (!limits || typeof limits !== 'object') {
      return NextResponse.json(
        { error: 'limits object is required' },
        { status: 400 }
      );
    }

    // Verify plan exists
    const plan = await db.queryOne(
      `SELECT id FROM subscription_plans WHERE id = $1`,
      [planId]
    );

    if (!plan) {
      return NextResponse.json(
        { error: 'Plan not found' },
        { status: 404 }
      );
    }

    const result = await applyPlanLimitEdit({
      planId,
      adminId: auth.admin.id,
      limits,
      confirmAffectedCount: confirm_affected_count,
    });
    if (!result.ok) return confirmationRequired(result.affected);

    // Clear subscription cache so changes take effect immediately
    clearAllSubscriptionCaches();
    scheduleKbReindex({ target: 'plans', reason: 'plan_limits_saved' });

    return NextResponse.json({
      success: true,
      affected_businesses: result.affected,
      message: 'Plan limits updated successfully',
    });
  } catch (error: any) {
    console.error('Error updating plan limits:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update plan limits' },
      { status: 500 }
    );
  }
}
