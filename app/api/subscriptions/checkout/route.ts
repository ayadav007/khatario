import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import {
  createSubscriptionCheckout,
  isPlatformRazorpayConfigured,
} from '@/lib/platform-subscription-checkout';
import { applyInstantPlanUpgradeWithCoupon } from '@/lib/subscription/apply-coupon-upgrade';
import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';
import { queryOne } from '@/lib/db';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';

/**
 * POST /api/subscriptions/checkout
 * Paid plan → Razorpay Payment Link. 100% coupon / free_months → instant upgrade.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const plan_id = body.plan_id as string | undefined;
    const billing_cycle =
      body.billing_cycle === 'yearly' ? 'yearly' : 'monthly';
    const coupon_code =
      typeof body.coupon_code === 'string' ? body.coupon_code.trim() : '';

    if (!plan_id) {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }

    if (plan_id === TRIAL_PLAN_ID) {
      return NextResponse.json(
        { error: 'Trial plan cannot be purchased', code: 'TRIAL_NOT_SELECTABLE' },
        { status: 400 },
      );
    }

    const plan = await queryOne<{
      display_name: string;
      price_monthly: string | number;
      price_yearly: string | number;
      is_active: boolean;
    }>(
      `SELECT display_name, price_monthly, price_yearly, is_active
       FROM subscription_plans WHERE id = $1`,
      [plan_id],
    );

    if (!plan?.is_active) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }

    let pricing;
    try {
      pricing = await resolveCheckoutPricing({
        businessId: tenant.businessId,
        planId: plan_id,
        billingCycle: billing_cycle,
        couponCode: coupon_code || null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid coupon';
      return NextResponse.json({ error: msg, code: 'INVALID_COUPON' }, { status: 400 });
    }

    if (pricing.baseAmount <= 0 && pricing.finalAmount <= 0) {
      return NextResponse.json(
        {
          error: 'This plan is free. Use the upgrade endpoint instead.',
          code: 'FREE_PLAN_USE_UPGRADE',
        },
        { status: 400 },
      );
    }

    if (pricing.finalAmount <= 0) {
      await applyInstantPlanUpgradeWithCoupon({
        businessId: tenant.businessId,
        planId: plan_id,
        planDisplayName: plan.display_name,
        billingCycle: billing_cycle,
        pricing,
        paymentMethod: 'coupon',
      });
      return NextResponse.json({
        success: true,
        mode: 'instant',
        message: `Upgraded to ${plan.display_name}`,
      });
    }

    if (!isPlatformRazorpayConfigured()) {
      return NextResponse.json(
        {
          error:
            'Online payments are not configured yet. Please contact support to upgrade.',
          code: 'PAYMENT_NOT_CONFIGURED',
        },
        { status: 503 },
      );
    }

    const checkout = await createSubscriptionCheckout({
      businessId: tenant.businessId,
      planId: plan_id,
      billingCycle: billing_cycle,
      couponCode: coupon_code || null,
    });

    return NextResponse.json({
      success: true,
      mode: 'redirect',
      ...checkout,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Checkout failed';
    console.error('Subscription checkout error:', error);

    if (message === 'PAYMENT_NOT_CONFIGURED') {
      return NextResponse.json(
        { error: 'Payments not configured', code: 'PAYMENT_NOT_CONFIGURED' },
        { status: 503 },
      );
    }

    if (message === 'FREE_PLAN_USE_UPGRADE') {
      return NextResponse.json(
        { error: 'Use upgrade for free plans', code: 'FREE_PLAN_USE_UPGRADE' },
        { status: 400 },
      );
    }

    return NextResponse.json(
      { error: 'Failed to start checkout', details: message },
      { status: 500 },
    );
  }
}
