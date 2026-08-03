import { NextRequest, NextResponse } from 'next/server';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { downgradeModuleSubscription } from '@/lib/subscription/module-plan-lifecycle';
import { downgradeSubscription } from '@/lib/subscription/lifecycle';
import { normalizePlatformModule, type PlatformModule } from '@/lib/platform-modules';
import { resolveModuleKeyForPlan } from '@/lib/subscription/plan-module';

export const dynamic = 'force-dynamic';

function isDowngradeClientError(message: string | undefined): boolean {
  if (!message) return false;
  return [
    'No active subscription',
    'not found or inactive',
    'not a lower tier',
    'Trial cannot be selected',
    'belongs to',
    'Choose a plan for the correct product',
  ].some((fragment) => message.includes(fragment));
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;
    const business_id = tenant.businessId;

    const guard = await applySubscriptionMutationGuard(request, business_id);
    if (guard) return guard;

    const { target_plan_id, confirmed, module_key: moduleKeyBody } = body;

    if (!target_plan_id) {
      return NextResponse.json(
        { error: 'target_plan_id is required' },
        { status: 400 }
      );
    }

    const moduleKey: PlatformModule | null =
      normalizePlatformModule(moduleKeyBody) ??
      (await resolveModuleKeyForPlan(target_plan_id));

    const runDowngrade = async () => {
      if (moduleKey) {
        try {
          return await downgradeModuleSubscription(
            business_id,
            moduleKey,
            target_plan_id,
            { confirmed: !!confirmed },
          );
        } catch (moduleErr) {
          if (
            moduleErr instanceof Error &&
            isDowngradeClientError(moduleErr.message)
          ) {
            throw moduleErr;
          }
          console.warn('[downgrade] module path failed, legacy fallback:', moduleErr);
        }
      }
      return downgradeSubscription(business_id, target_plan_id, {
        confirmed: !!confirmed,
      });
    };

    if (!confirmed) {
      const result = await runDowngrade();
      return NextResponse.json({
        success: true,
        confirmed: false,
        warnings: result.dataImpact,
        scheduled_date: result.scheduled_date,
      });
    }

    const result = await runDowngrade();

    return NextResponse.json({
      success: true,
      confirmed: true,
      scheduled_date: result.scheduled_date,
      dataImpact: result.dataImpact,
      subscription: 'subscription' in result ? result.subscription : undefined,
      message: result.scheduled_date
        ? `Downgrade scheduled for ${result.scheduled_date}. You'll keep your current plan until then.`
        : 'Downgrade scheduled successfully.',
    });
  } catch (error: any) {
    console.error('Error downgrading subscription:', error);

    if (isDowngradeClientError(error.message)) {
      return NextResponse.json(
        { error: error.message },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: 'Failed to downgrade subscription', details: error.message },
      { status: 500 }
    );
  }
}
