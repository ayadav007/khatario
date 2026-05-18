import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/plans/[planId]/features
 * 
 * Returns all features with their enabled status for a specific plan.
 * Used by admin UI to display plan feature toggles.
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

    // Fetch all features with enabled status for this plan
    const features = await db.query(
      `SELECT 
        pf.id,
        pf.category,
        pf.label,
        pf.description,
        pf.icon_name,
        pf.route_path,
        pf.is_addon,
        pf.sort_order,
        COALESCE(spf.enabled, false) as enabled
      FROM platform_features pf
      LEFT JOIN subscription_plan_features spf 
        ON pf.id = spf.feature_id AND spf.plan_id = $1
      WHERE pf.is_active = true
      ORDER BY pf.category, pf.sort_order`,
      [planId]
    );

    // Group by category
    const grouped = features.rows.reduce((acc: any, f: any) => {
      if (!acc[f.category]) {
        acc[f.category] = [];
      }
      acc[f.category].push({
        id: f.id,
        label: f.label,
        description: f.description,
        icon_name: f.icon_name,
        route_path: f.route_path,
        is_addon: f.is_addon,
        enabled: f.enabled,
        sort_order: f.sort_order
      });
      return acc;
    }, {});

    return NextResponse.json({
      planId,
      features: grouped,
      categories: Object.keys(grouped)
    });
  } catch (error: any) {
    console.error('Error fetching plan features:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to fetch plan features' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/plans/[planId]/features
 * 
 * Updates feature toggles for a specific plan.
 * Body: { features: { [featureId]: boolean } }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { planId: string } }
) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
    if (!auth.ok) return auth.response;

    const { planId } = params;
    const { features } = await request.json(); // { feature_id: enabled }

    if (!features || typeof features !== 'object') {
      return NextResponse.json(
        { error: 'features object is required' },
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
      // Clear existing mappings for this plan
      await db.query(
        'DELETE FROM subscription_plan_features WHERE plan_id = $1',
        [planId]
      );

      // Insert new mappings
      for (const [featureId, enabled] of Object.entries(features)) {
        if (enabled === true) {
          // Verify feature exists
          const featureExists = await db.queryOne(
            `SELECT id FROM platform_features WHERE id = $1 AND is_active = true`,
            [featureId]
          );

          if (featureExists) {
            await db.query(
              `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
               VALUES ($1, $2, true)
               ON CONFLICT (plan_id, feature_id) DO UPDATE SET enabled = true`,
              [planId, featureId]
            );
          }
        }
      }

      await db.query('COMMIT');

      // Clear subscription cache so changes take effect immediately
      clearAllSubscriptionCaches();

      return NextResponse.json({ 
        success: true,
        message: 'Plan features updated successfully'
      });
    } catch (error) {
      await db.query('ROLLBACK');
      throw error;
    }
  } catch (error: any) {
    console.error('Error updating plan features:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to update plan features' },
      { status: 500 }
    );
  }
}
