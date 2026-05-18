import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { isPlatformRazorpayConfigured } from '@/lib/platform-subscription-checkout';
import { recordUpgradeBilling } from '@/lib/platform-billing';
import { notifyAdminsSubscriptionChange } from '@/lib/platform-email';
import { getBusinessPlatformRecipient } from '@/lib/platform-email';
import {
  applySubscriptionPlanChange,
  computePlanAmount,
} from '@/lib/subscription/apply-plan-change';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';

/**
 * POST /api/subscriptions/upgrade
 * Instant upgrade for free / ₹0 plans only. Paid plans use POST /api/subscriptions/checkout.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const {
      plan_id,
      billing_cycle = 'monthly',
      payment_method = 'manual',
      payment_reference,
    } = body;

    if (!plan_id) {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }

    if (plan_id === TRIAL_PLAN_ID) {
      return NextResponse.json(
        {
          error:
            'The Trial plan is assigned when you create your account. Choose Free or a paid plan to change your subscription.',
          code: 'TRIAL_NOT_SELECTABLE',
        },
        { status: 400 },
      );
    }

    const plan = await queryOne<{
      id: string;
      display_name: string;
      price_monthly: number | string;
      price_yearly: number | string;
    }>(
      `SELECT id, display_name, price_monthly, price_yearly
       FROM subscription_plans
       WHERE id = $1 AND is_active = true`,
      [plan_id],
    );

    if (!plan) {
      return NextResponse.json(
        { error: 'Invalid plan_id or plan is not active' },
        { status: 400 },
      );
    }

    const business = await queryOne(`SELECT id FROM businesses WHERE id = $1`, [
      business_id,
    ]);
    if (!business) {
      return NextResponse.json({ error: 'Business not found' }, { status: 404 });
    }

    const cycle = billing_cycle === 'yearly' ? 'yearly' : 'monthly';
    const amount = computePlanAmount(plan, cycle);

    if (amount > 0) {
      if (isPlatformRazorpayConfigured()) {
        return NextResponse.json(
          {
            error: 'This plan requires payment. Start checkout to continue.',
            code: 'REQUIRES_CHECKOUT',
            amount,
          },
          { status: 402 },
        );
      }
      return NextResponse.json(
        {
          error:
            'Online payments are not configured. Please contact support to upgrade.',
          code: 'PAYMENT_NOT_CONFIGURED',
        },
        { status: 503 },
      );
    }

    const subscription = await applySubscriptionPlanChange({
      businessId: business_id,
      planId: plan_id,
      billingCycle: cycle,
      paymentMethod: payment_method,
      paymentReference: payment_reference,
    });

    void (async () => {
      try {
        await recordUpgradeBilling({
          businessId: business_id,
          subscriptionId: subscription.subscription_id,
          planId: plan_id,
          planDisplayName: plan.display_name,
          amount: 0,
          billingCycle: cycle,
          paymentMethod: payment_method,
          paymentReference: payment_reference,
          paymentStatus: 'completed',
        });
        const recipient = await getBusinessPlatformRecipient(business_id);
        await notifyAdminsSubscriptionChange({
          businessId: business_id,
          businessName: recipient?.businessName || business_id,
          planDisplayName: plan.display_name,
          event: 'upgraded',
        });
      } catch (emailErr) {
        console.error('Subscription upgrade billing/emails failed:', emailErr);
      }
    })();

    return NextResponse.json({
      success: true,
      subscription,
      message: `Successfully upgraded to ${plan.display_name} plan`,
    });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };
    console.error('Error upgrading subscription:', error);

    if (err.code === '23505') {
      return NextResponse.json(
        { error: 'Subscription already exists for this business' },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        error: 'Failed to upgrade subscription',
        details: err.message || 'Unknown error',
      },
      { status: 500 },
    );
  }
}
