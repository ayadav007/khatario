import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { disableBusinessModule } from '@/lib/business-modules';
import { normalizePlatformModule, PLATFORM_MODULE_LABELS } from '@/lib/platform-modules';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';

export const dynamic = 'force-dynamic';

/**
 * POST /api/modules/disable — turn off a product module (requires another enabled product).
 * Body: { module_key: 'billing' | 'hr' | 'connect' }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const tenant = requireTenantBusinessId(request, body.business_id);
    if (!tenant.ok) return tenant.response;

    const userId = getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const mutationGuard = await applySubscriptionMutationGuard(request, tenant.businessId);
    if (mutationGuard) return mutationGuard;

    const moduleKey = normalizePlatformModule(body.module_key);
    if (!moduleKey || moduleKey === 'crm') {
      return NextResponse.json({ error: 'Invalid module_key' }, { status: 400 });
    }

    try {
      await authorize(userId, 'settings', 'update', { businessId: tenant.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const ctx = await disableBusinessModule(tenant.businessId, moduleKey);

    return NextResponse.json({
      success: true,
      disabled_module: moduleKey,
      primary_module: ctx.primaryModule,
      default_home_path: ctx.defaultHomePath,
      enabled_modules: ctx.enabledModules,
      message: `${PLATFORM_MODULE_LABELS[moduleKey]} has been disabled.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[POST /api/modules/disable]', error);
    return NextResponse.json({ error: message || 'Failed to disable product' }, { status: 400 });
  }
}
