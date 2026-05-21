import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { listActiveSubscriptionPlans } from '@/lib/subscription/list-plans';

/**
 * GET /api/admin/subscriptions/plans
 * Fetch all subscription plans
 *
 * Public read (marketing landing, upgrade UI). POST requires platform admin.
 */
export async function GET(_request: NextRequest) {
  try {
    const plansWithRegistry = await listActiveSubscriptionPlans();
    return NextResponse.json({ plans: plansWithRegistry });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error fetching subscription plans:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription plans', details: message },
      { status: 500 },
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

