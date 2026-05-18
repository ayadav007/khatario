/**
 * Platform admin operations on tenant businesses.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { query, queryOne, queryRows } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logAdminAction } from '@/lib/platform-auth';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';
import { getBusinessPlatformRecipient, notifyAdminsSubscriptionChange } from '@/lib/platform-email';
import { recordUpgradeBilling } from '@/lib/platform-billing';

export interface BusinessSubscriptionRow {
  id: string;
  business_id: string;
  plan_id: string;
  status: string;
  start_date: string;
  end_date: string | null;
  trial_end_date: string | null;
  billing_cycle: string | null;
  grace_period_end: string | null;
  cancel_at_period_end: boolean;
  cancelled_at: string | null;
  scheduled_plan_id: string | null;
}

export async function isBusinessPlatformSuspended(businessId: string): Promise<boolean> {
  const row = await queryOne<{ platform_suspended_at: string | null }>(
    `SELECT platform_suspended_at FROM businesses WHERE id = $1`,
    [businessId],
  );
  return Boolean(row?.platform_suspended_at);
}

export async function setBusinessSuspended(
  businessId: string,
  suspended: boolean,
  reason: string | null,
  adminId: string,
): Promise<void> {
  if (suspended) {
    await query(
      `UPDATE businesses
       SET platform_suspended_at = NOW(),
           platform_suspend_reason = $2,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [businessId, reason?.trim() || null],
    );
  } else {
    await query(
      `UPDATE businesses
       SET platform_suspended_at = NULL,
           platform_suspend_reason = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [businessId],
    );
  }
  await logAdminAction(adminId, suspended ? 'suspend_business' : 'unsuspend_business', 'business', businessId, {
    reason,
  });
}

export async function getBusinessSubscription(
  businessId: string,
): Promise<BusinessSubscriptionRow | null> {
  return queryOne<BusinessSubscriptionRow>(
    `SELECT id, business_id, plan_id, status, start_date::text, end_date::text,
            trial_end_date::text, billing_cycle, grace_period_end::text,
            COALESCE(cancel_at_period_end, false) AS cancel_at_period_end,
            cancelled_at::text, scheduled_plan_id
     FROM business_subscriptions
     WHERE business_id = $1`,
    [businessId],
  );
}

function normalizeAdminSubscriptionFields(
  planId: string,
  existing: BusinessSubscriptionRow | null,
  params: {
    status?: string;
    trialEndDate?: string;
    extendTrialDays?: number;
    endDate?: string | null;
    billingCycle?: 'monthly' | 'yearly';
  },
): {
  status: string;
  trialEnd: string | null;
  endDate: string | null;
  billingCycle: 'monthly' | 'yearly';
} {
  const rawCycle = params.billingCycle ?? existing?.billing_cycle ?? 'monthly';
  const billingCycle: 'monthly' | 'yearly' =
    rawCycle === 'yearly' ? 'yearly' : 'monthly';

  if (isTrialPlanId(planId)) {
    let trialEnd = params.trialEndDate ?? existing?.trial_end_date ?? null;
    if (params.extendTrialDays != null && params.extendTrialDays > 0) {
      const base = trialEnd ? new Date(trialEnd) : new Date();
      if (base < new Date()) base.setTime(Date.now());
      base.setDate(base.getDate() + params.extendTrialDays);
      trialEnd = base.toISOString().split('T')[0];
    }
    if (!trialEnd) {
      const end = new Date();
      end.setDate(end.getDate() + 30);
      trialEnd = end.toISOString().split('T')[0];
    }
    return {
      status: 'trial',
      trialEnd,
      endDate: null,
      billingCycle,
    };
  }

  if (planId === 'free') {
    return {
      status: 'active',
      trialEnd: null,
      endDate: null,
      billingCycle,
    };
  }

  let trialEnd: string | null = null;
  if (params.trialEndDate) trialEnd = params.trialEndDate;
  else if (params.extendTrialDays != null && params.extendTrialDays > 0) {
    const base = existing?.trial_end_date ? new Date(existing.trial_end_date) : new Date();
    if (base < new Date()) base.setTime(Date.now());
    base.setDate(base.getDate() + params.extendTrialDays);
    trialEnd = base.toISOString().split('T')[0];
  }

  const status = params.status ?? existing?.status ?? 'active';
  let endDate =
    params.endDate !== undefined ? params.endDate : existing?.end_date ?? null;
  if (params.endDate === undefined && endDate === null && status === 'active') {
    const start = new Date();
    const end = new Date(start);
    if (billingCycle === 'yearly') end.setFullYear(end.getFullYear() + 1);
    else end.setMonth(end.getMonth() + 1);
    endDate = end.toISOString().split('T')[0];
  }

  return { status, trialEnd, endDate, billingCycle };
}

export async function adminUpdateSubscription(params: {
  businessId: string;
  adminId: string;
  planId?: string;
  status?: string;
  extendTrialDays?: number;
  trialEndDate?: string;
  billingCycle?: 'monthly' | 'yearly';
  endDate?: string | null;
}): Promise<BusinessSubscriptionRow> {
  const existing = await getBusinessSubscription(params.businessId);
  const fromPlanId = existing?.plan_id ?? null;

  let planPrices: { display_name: string; price_monthly: number; price_yearly: number } | null = null;
  if (params.planId) {
    planPrices = await queryOne<{ display_name: string; price_monthly: number; price_yearly: number }>(
      `SELECT id, display_name, price_monthly, price_yearly FROM subscription_plans WHERE id = $1 AND is_active = true`,
      [params.planId],
    );
    if (!planPrices) throw new Error('Invalid or inactive plan');
  }

  const planId = params.planId ?? existing?.plan_id ?? 'free';
  const normalized = normalizeAdminSubscriptionFields(planId, existing, params);
  const { status, trialEnd, endDate, billingCycle } = normalized;

  const row = await queryOne<BusinessSubscriptionRow>(
    `INSERT INTO business_subscriptions (
       business_id, plan_id, status, start_date, end_date, trial_end_date, billing_cycle, updated_at
     ) VALUES ($1, $2, $3, COALESCE($4::date, CURRENT_DATE), $5::date, $6::date, $7, NOW())
     ON CONFLICT (business_id) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = EXCLUDED.status,
       end_date = EXCLUDED.end_date,
       trial_end_date = EXCLUDED.trial_end_date,
       billing_cycle = EXCLUDED.billing_cycle,
       grace_period_end = NULL,
       scheduled_plan_id = NULL,
       updated_at = NOW()
     RETURNING id, business_id, plan_id, status, start_date::text, end_date::text,
               trial_end_date::text, billing_cycle, grace_period_end::text,
               COALESCE(cancel_at_period_end, false) AS cancel_at_period_end,
               cancelled_at::text, scheduled_plan_id`,
    [
      params.businessId,
      planId,
      status,
      existing?.start_date ?? null,
      endDate,
      trialEnd,
      billingCycle,
    ],
  );

  if (!row) throw new Error('Failed to update subscription');

  clearSubscriptionCache(params.businessId);

  await logSubscriptionEvent(params.businessId, 'admin_updated', {
    from_plan_id: fromPlanId ?? undefined,
    to_plan_id: planId,
    admin_id: params.adminId,
    status,
    trial_end_date: trialEnd,
  });

  await logAdminAction(params.adminId, 'update_subscription', 'business', params.businessId, {
    plan_id: planId,
    status,
    trial_end_date: trialEnd,
  });

  const planMeta =
    planPrices ||
    (await queryOne<{ display_name: string; price_monthly: number; price_yearly: number }>(
      `SELECT display_name, price_monthly, price_yearly FROM subscription_plans WHERE id = $1`,
      [planId],
    ));

  const onlyTrialExtension =
    params.extendTrialDays != null &&
    params.extendTrialDays > 0 &&
    !params.planId &&
    params.status === undefined &&
    params.trialEndDate === undefined;

  void (async () => {
    try {
      const recipient = await getBusinessPlatformRecipient(params.businessId);
      if (!onlyTrialExtension) {
        const amount =
          billingCycle === 'yearly'
            ? Number(planMeta?.price_yearly) || 0
            : Number(planMeta?.price_monthly) || 0;
        await recordUpgradeBilling({
          businessId: params.businessId,
          subscriptionId: row.id,
          planId,
          planDisplayName: planMeta?.display_name || planId,
          amount,
          billingCycle,
          paymentMethod: 'admin_manual',
          paymentStatus: 'completed',
        });
      }
      await notifyAdminsSubscriptionChange({
        businessId: params.businessId,
        businessName: recipient?.businessName || params.businessId,
        planDisplayName: planMeta?.display_name || planId,
        event: onlyTrialExtension ? 'trial extended by admin' : 'updated by platform admin',
      });
    } catch (e) {
      console.error('[admin-business-ops] subscription notification failed:', e);
    }
  })();

  return row;
}

export async function createImpersonationToken(params: {
  adminId: string;
  businessId: string;
  userId?: string;
}): Promise<{ token: string; expiresAt: Date; userId: string }> {
  let userId = params.userId;
  if (!userId) {
    const admin = await queryOne<{ id: string }>(
      `SELECT id FROM users
       WHERE business_id = $1 AND is_primary_admin = true AND is_active = true
       ORDER BY created_at ASC LIMIT 1`,
      [params.businessId],
    );
    if (!admin) {
      const any = await queryOne<{ id: string }>(
        `SELECT id FROM users WHERE business_id = $1 AND is_active = true ORDER BY created_at ASC LIMIT 1`,
        [params.businessId],
      );
      if (!any) throw new Error('No active users for this business');
      userId = any.id;
    } else {
      userId = admin.id;
    }
  }

  const user = await queryOne<{ id: string; business_id: string; is_active: boolean }>(
    `SELECT id, business_id, is_active FROM users WHERE id = $1 AND business_id = $2`,
    [userId, params.businessId],
  );
  if (!user?.is_active) throw new Error('User not found or inactive');

  if (await isBusinessPlatformSuspended(params.businessId)) {
    throw new Error('Business is suspended');
  }

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
  const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

  await query(
    `INSERT INTO admin_impersonation_tokens (token_hash, admin_id, business_id, user_id, expires_at)
     VALUES ($1, $2, $3, $4, $5)`,
    [tokenHash, params.adminId, params.businessId, userId, expiresAt.toISOString()],
  );

  await logAdminAction(params.adminId, 'impersonate_business', 'business', params.businessId, {
    user_id: userId,
  });

  return { token, expiresAt, userId };
}

export async function consumeImpersonationToken(
  plainToken: string,
): Promise<{ userId: string; businessId: string; sessionVersion: number } | null> {
  const tokenHash = crypto.createHash('sha256').update(plainToken).digest('hex');
  const row = await queryOne<{
    id: string;
    user_id: string;
    business_id: string;
    expires_at: string;
    used_at: string | null;
  }>(
    `SELECT id, user_id, business_id, expires_at, used_at
     FROM admin_impersonation_tokens WHERE token_hash = $1`,
    [tokenHash],
  );

  if (!row || row.used_at) return null;
  if (new Date(row.expires_at) < new Date()) return null;

  if (await isBusinessPlatformSuspended(row.business_id)) return null;

  const updated = await queryOne<{ auth_session_version: string }>(
    `UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING auth_session_version`,
    [row.user_id],
  );

  await query(`UPDATE admin_impersonation_tokens SET used_at = NOW() WHERE id = $1`, [row.id]);

  return {
    userId: row.user_id,
    businessId: row.business_id,
    sessionVersion: Number(updated?.auth_session_version ?? 1),
  };
}

export async function adminResetUserPassword(params: {
  businessId: string;
  userId: string;
  adminId: string;
  newPassword?: string;
}): Promise<{ temporaryPassword: string }> {
  const temp =
    params.newPassword?.trim() ||
    crypto.randomBytes(4).toString('hex') + 'A1!';
  const hash = await bcrypt.hash(temp, 10);

  const result = await queryOne(
    `UPDATE users
     SET password_hash = $1,
         auth_session_version = auth_session_version + 1,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3
     RETURNING id`,
    [hash, params.userId, params.businessId],
  );

  if (!result) throw new Error('User not found');

  await logAdminAction(params.adminId, 'reset_user_password', 'user', params.userId, {
    business_id: params.businessId,
  });

  return { temporaryPassword: temp };
}

export async function adminSetUserActive(params: {
  businessId: string;
  userId: string;
  isActive: boolean;
  adminId: string;
}): Promise<void> {
  if (!params.isActive) {
    const primary = await queryOne<{ is_primary_admin: boolean }>(
      `SELECT is_primary_admin FROM users WHERE id = $1 AND business_id = $2`,
      [params.userId, params.businessId],
    );
    if (primary?.is_primary_admin) throw new Error('Cannot deactivate the primary admin');
  }

  const row = await queryOne(
    `UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP
     WHERE id = $2 AND business_id = $3
     RETURNING id`,
    [params.isActive, params.userId, params.businessId],
  );
  if (!row) throw new Error('User not found');
  await logAdminAction(params.adminId, params.isActive ? 'activate_user' : 'deactivate_user', 'user', params.userId, {
    business_id: params.businessId,
  });
}
