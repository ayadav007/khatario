import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  getBusinessPlatformContext,
  setPrimaryBusinessModule,
} from '@/lib/business-modules';
import { normalizePlatformModule, PLATFORM_MODULE_LABELS } from '@/lib/platform-modules';
import { clearSubscriptionCache } from '@/lib/subscription';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';

export const dynamic = 'force-dynamic';

/**
 * PATCH /api/modules/primary — set default home / legacy subscription sync module.
 * Body: { module_key: 'billing' | 'hr' | 'connect' }
 */
export async function PATCH(request: NextRequest) {
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

    const ctx = await setPrimaryBusinessModule(tenant.businessId, moduleKey);
    clearSubscriptionCache(tenant.businessId);

    return NextResponse.json({
      success: true,
      primary_module: ctx.primaryModule,
      default_home_path: ctx.defaultHomePath,
      message: `${PLATFORM_MODULE_LABELS[moduleKey]} is now your primary product.`,
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PATCH /api/modules/primary]', error);
    return NextResponse.json({ error: message || 'Failed to update primary product' }, { status: 400 });
  }
}

export async function GET(request: NextRequest) {
  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;
    const ctx = await getBusinessPlatformContext(tenant.businessId);
    return NextResponse.json({
      primary_module: ctx.primaryModule,
      default_home_path: ctx.defaultHomePath,
      enabled_modules: ctx.enabledModules,
    });
  } catch (error) {
    console.error('[GET /api/modules/primary]', error);
    return NextResponse.json({ error: 'Failed to load primary product' }, { status: 500 });
  }
}
