import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

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
 * Body: { limits: { [limitKey]: limitValue } }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { planId: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
    if (!auth.ok) return auth.response;

    const { planId } = params;
    const { limits } = await request.json(); // { limit_key: limit_value }

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

    // Start transaction
    await db.query('BEGIN');

    try {
      // Upsert only keys sent — do not delete other plan limits (partial form saves).
      for (const [limitKey, limitValue] of Object.entries(limits)) {
        const value = typeof limitValue === 'number' ? limitValue : parseInt(String(limitValue));

        const limitExists = await db.queryOne(
          `SELECT limit_key FROM platform_limits WHERE limit_key = $1 AND is_active = true`,
          [limitKey]
        );

        if (limitExists && !isNaN(value)) {
          await db.query(
            `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
             VALUES ($1, $2, $3)
             ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = $3`,
            [planId, limitKey, value]
          );
        }
      }

      await db.query('COMMIT');

      // Clear subscription cache so changes take effect immediately
      clearAllSubscriptionCaches();

      return NextResponse.json({ 
        success: true,
        message: 'Plan limits updated successfully'
      });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error: any) {
    console.error('Error updating plan limits:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update plan limits' },
      { status: 500 }
    );
  }
}
