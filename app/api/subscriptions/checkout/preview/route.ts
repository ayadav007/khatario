import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';
import { queryOne } from '@/lib/db';
import { TRIAL_PLAN_ID } from '@/lib/subscription/trial-plan';
import { normalizeBillingCycle } from '@/lib/subscription/apply-plan-change';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { planOpenToBusiness } from '@/lib/subscription/public-plans';
import { PLAN_NOT_ON_SALE_MESSAGE } from '@/lib/subscription/plan-offer-rules';
import { planHasPaidPrice, resolveNewPeriod, type CurrentPeriodRow } from '@/lib/subscription/period';

export const dynamic = 'force-dynamic';

/**
 * GET /api/subscriptions/checkout/preview?plan_id=&billing_cycle=&coupon_code=
 * What checkout would charge, and the period it would buy, without creating anything or calling a
 * gateway. Same session, owner guard and business resolution as POST /api/subscriptions/checkout; the
 * product comes from the plan; the amounts come from the same `resolveCheckoutPricing` checkout uses.
 */
export async function GET(request: NextRequest) {
  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;

    const guard = await applySubscriptionMutationGuard(request, tenant.businessId);
    if (guard) return guard;

    const params = request.nextUrl.searchParams;
    const planId = params.get('plan_id') || undefined;
    const billingCycle = normalizeBillingCycle(params.get('billing_cycle'));
    const couponCode = (params.get('coupon_code') ?? '').trim();

    if (!planId) {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }
    if (planId === TRIAL_PLAN_ID) {
      return NextResponse.json(
        { error: 'Trial plan cannot be purchased', code: 'TRIAL_NOT_SELECTABLE' },
        { status: 400 },
      );
    }

    const plan = await queryOne<{ is_active: boolean }>(
      `SELECT is_active FROM subscription_plans WHERE id = $1`,
      [planId],
    );
    if (!plan?.is_active) {
      return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });
    }
    if (!(await planOpenToBusiness(tenant.businessId, planId))) {
      return NextResponse.json(
        { error: PLAN_NOT_ON_SALE_MESSAGE, code: 'PLAN_NOT_OFFERED' },
        { status: 400 },
      );
    }

    let pricing;
    try {
      pricing = await resolveCheckoutPricing({
        businessId: tenant.businessId,
        planId,
        billingCycle,
        couponCode: couponCode || null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid coupon';
      return NextResponse.json({ error: msg, code: 'INVALID_COUPON' }, { status: 400 });
    }

    // The period this plan and cycle would buy right now (the same function the payment uses).
    const moduleKey = await resolveModuleKeyForPlan(planId);
    const current = await queryOne<CurrentPeriodRow>(
      `SELECT plan_id, status, start_date::text, end_date::text, trial_end_date::text
       FROM business_module_subscriptions
       WHERE business_id = $1 AND module_key = $2`,
      [tenant.businessId, moduleKey],
    );
    const period = await resolveNewPeriod({
      current,
      targetPlanId: planId,
      billingCycle,
      currentPlanIsPaid: current ? await planHasPaidPrice(current.plan_id, undefined, tenant.businessId) : false,
    });

    return NextResponse.json({
      plan_id: planId,
      billing_cycle: billingCycle,
      period_kind: period.kind === 'renewal' ? 'renewal' : 'change',
      period_start: period.startDate,
      period_end: period.endDate,
      credit_unused: pricing.creditUnused,
      free_months: pricing.freeMonths ?? 0,
      breakdown: {
        listPrice: pricing.baseAmount,
        couponDiscount: pricing.discountAmount,
        couponCapped: pricing.couponCapped === true,
        creditApplied: pricing.creditApplied,
        creditUnused: pricing.creditUnused,
        creditAvailable: pricing.creditAvailable,
        taxMode: pricing.tax.breakdown.mode,
        taxRatePercent: pricing.tax.breakdown.ratePercent,
        taxableAmount: pricing.taxableAmount,
        taxAmount: pricing.taxAmount,
        amountToPay: pricing.finalAmount,
      },
    });
  } catch (error: unknown) {
    console.error('Subscription checkout preview error:', error);
    return NextResponse.json({ error: 'Failed to load the price preview' }, { status: 500 });
  }
}
