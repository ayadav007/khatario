import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { queryOne, query } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import {
  getModuleSubscriptions,
  upsertModuleSubscription,
} from '@/lib/subscription/module-subscriptions';
import { getFreePlanIdForModule } from '@/lib/subscription/module-operational-check';

export const dynamic = 'force-dynamic';

/**
 * POST /api/subscriptions/ensure-subscription
 * Ensure the business's primary product has a subscription row (free plan if missing).
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const guard = await applySubscriptionMutationGuard(request, business_id);
    if (guard) return guard;

    const ctx = await getBusinessPlatformContext(business_id);
    const moduleKey = ctx.primaryModule;

    const rows = await getModuleSubscriptions(business_id, true);
    if (rows.some((r) => r.module_key === moduleKey)) {
      return NextResponse.json({
        success: true,
        message: 'Subscription already exists',
      });
    }

    const freePlanId = getFreePlanIdForModule(moduleKey);
    const freePlan = await queryOne(`SELECT id FROM subscription_plans WHERE id = $1`, [freePlanId]);

    if (!freePlan) {
      return NextResponse.json(
        {
          error: 'Free plan not found. Please run the seed script first.',
          requires_seed: true,
        },
        { status: 500 }
      );
    }

    const business = await queryOne(`SELECT id FROM businesses WHERE id = $1`, [business_id]);

    if (!business) {
      return NextResponse.json(
        { error: 'Business not found' },
        { status: 404 }
      );
    }

    await upsertModuleSubscription({ query }, business_id, moduleKey, freePlanId, 'active', null);
    clearSubscriptionCache(business_id);

    return NextResponse.json({
      success: true,
      subscription: { business_id, module_key: moduleKey, plan_id: freePlanId, status: 'active' },
      message: 'Free plan assigned successfully',
    });
  } catch (error: any) {
    console.error('Error ensuring subscription:', error);

    return NextResponse.json(
      { error: 'Failed to ensure subscription', details: error.message },
      { status: 500 }
    );
  }
}
