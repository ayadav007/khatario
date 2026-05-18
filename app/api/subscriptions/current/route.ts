import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { clearSubscriptionCache } from '@/lib/subscription';
import {
  getEffectivePlanId,
  shouldShowTrialBadge,
} from '@/lib/subscription/effective-plan';

/**
 * GET /api/subscriptions/current
 * Get the current subscription for a business
 * 
 * Requires: business_id in query params
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    const subscription = await db.queryOne(`
      SELECT 
        bs.id as subscription_id,
        bs.business_id,
        bs.plan_id,
        bs.status,
        bs.start_date,
        bs.end_date,
        bs.trial_end_date,
        bs.auto_renew,
        bs.cancel_at_period_end,
        bs.cancelled_at,
        bs.grace_period_end,
        bs.downgraded_from,
        bs.scheduled_plan_id,
        bs.billing_cycle,
        sp.id as plan_code,
        sp.name as plan_name,
        sp.display_name as plan_display_name,
        sp.description as plan_description,
        sp.price_monthly,
        sp.price_yearly,
        sp.currency,
        sp.features
      FROM business_subscriptions bs
      JOIN subscription_plans sp ON bs.plan_id = sp.id
      WHERE bs.business_id = $1
      ORDER BY
        CASE WHEN bs.status IN ('active', 'trial') THEN 0 ELSE 1 END,
        bs.created_at DESC
      LIMIT 1
    `, [businessId]);

    if (!subscription) {
      return NextResponse.json(
        { error: 'No subscription found' },
        { status: 404 }
      );
    }

    const now = new Date();
    const isOperational =
      subscription.status === 'active' || subscription.status === 'trial';
    let gracePeriodEnd: Date | null = null;
    let isGracePeriodActive = false;
    let graceDaysRemaining: number | null = null;

    if (subscription.grace_period_end) {
      gracePeriodEnd = new Date(subscription.grace_period_end);
      if (gracePeriodEnd > now) {
        isGracePeriodActive = true;
        graceDaysRemaining = Math.ceil(
          (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        );
      }
    }

    // Parse features if it's a string
    let features = typeof subscription.features === 'string' 
      ? JSON.parse(subscription.features) 
      : subscription.features || {};

    // MERGE LIMITS FROM REGISTRY (same logic as admin plans API)
    try {
      const planLimits = await db.query(`
        SELECT limit_key, limit_value 
        FROM subscription_plan_limits 
        WHERE plan_id = $1
      `, [subscription.plan_id]);

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
            'max_employees': 'max_employees',
            'max_attendance_records_per_month': 'max_attendance_records_per_month',
            'max_leave_requests_per_month': 'max_leave_requests_per_month',
            'max_payroll_records_per_month': 'max_payroll_records_per_month',
            'max_suppliers': 'max_suppliers',
            'max_purchases_per_month': 'max_purchases_per_month',
            'max_expenses_per_month': 'max_expenses_per_month',
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

    // Fetch enabled features from registry with labels and categories
    let enabledFeatures: { id: string; label: string; category: string; description: string | null }[] = [];
    try {
      const registryFeatures = await db.query(`
        SELECT pf.id, pf.label, pf.category, pf.description
        FROM subscription_plan_features spf
        JOIN platform_features pf ON spf.feature_id = pf.id
        WHERE spf.plan_id = $1 AND spf.enabled = true AND pf.is_active = true
        ORDER BY pf.category, pf.sort_order
      `, [subscription.plan_id]);
      enabledFeatures = registryFeatures.rows;
    } catch {
      // Registry tables may not exist yet
    }

    // Calculate remaining trial days if in trial
    let trialDaysRemaining = null;
    let isTrial = false;
    if (subscription.trial_end_date) {
      const trialEnd = new Date(subscription.trial_end_date);
      const today = new Date();
      if (trialEnd > today) {
        isTrial = true;
        trialDaysRemaining = Math.ceil((trialEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
      }
    } else if (subscription.status === 'trial') {
      isTrial = true;
    }

    const subForEffective = {
      plan_id: subscription.plan_id,
      status: subscription.status,
      trial_end_date: subscription.trial_end_date,
      end_date: subscription.end_date,
      grace_period_end: subscription.grace_period_end,
    };
    const effectivePlanId = getEffectivePlanId(subForEffective);
    let effectiveDisplayName = subscription.plan_display_name;
    if (effectivePlanId !== subscription.plan_id) {
      const effPlan = await db.queryOne<{ display_name: string }>(
        `SELECT display_name FROM subscription_plans WHERE id = $1`,
        [effectivePlanId],
      );
      effectiveDisplayName = effPlan?.display_name || 'Free / Starter';
    }

    return NextResponse.json({
      subscription: {
        ...subscription,
        features,
        enabled_features: enabledFeatures,
        is_trial: isTrial,
        trial_days_remaining: trialDaysRemaining,
        is_operational: isOperational,
        is_grace_period_active: isGracePeriodActive,
        grace_days_remaining: graceDaysRemaining,
        stored_plan_id: subscription.plan_id,
        effective_plan_id: effectivePlanId,
        effective_plan_display_name: effectiveDisplayName,
        show_trial_badge: shouldShowTrialBadge(subForEffective),
        plan_id: effectivePlanId,
        plan_display_name: effectiveDisplayName,
        plan: {
          code: effectivePlanId,
          name: effectivePlanId,
          display_name: effectiveDisplayName,
        },
      },
    });
  } catch (error: any) {
    console.error('Error fetching current subscription:', error);
    return NextResponse.json(
      { error: 'Failed to fetch subscription', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * POST /api/subscriptions/current
 * Update or create a subscription for a business
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const {
      plan_id,
      status = 'active',
      start_date,
      end_date,
      trial_end_date,
      auto_renew = true,
      payment_method,
      payment_reference
    } = body;

    if (!plan_id) {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }

    // Verify plan exists
    const plan = await db.queryOne(`
      SELECT id FROM subscription_plans WHERE id = $1
    `, [plan_id]);

    if (!plan) {
      return NextResponse.json(
        { error: 'Invalid plan_id' },
        { status: 400 }
      );
    }

    // Deactivate any existing in-good-standing subscription (active paid or trial)
    await db.query(`
      UPDATE business_subscriptions 
      SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
      WHERE business_id = $1 AND status IN ('active', 'trial')
    `, [business_id]);

    // Create new subscription
    const subscription = await db.queryOne(`
      INSERT INTO business_subscriptions (
        business_id, plan_id, status, start_date, end_date,
        trial_end_date, auto_renew, payment_method, payment_reference
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `, [
      business_id, plan_id, status,
      start_date || new Date().toISOString().split('T')[0],
      end_date,
      trial_end_date,
      auto_renew,
      payment_method,
      payment_reference
    ]);

    // Clear subscription cache so new/updated subscription is immediately available
    clearSubscriptionCache(business_id);

    return NextResponse.json({ subscription }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating subscription:', error);
    return NextResponse.json(
      { error: 'Failed to create subscription', details: error.message },
      { status: 500 }
    );
  }
}

