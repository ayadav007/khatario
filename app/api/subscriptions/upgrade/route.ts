import { NextRequest, NextResponse } from 'next/server';
import { loadEffectivePlanPrices } from '@/lib/subscription/plan-terms';
import { query, queryOne } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { isPlatformPaymentConfigured } from '@/lib/platform-subscription-checkout';
import { recordUpgradeBilling } from '@/lib/platform-billing';
import { notifyAdminsSubscriptionChange } from '@/lib/platform-email';
import { getBusinessPlatformRecipient } from '@/lib/platform-email';
import { BILLING_CYCLES, computePlanAmount } from '@/lib/subscription/apply-plan-change';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';
import { normalizePlatformModule, type PlatformModule } from '@/lib/platform-modules';
import { clearSubscriptionCache } from '@/lib/subscription';
import { enableBusinessModule } from '@/lib/business-modules';
import { getModuleSubscription, upsertModuleSubscription } from '@/lib/subscription/module-subscriptions';
import { moveModuleSubscriptionToFree } from '@/lib/subscription/module-plan-lifecycle';
import { decideZeroPriceChange } from '@/lib/subscription/zero-price-change';
import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';
import { planOpenToBusiness } from '@/lib/subscription/public-plans';
import { PLAN_NOT_ON_SALE_MESSAGE } from '@/lib/subscription/plan-offer-rules';

export const dynamic = 'force-dynamic';

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

    const guard = await applySubscriptionMutationGuard(request, business_id);
    if (guard) return guard;

    const {
      plan_id,
      module_key: moduleKeyBody,
      payment_method = 'manual',
      payment_reference,
    } = body;

    if (!plan_id) {
      return NextResponse.json({ error: 'plan_id is required' }, { status: 400 });
    }

    const plan = await queryOne<{
      id: string;
      display_name: string;
      price_monthly: number | string;
      price_yearly: number | string;
      price_3year: number | string | null;
      product_line: string | null;
    }>(
      `SELECT id, display_name, price_monthly, price_yearly, price_3year, product_line
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

    // Any priced cycle makes this a paid plan; an unpriced cycle must not become a free upgrade.
    const amount = Math.max(
      ...BILLING_CYCLES.map((c) => computePlanAmount(plan, c)),
    );
    const cycle = 'monthly' as const;

    if (amount > 0) {
      // A priced plan that is not on sale can only be renewed by a business already on it (through checkout).
      if (!(await planOpenToBusiness(business_id, plan_id))) {
        return NextResponse.json(
          { error: PLAN_NOT_ON_SALE_MESSAGE, code: 'PLAN_NOT_OFFERED' },
          { status: 400 },
        );
      }
      if (await isPlatformPaymentConfigured()) {
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

    const moduleKey: PlatformModule =
      normalizePlatformModule(moduleKeyBody) ?? (await resolveModuleKeyForPlan(plan_id));

    const current = await getModuleSubscription(business_id, moduleKey, true);
    // The prices the business itself pays for its current plan (its older-terms snapshot when pinned).
    const currentPlan = current ? await loadEffectivePlanPrices(business_id, current.plan_id) : null;
    const currentPlanIsPaid =
      !!currentPlan &&
      BILLING_CYCLES.some((c) => computePlanAmount(currentPlan, c) > 0);

    // The trial counts as used when the row is on it, came down from it, carries a trial end date,
    // or the business's event history names it. A free-tier row alone (signup's hr_free) is not use.
    const trialPlanId = moduleKey === 'crm' ? undefined : MODULE_ADD_CONFIG[moduleKey]?.trialPlanId;
    let trialAlreadyUsed = false;
    if (trialPlanId && plan_id === trialPlanId) {
      const history = await queryOne<{ used: boolean }>(
        `SELECT (
           EXISTS (
             SELECT 1 FROM business_module_subscriptions
             WHERE business_id = $1 AND module_key = $2
               AND (plan_id = $3 OR downgraded_from = $3 OR trial_end_date IS NOT NULL)
           )
           OR EXISTS (
             SELECT 1 FROM subscription_events
             WHERE business_id = $1 AND (from_plan_id = $3 OR to_plan_id = $3)
           )
         ) AS used`,
        [business_id, moduleKey, trialPlanId],
      );
      trialAlreadyUsed = history?.used === true;
    }

    const decision = decideZeroPriceChange({
      moduleKey,
      targetPlanId: plan_id,
      current: current
        ? {
            plan_id: current.plan_id,
            status: current.status,
            trial_end_date: current.trial_end_date,
          }
        : null,
      currentPlanIsPaid,
      trialAlreadyUsed,
    });

    if (decision.action === 'reject') {
      return NextResponse.json(
        { error: decision.message, code: decision.code },
        { status: 409 },
      );
    }

    if (decision.action === 'apply_free') {
      if (current) {
        await moveModuleSubscriptionToFree(business_id, moduleKey, current.plan_id, 'downgraded');
      } else {
        await upsertModuleSubscription({ query }, business_id, moduleKey, plan_id, 'active', null);
      }
    } else {
      await upsertModuleSubscription(
        { query },
        business_id,
        moduleKey,
        plan_id,
        'trial',
        decision.trialDays,
      );
    }
    await enableBusinessModule(business_id, moduleKey, 'upgrade');
    clearSubscriptionCache(business_id);
    const subscription = await getModuleSubscription(business_id, moduleKey, true);

    void (async () => {
      try {
        await recordUpgradeBilling({
          businessId: business_id,
          planId: plan_id,
          planDisplayName: plan.display_name,
          moduleKey,
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
