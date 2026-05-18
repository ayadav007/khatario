import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';

/**
 * GET /api/admin/subscriptions/plans
 * Fetch all subscription plans
 *
 * Intentionally unauthenticated: used by marketing landing, in-app upgrade UI, and settings.
 * Merges Feature Registry and Limits Registry data with JSONB for display
 */
export async function GET(request: NextRequest) {
  try {
    const plans = await db.queryRows(`
      SELECT 
        id,
        name,
        display_name,
        description,
        price_monthly,
        price_yearly,
        currency,
        features,
        is_active,
        sort_order,
        created_at,
        updated_at
      FROM subscription_plans
      WHERE is_active = true
      ORDER BY sort_order ASC
    `);

    // Merge registry data with JSONB for each plan
    const plansWithRegistry = await Promise.all(
      plans.map(async (plan: any) => {
        // Parse features JSONB if it's a string
        const features = typeof plan.features === 'string' 
          ? JSON.parse(plan.features) 
          : plan.features;

        // Try to fetch from Feature Registry
        try {
          const enabledFeatures = await db.query(`
            SELECT feature_id 
            FROM subscription_plan_features 
            WHERE plan_id = $1 AND enabled = true
          `, [plan.id]);

          if (enabledFeatures.rows.length > 0) {
            // Merge registry features into JSONB structure
            if (!features.features) features.features = {};
            
            // Get feature labels from platform_features for display
            const featureDetails = await db.query(`
              SELECT id, label 
              FROM platform_features 
              WHERE id = ANY($1::text[])
            `, [enabledFeatures.rows.map((r: any) => r.feature_id)]);
            
            // Update features object
            enabledFeatures.rows.forEach((row: any) => {
              features.features[row.feature_id] = true;
            });
          }
        } catch (error) {
          // If registry tables don't exist yet, use JSONB only
          console.warn('Feature Registry not available, using JSONB:', error);
        }

        // Try to fetch from Limits Registry
        try {
          const planLimits = await db.query(`
            SELECT limit_key, limit_value 
            FROM subscription_plan_limits 
            WHERE plan_id = $1
          `, [plan.id]);

          if (planLimits.rows.length > 0) {
            // Merge registry limits into JSONB structure
            if (!features.limits) features.limits = {};
            
            planLimits.rows.forEach((row: any) => {
              // Map registry limit_key to JSONB structure
              const jsonbKeyMap: Record<string, string> = {
                'max_invoices_per_month': 'max_invoices_per_month',
                'max_customers': 'max_customers',
                'max_items': 'max_items',
                'max_users': 'max_users',
                'max_whatsapp_per_day': 'max_whatsapp_per_day',
              };
              
              const jsonbKey = jsonbKeyMap[row.limit_key] || row.limit_key;
              if (jsonbKey) {
                features.limits[jsonbKey] = row.limit_value;
              }
            });
          }
        } catch (error) {
          // If registry tables don't exist yet, use JSONB only
          console.warn('Limits Registry not available, using JSONB:', error);
        }

        return {
          ...plan,
          features
        };
      })
    );

    return NextResponse.json({ plans: plansWithRegistry });
  } catch (error: any) {
    console.error('Error fetching subscription plans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription plans', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/subscriptions/plans
 * Create or update a subscription plan (Admin only)
 */
export async function POST(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer', 'can_manage_plans');
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const {
      id,
      name,
      display_name,
      description,
      price_monthly,
      price_yearly,
      currency = 'INR',
      features,
      is_active = true,
      sort_order = 0
    } = body;

    // Basic validation
    if (!id || !name || !display_name || !features) {
      return NextResponse.json(
        { error: 'Missing required fields: id, name, display_name, features' },
        { status: 400 }
      );
    }

    // Upsert plan
    const plan = await db.queryOne(`
      INSERT INTO subscription_plans (
        id, name, display_name, description, 
        price_monthly, price_yearly, currency, 
        features, is_active, sort_order
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        price_monthly = EXCLUDED.price_monthly,
        price_yearly = EXCLUDED.price_yearly,
        currency = EXCLUDED.currency,
        features = EXCLUDED.features,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      id, name, display_name, description,
      price_monthly, price_yearly, currency,
      JSON.stringify(features), is_active, sort_order
    ]);

    // Clear all subscription caches since plan features changed
    clearAllSubscriptionCaches();

    return NextResponse.json({ plan }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating/updating subscription plan:', error);
    return NextResponse.json(
      { error: 'Failed to create/update plan', details: error.message },
      { status: 500 }
    );
  }
}

