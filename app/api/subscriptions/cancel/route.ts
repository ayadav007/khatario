import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { cancelSubscription } from '@/lib/subscription/lifecycle';
import { cancelModuleSubscription } from '@/lib/subscription/module-plan-lifecycle';
import { normalizePlatformModule, PLATFORM_MODULE_LABELS } from '@/lib/platform-modules';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const guard = await applySubscriptionMutationGuard(request, tenant.businessId);
    if (guard) return guard;

    const { reason } = body;
    const moduleKey = normalizePlatformModule(body.module_key);

    if (moduleKey) {
      const result = await cancelModuleSubscription(tenant.businessId, moduleKey, reason);
      return NextResponse.json({
        success: true,
        module_key: moduleKey,
        message: `${PLATFORM_MODULE_LABELS[moduleKey]} cancellation scheduled at end of billing period.`,
        end_date: result.end_date,
      });
    }

    const subscription = await cancelSubscription(tenant.businessId, reason);

    return NextResponse.json({
      success: true,
      message: 'Subscription cancellation scheduled at end of billing period',
      subscription,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('Error cancelling subscription:', error);

    if (message.includes('No active subscription') || message.includes('already scheduled')) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    return NextResponse.json(
      { error: 'Failed to cancel subscription', details: message },
      { status: 500 },
    );
  }
}
