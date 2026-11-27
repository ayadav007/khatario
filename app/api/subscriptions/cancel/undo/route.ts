import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';
import { applySubscriptionMutationGuard } from '@/lib/security/apply-subscription-mutation-guard';
import { getBusinessPlatformContext } from '@/lib/business-modules';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import { normalizePlatformModule, PLATFORM_MODULE_LABELS } from '@/lib/platform-modules';

export const dynamic = 'force-dynamic';

/**
 * POST /api/subscriptions/cancel/undo
 * Takes back "cancel at period end" while the paid period is still running. Same business resolution,
 * owner guard and module handling as POST /api/subscriptions/cancel: the business comes from the
 * session, never from the body. The cancel only sets two flags (it schedules no downgrade), so the
 * undo clears those two flags and leaves any separately scheduled plan change alone.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const tenant = requireTenantBusinessId(request, body?.business_id);
    if (!tenant.ok) return tenant.response;

    const guard = await applySubscriptionMutationGuard(request, tenant.businessId);
    if (guard) return guard;

    // An undo changes data, so a module_key that is named but unknown is an error, never the primary product.
    const named = body?.module_key !== undefined && body?.module_key !== null;
    const requested = normalizePlatformModule(body?.module_key);
    if (named && !requested) {
      return NextResponse.json(
        { error: 'Unknown product. Use billing, hr, connect or crm.', code: 'INVALID_MODULE' },
        { status: 400 },
      );
    }
    const moduleKey = requested ?? (await getBusinessPlatformContext(tenant.businessId)).primaryModule;

    // A plan that was set to end because a payment was refunded is not the customer's cancellation to undo.
    const byRefund = await query(
      `SELECT 1 FROM business_module_subscriptions m
       WHERE m.business_id = $1 AND m.module_key = $2 AND m.cancel_at_period_end = true
         AND EXISTS (SELECT 1 FROM subscription_events e
                      WHERE e.business_id = m.business_id AND e.event_type = 'refund_cancel_scheduled'
                        AND e.details->>'module_key' = m.module_key
                        AND e.created_at >= COALESCE(m.cancelled_at, '-infinity'::timestamptz) - INTERVAL '1 minute')`,
      [tenant.businessId, moduleKey],
    );
    if ((byRefund.rowCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error: 'This plan is set to end because a payment was refunded, so the cancellation cannot be undone here. Please contact support if you want to keep the plan.',
          code: 'CANCELLED_BY_REFUND',
        },
        { status: 409 },
      );
    }

    // The UPDATE carries the whole condition, so a period that ended (or a cancellation already undone)
    // since the request started changes nothing.
    const result = await query(
      `UPDATE business_module_subscriptions
       SET cancel_at_period_end = false,
           cancelled_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND module_key = $2
         AND status IN ('active', 'trial')
         AND cancel_at_period_end = true
         AND COALESCE(end_date, trial_end_date::date) >= CURRENT_DATE
       RETURNING plan_id, end_date::text AS end_date`,
      [tenant.businessId, moduleKey],
    );

    if ((result.rowCount ?? 0) === 0) {
      return NextResponse.json(
        {
          error:
            'There is no cancellation to undo. Either this plan is not set to end, or its paid period has already ended.',
          code: 'NOT_CANCELLED',
        },
        { status: 400 },
      );
    }

    const row = result.rows[0] as { plan_id: string; end_date: string | null };
    await logSubscriptionEvent(tenant.businessId, 'cancellation_undone', {
      module_key: moduleKey,
      plan_id: row.plan_id,
      period_end: row.end_date,
    });
    clearSubscriptionCache(tenant.businessId);
    clearModuleSubscriptionCache(tenant.businessId);

    return NextResponse.json({
      success: true,
      module_key: moduleKey,
      message: `${PLATFORM_MODULE_LABELS[moduleKey]} cancellation undone. Your plan stays as it is. Without a payment it still ends on its end date and is not renewed automatically.`,
      end_date: row.end_date,
    });
  } catch (error: unknown) {
    console.error('Error undoing subscription cancellation:', error);
    return NextResponse.json({ error: 'Failed to undo cancellation' }, { status: 500 });
  }
}
