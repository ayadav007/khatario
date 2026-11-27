import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { getUserIdFromRequest, requireTenantBusinessId } from '@/lib/auth-helpers';
import { userCanMutateSubscription } from '@/lib/security/require-subscription-mutation';
import { computePlanAmount, normalizeBillingCycle } from '@/lib/subscription/apply-plan-change';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { PLATFORM_MODULE_LABELS, type PlatformModule } from '@/lib/platform-modules';
import { getEntitlementTermsIdForModuleSub, getModuleSubscriptions } from '@/lib/subscription/module-subscriptions';
import { planLimitRowsQuery } from '@/lib/subscription/plan-terms';
import {
  getDisplayPlanId,
  getEntitlementPlanId,
  getPaidGraceEndDate,
  getSubscriptionUsability,
} from '@/lib/subscription/effective-plan';
import { checkLimit } from '@/lib/subscription';

function toDateText(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export const dynamic = 'force-dynamic';

const USAGE_TYPES_BY_MODULE: Record<string, string[]> = {
  billing: ['invoices', 'customers', 'items'],
  hr: ['employees'],
  connect: ['whatsapp', 'connect_agents'],
};

async function mergePlanFeatures(planId: string, features: Record<string, unknown>, termsId: string | null = null) {
  const merged = { ...features, limits: { ...(features.limits as object) } } as {
    limits: Record<string, number>;
    features: Record<string, boolean>;
  };

  try {
    const limitsQ = planLimitRowsQuery(planId, termsId);
    const planLimits = await db.query(limitsQ.sql, limitsQ.params);
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

    // The same permission the plan-change routes require. Staff without it see the plan name only.
    const userId = getUserIdFromRequest(request);
    const canManageBilling = !!userId && (await userCanMutateSubscription(userId, businessId));

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
          cancel_at_period_end: sub.cancel_at_period_end,
          scheduled_plan_id: sub.scheduled_plan_id,
          db_today: sub.db_today,
        };
        const usability = getSubscriptionUsability(subForEffective);
        const displayPlanId = getDisplayPlanId(subForEffective);
        const limitsPlanId = getEntitlementPlanId(subForEffective);

        const planRow = await db.queryOne<{
          plan_display_name: string;
          plan_description: string;
          price_monthly: number;
          price_yearly: number;
          price_3year: number | null;
          currency: string;
          features: unknown;
          scheduled_plan_display_name: string | null;
        }>(
          `SELECT display_name AS plan_display_name, description AS plan_description,
                  price_monthly, price_yearly, price_3year, currency, features,
                  (SELECT display_name FROM subscription_plans WHERE id = $2) AS scheduled_plan_display_name
           FROM subscription_plans WHERE id = $1`,
          [limitsPlanId, sub.scheduled_plan_id ?? null],
        );

        // A pinned business shows (and is judged paid by) the prices it pays, not the plan's current ones.
        const pinnedTermsId = getEntitlementTermsIdForModuleSub(sub);
        const pinnedPrices = pinnedTermsId
          ? await db.queryOne<{ price_monthly: number; price_yearly: number; price_3year: number | null }>(
              `SELECT price_monthly, price_yearly, price_3year FROM subscription_plan_terms WHERE id = $1 AND plan_id = $2`,
              [pinnedTermsId, limitsPlanId],
            )
          : null;
        if (planRow && pinnedPrices) Object.assign(planRow, pinnedPrices);

        let features =
          typeof planRow?.features === 'string'
            ? JSON.parse(planRow.features)
            : planRow?.features ?? {};
        features = await mergePlanFeatures(limitsPlanId, features as Record<string, unknown>, getEntitlementTermsIdForModuleSub(sub));

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

        // Nothing renews by itself: payments are one-off, so the customer pays again before the end date.
        const graceEndDate = sub.cancel_at_period_end ? null : getPaidGraceEndDate(subForEffective);
        const isPaidPlan =
          Number(planRow?.price_monthly ?? 0) > 0 ||
          Number(planRow?.price_yearly ?? 0) > 0 ||
          Number(planRow?.price_3year ?? 0) > 0;
        const canRenew =
          isPaidPlan &&
          sub.status === 'active' &&
          !!sub.end_date &&
          usability.operational;

        const usageTypes = USAGE_TYPES_BY_MODULE[moduleKey] ?? [];
        const planDisplayName = planRow?.plan_display_name ?? 'Your plan';
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

        if (!canManageBilling) {
          return {
            module_key: moduleKey,
            label: PLATFORM_MODULE_LABELS[moduleKey],
            enabled: true,
            subscription: {
              plan_id: displayPlanId,
              status: sub.status,
              plan_display_name: planDisplayName,
              can_manage_billing: false,
            },
            usage,
          };
        }

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
            plan_display_name: planDisplayName,
            plan_description: planRow?.plan_description ?? '',
            price_monthly: planRow?.price_monthly ?? 0,
            price_yearly: planRow?.price_yearly ?? 0,
            price_3year: planRow?.price_3year ?? null,
            // The plan's list price for the cycle the customer is on: the card shows this, not always the monthly price.
            price_for_cycle: planRow
              ? computePlanAmount(planRow as Parameters<typeof computePlanAmount>[0], normalizeBillingCycle(sub.billing_cycle))
              : 0,
            scheduled_plan_display_name: planRow?.scheduled_plan_display_name ?? null,
            currency: planRow?.currency ?? 'INR',
            features,
            trial_days_remaining: trialDaysRemaining,
            is_operational: usability.operational,
            is_grace_period_active: usability.graceActive,
            grace_period_end: usability.graceEnd ? toDateText(usability.graceEnd) : null,
            grace_days_remaining: usability.graceDaysRemaining,
            auto_renew: false,
            renews_on: null,
            ends_on: sub.end_date ?? null,
            grace_ends_on: graceEndDate ? toDateText(graceEndDate) : null,
            in_grace: usability.graceActive,
            can_renew: canRenew,
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
      can_manage_billing: canManageBilling,
    });
  } catch (error) {
    console.error('[GET /api/subscriptions/modules/current]', error);
    return NextResponse.json({ error: 'Failed to load module subscriptions' }, { status: 500 });
  }
}
