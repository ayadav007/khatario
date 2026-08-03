import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { PLATFORM_MODULE_LABELS, type PlatformModule } from '@/lib/platform-modules';
import { getModuleSubscriptions } from '@/lib/subscription/module-subscriptions';
import {
  getDisplayPlanId,
  getEntitlementPlanId,
} from '@/lib/subscription/effective-plan';
import { checkLimit } from '@/lib/subscription';

export const dynamic = 'force-dynamic';

const USAGE_TYPES_BY_MODULE: Record<string, string[]> = {
  billing: ['invoices', 'customers', 'items'],
  hr: ['employees'],
  connect: ['whatsapp'],
};

async function mergePlanFeatures(planId: string, features: Record<string, unknown>) {
  const merged = { ...features, limits: { ...(features.limits as object) } } as {
    limits: Record<string, number>;
    features: Record<string, boolean>;
  };

  try {
    const planLimits = await db.query(
      `SELECT limit_key, limit_value FROM subscription_plan_limits WHERE plan_id = $1`,
      [planId],
    );
    for (const row of planLimits.rows as { limit_key: string; limit_value: number }[]) {
      merged.limits[row.limit_key] = row.limit_value;
    }
  } catch {
    /* registry optional */
  }

  return merged;
}

/**
 * GET /api/subscriptions/modules/current
 * Per-module subscription details for Settings → Plan & billing.
 */
export async function GET(request: NextRequest) {
  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;
    const businessId = tenant.businessId;

    const [ctx, moduleSubs] = await Promise.all([
      getBusinessPlatformContext(businessId),
      getModuleSubscriptions(businessId, true),
    ]);

    const subByModule = new Map(moduleSubs.map((s) => [s.module_key, s]));
    const consoleSeats = await checkLimit(businessId, 'users');

    const modules = (['billing', 'hr', 'connect'] as const)
      .filter((key) => ctx.enabledModules.includes(key))
      .map((moduleKey) => {
        const sub = subByModule.get(moduleKey);
        return { moduleKey, sub };
      });

    const enriched = await Promise.all(
      modules.map(async ({ moduleKey, sub }) => {
        if (!sub) {
          return {
            module_key: moduleKey,
            label: PLATFORM_MODULE_LABELS[moduleKey],
            enabled: true,
            subscription: null,
            usage: [],
          };
        }

        const subForEffective = {
          plan_id: sub.plan_id,
          status: sub.status,
          trial_end_date: sub.trial_end_date,
          end_date: sub.end_date,
          grace_period_end: sub.grace_period_end,
        };
        const displayPlanId = getDisplayPlanId(subForEffective);
        const limitsPlanId = getEntitlementPlanId(subForEffective);

        const planRow = await db.queryOne<{
          plan_display_name: string;
          plan_description: string;
          price_monthly: number;
          price_yearly: number;
          currency: string;
          features: unknown;
        }>(
          `SELECT display_name AS plan_display_name, description AS plan_description,
                  price_monthly, price_yearly, currency, features
           FROM subscription_plans WHERE id = $1`,
          [limitsPlanId],
        );

        let features =
          typeof planRow?.features === 'string'
            ? JSON.parse(planRow.features)
            : planRow?.features ?? {};
        features = await mergePlanFeatures(limitsPlanId, features as Record<string, unknown>);

        let trialDaysRemaining: number | null = null;
        if (sub.trial_end_date) {
          const trialEnd = new Date(sub.trial_end_date);
          const today = new Date();
          if (trialEnd > today) {
            trialDaysRemaining = Math.ceil(
              (trialEnd.getTime() - today.getTime()) / (1000 * 60 * 60 * 24),
            );
          }
        }

        const usageTypes = USAGE_TYPES_BY_MODULE[moduleKey] ?? [];
        const usage = await Promise.all(
          usageTypes.map(async (limitType) => {
            const check = await checkLimit(businessId, limitType as Parameters<typeof checkLimit>[1]);
            return {
              limit_type: limitType,
              current_count: check.current,
              max_limit: check.limit,
              allowed: check.allowed,
            };
          }),
        );

        return {
          module_key: moduleKey,
          label: PLATFORM_MODULE_LABELS[moduleKey],
          enabled: true,
          subscription: {
            plan_id: displayPlanId,
            stored_plan_id: sub.plan_id,
            status: sub.status,
            start_date: sub.start_date,
            end_date: sub.end_date,
            trial_end_date: sub.trial_end_date,
            scheduled_plan_id: sub.scheduled_plan_id ?? null,
            cancel_at_period_end: sub.cancel_at_period_end ?? false,
            billing_cycle: sub.billing_cycle ?? 'monthly',
            plan_display_name: planRow?.plan_display_name ?? displayPlanId,
            plan_description: planRow?.plan_description ?? '',
            price_monthly: planRow?.price_monthly ?? 0,
            price_yearly: planRow?.price_yearly ?? 0,
            currency: planRow?.currency ?? 'INR',
            features,
            trial_days_remaining: trialDaysRemaining,
            is_operational: sub.status === 'active' || sub.status === 'trial',
          },
          usage,
        };
      }),
    );

    return NextResponse.json({
      modules: enriched,
      console_seats: {
        current: consoleSeats.current,
        max: consoleSeats.limit,
        allowed: consoleSeats.allowed,
      },
      primary_module: ctx.primaryModule,
    });
  } catch (error) {
    console.error('[GET /api/subscriptions/modules/current]', error);
    return NextResponse.json({ error: 'Failed to load module subscriptions' }, { status: 500 });
  }
}
