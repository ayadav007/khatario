import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { cancelModuleScheduledDowngrade } from '@/lib/subscription/module-plan-lifecycle';
import { cancelScheduledDowngrade } from '@/lib/subscription/lifecycle';
import { normalizePlatformModule } from '@/lib/platform-modules';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const guard = await applySubscriptionMutationGuard(request, tenant.businessId);
    if (guard) return guard;

    const moduleKey = normalizePlatformModule(body.module_key);

    if (moduleKey) {
      try {
        await cancelModuleScheduledDowngrade(tenant.businessId, moduleKey);
        return NextResponse.json({
          success: true,
          message: 'Scheduled downgrade has been cancelled',
        });
      } catch (moduleErr) {
        console.warn('[cancel-downgrade] module path:', moduleErr);
      }
    }

    const subscription = await cancelScheduledDowngrade(tenant.businessId);

    return NextResponse.json({
      success: true,
      message: 'Scheduled downgrade has been cancelled',
      subscription,
    });
  } catch (error: any) {
    console.error('Error cancelling scheduled downgrade:', error);

    if (
      error.message?.includes('No active subscription') ||
      error.message?.includes('No scheduled downgrade')
    ) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to cancel scheduled downgrade', details: error.message },
      { status: 500 }
    );
  }
}
