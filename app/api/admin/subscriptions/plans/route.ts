import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { clearAllSubscriptionCaches } from '@/lib/subscription';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { listActiveSubscriptionPlans } from '@/lib/subscription/list-plans';
import { scheduleKbReindex } from '@/lib/rag/queue';
import { PRICE_KEYS, loadPlanPricesPaise, parsePriceEdit } from '@/lib/admin-plan-edit';

export const dynamic = 'force-dynamic';

/**
 * GET /api/admin/subscriptions/plans
 * Public callers (marketing, upgrade UI) receive active plans only.
 * A signed-in platform admin also receives inactive plans, so they can be
 * found and turned back on from Admin → Plans.
 * POST requires platform admin.
 */
export async function GET(request: NextRequest) {
  try {
    const auth = await requirePlatformRequest(request, 'viewer');
    const plansWithRegistry = await listActiveSubscriptionPlans({
      includeInactive: auth.ok,
    });
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
      price_3year = 0,
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

    // Prices are the owner's "everyone now / only new customers" decision: an existing plan's prices change only
    // through POST /api/admin/plans/[planId]/prices (choice, confirmation and log). This route refuses a price that
    // differs from the stored one and never writes prices on an existing plan. A new plan takes the same price rules.
    const sentPaise = {
      price_monthly: Math.round((Number(price_monthly) || 0) * 100),
      price_yearly: Math.round((Number(price_yearly) || 0) * 100),
      price_3year: Math.round((Math.max(0, Number(price_3year) || 0)) * 100),
    };
    const existingPrices = await loadPlanPricesPaise(String(id));
    if (existingPrices) {
      const differs = PRICE_KEYS.some((k) => existingPrices[k] !== sentPaise[k]);
      if (differs) {
        return NextResponse.json(
          {
            error:
              'Prices of an existing plan are changed from the plan\'s price screen, where you choose whether current customers get the new price. Nothing was saved.',
            code: 'USE_PRICE_ROUTE',
          },
          { status: 409 },
        );
      }
    } else {
      const parsed = parsePriceEdit(sentPaise);
      if (!parsed.ok) return NextResponse.json({ error: parsed.message, code: 'INVALID_PRICE' }, { status: 400 });
      if (sentPaise.price_monthly === 0 && (sentPaise.price_yearly > 0 || sentPaise.price_3year > 0)) {
        return NextResponse.json(
          { error: 'The monthly price cannot be 0 while the yearly or three-year price is set.', code: 'INVALID_PRICE' },
          { status: 400 },
        );
      }
    }

    // Upsert plan
    const plan = await db.queryOne(`
      INSERT INTO subscription_plans (
        id, name, display_name, description, 
        price_monthly, price_yearly, currency, 
        features, is_active, sort_order, price_3year
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        display_name = EXCLUDED.display_name,
        description = EXCLUDED.description,
        currency = EXCLUDED.currency,
        features = EXCLUDED.features,
        is_active = EXCLUDED.is_active,
        sort_order = EXCLUDED.sort_order,
        updated_at = CURRENT_TIMESTAMP
      RETURNING *
    `, [
      id, name, display_name, description,
      price_monthly, price_yearly, currency,
      JSON.stringify(features), is_active, sort_order,
      Math.max(0, Number(price_3year) || 0),
    ]);

    // Clear all subscription caches since plan features changed
    clearAllSubscriptionCaches();
    scheduleKbReindex({ target: 'plans', reason: 'plan_saved' });

    return NextResponse.json({ plan }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating/updating subscription plan:', error);
    return NextResponse.json(
      { error: 'Failed to create/update plan', details: error.message },
      { status: 500 }
    );
  }
}

