import { NextRequest, NextResponse } from 'next/server';

import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';

import { getBusinessPlatformContext } from '@/lib/business-modules';

import {

  getModuleSubscriptions,

} from '@/lib/subscription/module-subscriptions';

import { MODULE_ADD_CONFIG } from '@/lib/subscription/module-entitlements';

import {

  PLATFORM_MODULE_LABELS,

  normalizePlatformModule,

} from '@/lib/platform-modules';

import { authorize, AuthorizationError } from '@/lib/authorization';

import {

  getModuleAddPlanId,

  MODULE_REQUIRES_CHECKOUT_CODE,

} from '@/lib/subscription/module-add-flow';

import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';



export const dynamic = 'force-dynamic';



/**

 * GET /api/modules — enabled products + subscription status per module.

 */

export async function GET(request: NextRequest) {

  try {

    const tenant = requireTenantBusinessId(request);

    if (!tenant.ok) return tenant.response;

    const businessId = tenant.businessId;

    const userId = getUserIdFromRequest(request);



    if (!userId) {

      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    }



    try {

      await authorize(userId, 'settings', 'read', { businessId });

    } catch (error) {

      if (error instanceof AuthorizationError) return error.toNextResponse();

      throw error;

    }



    const [ctx, subs] = await Promise.all([

      getBusinessPlatformContext(businessId),

      getModuleSubscriptions(businessId, true),

    ]);



    const subByModule = new Map(subs.map((s) => [s.module_key, s]));



    const modules = (['billing', 'hr', 'connect'] as const).map((key) => {

      const enabled = ctx.enabledModules.includes(key);

      const sub = subByModule.get(key);

      const catalog = MODULE_ADD_CONFIG[key];

      return {

        module_key: key,

        label: PLATFORM_MODULE_LABELS[key],

        description: catalog.description,

        enabled,

        is_primary: ctx.primaryModule === key,

        subscription: sub

          ? {

              plan_id: sub.plan_id,

              plan_display_name: sub.plan_display_name ?? sub.plan_id,

              status: sub.status,

              trial_end_date: sub.trial_end_date,

            }

          : null,

        can_add: !enabled,

        add_plan_id: getModuleAddPlanId(key),

      };

    });



    return NextResponse.json({

      primary_module: ctx.primaryModule,

      default_home_path: ctx.defaultHomePath,

      modules,

    });

  } catch (error) {

    console.error('[GET /api/modules]', error);

    return NextResponse.json({ error: 'Failed to load products' }, { status: 500 });

  }

}



/**

 * POST /api/modules — **disabled for direct enablement.**

 * Module activation requires subscription checkout (or signup seeding).

 * Use POST /api/subscriptions/checkout or /api/subscriptions/upgrade instead.

 */

export async function POST(request: NextRequest) {

  try {

    const body = await request.json();

    const tenant = requireTenantBusinessId(request, body.business_id);

    if (!tenant.ok) return tenant.response;

    const businessId = tenant.businessId;

    const userId = getUserIdFromRequest(request);



    if (!userId) {

      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    }

    const mutationGuard = await applySubscriptionMutationGuard(request, businessId);
    if (mutationGuard) return mutationGuard;

    const moduleKey = normalizePlatformModule(body.module_key);



    if (!moduleKey || moduleKey === 'crm') {

      return NextResponse.json({ error: 'Invalid module_key' }, { status: 400 });

    }



    try {

      await authorize(userId, 'settings', 'create', { businessId });

    } catch (error) {

      if (error instanceof AuthorizationError) return error.toNextResponse();

      throw error;

    }



    const ctx = await getBusinessPlatformContext(businessId);

    if (ctx.enabledModules.includes(moduleKey)) {

      return NextResponse.json(

        { error: `${PLATFORM_MODULE_LABELS[moduleKey]} is already enabled.` },

        { status: 409 },

      );

    }



    const planId = getModuleAddPlanId(moduleKey);

    if (!planId) {

      return NextResponse.json({ error: 'Module not available yet.' }, { status: 400 });

    }



    return NextResponse.json(

      {

        error:

          'Adding a product requires subscription checkout. Use the checkout or upgrade API with a valid plan.',

        code: MODULE_REQUIRES_CHECKOUT_CODE,

        module_key: moduleKey,

        plan_id: planId,

        checkout_endpoint: '/api/subscriptions/checkout',

        upgrade_endpoint: '/api/subscriptions/upgrade',

      },

      { status: 403 },

    );

  } catch (error) {

    console.error('[POST /api/modules]', error);

    return NextResponse.json({ error: 'Failed to enable module' }, { status: 500 });

  }

}


