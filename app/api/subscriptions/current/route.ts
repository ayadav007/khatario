import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { clearSubscriptionCache } from '@/lib/subscription';
import {
  getDisplayPlanId,
  getEntitlementPlanId,
  isPaidGracePeriodActive,
  shouldShowTrialBadge,
} from '@/lib/subscription/effective-plan';
import { moveSubscriptionToFree } from '@/lib/subscription/lifecycle';
import {
  shouldDowngradeStaleTrial,
  shouldOfferTrialExtension,
  TRIAL_EXTENSION_DAYS,
} from '@/lib/subscription/trial-extension';

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
        bs.trial_extension_granted,
        bs.trial_extension_declined_at,
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

    const subForEffective = {
      plan_id: subscription.plan_id,
      status: subscription.status,
      trial_end_date: subscription.trial_end_date,
      end_date: subscription.end_date,
      grace_period_end: subscription.grace_period_end,
    };

    const trialExtensionSub = {
      plan_id: subscription.plan_id,
      trial_end_date: subscription.trial_end_date,
      trial_extension_granted: subscription.trial_extension_granted,
      trial_extension_declined_at: subscription.trial_extension_declined_at,
    };

    if (shouldDowngradeStaleTrial(trialExtensionSub)) {
      await moveSubscriptionToFree(
        businessId,
        subscription.plan_id,
        'trial_expired_sync',
      );
      const refreshed = await db.queryOne(`
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
          bs.trial_extension_granted,
          bs.trial_extension_declined_at,
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
      if (refreshed) {
        Object.assign(subscription, refreshed);
        Object.assign(subForEffective, {
          plan_id: refreshed.plan_id,
          status: refreshed.status,
          trial_end_date: refreshed.trial_end_date,
          end_date: refreshed.end_date,
          grace_period_end: refreshed.grace_period_end,
        });
        Object.assign(trialExtensionSub, {
          plan_id: refreshed.plan_id,
          trial_end_date: refreshed.trial_end_date,
          trial_extension_granted: refreshed.trial_extension_granted,
          trial_extension_declined_at: refreshed.trial_extension_declined_at,
        });
      }
    }

    const displayPlanId = getDisplayPlanId(subForEffective);
    const entitlementPlanId = getEntitlementPlanId(subForEffective);
    const limitsPlanId = displayPlanId;
    const showTrialExtensionModal = shouldOfferTrialExtension(trialExtensionSub);

    const now = new Date();
    const isOperational =
      subscription.status === 'active' ||
      subscription.status === 'trial' ||
      entitlementPlanId !== 'free';
    let gracePeriodEnd: Date | null = null;
    let isGracePeriodActive = false;
    let graceDaysRemaining: number | null = null;

    if (isPaidGracePeriodActive(subForEffective) && subscription.grace_period_end) {
      gracePeriodEnd = new Date(subscription.grace_period_end);
      isGracePeriodActive = true;
      graceDaysRemaining = Math.ceil(
        (gracePeriodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
    }

    let planRow = subscription;
    if (limitsPlanId !== subscription.plan_id) {
      const displayPlan = await db.queryOne(`
        SELECT 
          sp.id as plan_code,
          sp.name as plan_name,
          sp.display_name as plan_display_name,
          sp.description as plan_description,
          sp.price_monthly,
          sp.price_yearly,
          sp.currency,
          sp.features
        FROM subscription_plans sp
        WHERE sp.id = $1
      `, [limitsPlanId]);
      if (displayPlan) {
        planRow = { ...subscription, ...displayPlan };
      }
    }

    let features =
      typeof planRow.features === 'string'
        ? JSON.parse(planRow.features)
        : planRow.features || {};

    try {
      const planLimits = await db.query(
        `SELECT limit_key, limit_value 
         FROM subscription_plan_limits 
         WHERE plan_id = $1`,
        [limitsPlanId],
      );

      if (planLimits.rows.length > 0) {
        if (!features.limits) features.limits = {};

        planLimits.rows.forEach((row: { limit_key: string; limit_value: number }) => {
          const jsonbKeyMap: Record<string, string> = {
            max_invoices_per_month: 'max_invoices_per_month',
            max_customers: 'max_customers',
            max_items: 'max_items',
            max_users: 'max_users',
            max_whatsapp_per_day: 'max_whatsapp_per_day',
            max_employees: 'max_employees',
            max_attendance_records_per_month: 'max_attendance_records_per_month',
            max_leave_requests_per_month: 'max_leave_requests_per_month',
            max_payroll_records_per_month: 'max_payroll_records_per_month',
            max_suppliers: 'max_suppliers',
            max_purchases_per_month: 'max_purchases_per_month',
            max_expenses_per_month: 'max_expenses_per_month',
          };

          const jsonbKey = jsonbKeyMap[row.limit_key] || row.limit_key;
          if (jsonbKey) {
            features.limits[jsonbKey] = row.limit_value;
          }
        });
      }
    } catch (error) {
      console.warn('Limits Registry not available, using JSONB:', error);
    }

    let enabledFeatures: {
      id: string;
      label: string;
      category: string;
      description: string | null;
    }[] = [];
    try {
      const registryFeatures = await db.query(
        `SELECT pf.id, pf.label, pf.category, pf.description
         FROM subscription_plan_features spf
         JOIN platform_features pf ON spf.feature_id = pf.id
         WHERE spf.plan_id = $1 AND spf.enabled = true AND pf.is_active = true
         ORDER BY pf.category, pf.sort_order`,
        [limitsPlanId],
      );
      enabledFeatures = registryFeatures.rows;
    } catch {
      // Registry tables may not exist yet
    }

    let trialDaysRemaining = null;
    let isTrial = false;
    if (subscription.trial_end_date) {
      const trialEnd = new Date(subscription.trial_end_date);
      const today = new Date();
      if (trialEnd > today) {
        isTrial = true;
        trialDaysRemaining = Math.ceil(
          (trialEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
        );
      }
    } else if (subscription.status === 'trial' && displayPlanId === 'trial') {
      isTrial = true;
    }

    const displayName =
      planRow.plan_display_name || (displayPlanId === 'free' ? 'Free / Starter' : displayPlanId);

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
        entitlement_plan_id: entitlementPlanId,
        effective_plan_id: displayPlanId,
        effective_plan_display_name: displayName,
        show_trial_badge: shouldShowTrialBadge(subForEffective),
        show_trial_extension_modal: showTrialExtensionModal,
        trial_extension_days: TRIAL_EXTENSION_DAYS,
        plan_id: displayPlanId,
        plan_display_name: displayName,
        plan_description: planRow.plan_description,
        price_monthly: planRow.price_monthly,
        price_yearly: planRow.price_yearly,
        currency: planRow.currency,
        plan: {
          code: displayPlanId,
          name: displayPlanId,
          display_name: displayName,
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

