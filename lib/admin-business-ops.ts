/**
 * Platform admin operations on tenant businesses.
 */

import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import type { PoolClient } from 'pg';
import { getPool, query, queryOne, queryRows } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { clearSubscriptionCache } from '@/lib/subscription';
import { logAdminAction } from '@/lib/platform-auth';
import { logSubscriptionEvent } from '@/lib/subscription/lifecycle';
import { isTrialPlanId } from '@/lib/subscription/trial-plan';
import {
  allowedAdminStatusesForPlan,
  isAllowedAdminStatus,
} from '@/lib/subscription/admin-plan-status';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { normalizeProductLine, SIGNUP_TRIAL_DAYS } from '@/lib/product-lines';
import { productLineToModule, type PlatformModule } from '@/lib/platform-modules';
import { getBusinessPlatformRecipient, notifyAdminsSubscriptionChange } from '@/lib/platform-email';
import { recordUpgradeBilling } from '@/lib/platform-billing';
import {
  computePlanAmount,
  computeSubscriptionPeriodEnd,
  normalizeBillingCycle,
} from '@/lib/subscription/apply-plan-change';

export interface BusinessSubscriptionRow {
  business_id: string;
  module_key: PlatformModule;
  plan_id: string;
  plan_display_name?: string | null;
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

type Queryable = Pick<PoolClient, 'query'>;

interface PurgeTarget {
  /** Table name as returned by `regclass::text` (already quoted when needed). */
  table: string;
  /** Row filter; `$1` is the business id. */
  where: string;
}

interface BlockingFk {
  child: string;
  child_col: string;
  parent: string;
  parent_col: string;
  ncols: number;
  parent_has_bid: boolean;
  child_has_bid: boolean;
}

const MAX_PURGE_ATTEMPTS = 200;

/**
 * Delete `target` rows, clearing ON DELETE RESTRICT blockers along the way. Postgres checks RESTRICT
 * immediately, so it can fire mid-cascade (e.g. items before stock_transfers reaches
 * stock_transfer_items) even though the blocking rows belong to the same tenant and are about to go.
 * Children are only deleted when they reference this tenant's rows (and carry this business_id when
 * they have one), so another tenant's data is never touched.
 */
export async function purgeTenantRows(
  client: Queryable,
  businessId: string,
  target: PurgeTarget,
  budget = { attempts: 0 },
): Promise<void> {
  const seen = new Set<string>();
  for (;;) {
    if (++budget.attempts > MAX_PURGE_ATTEMPTS) {
      throw new Error('Tenant purge gave up after too many blocking references');
    }
    await client.query('SAVEPOINT tenant_purge');
    try {
      await client.query(`DELETE FROM ${target.table} WHERE ${target.where}`, [businessId]);
      await client.query('RELEASE SAVEPOINT tenant_purge');
      return;
    } catch (error: unknown) {
      await client.query('ROLLBACK TO SAVEPOINT tenant_purge');
      await client.query('RELEASE SAVEPOINT tenant_purge');
      const e = error as { code?: string; constraint?: string; table?: string };
      if (e.code !== '23503' || !e.constraint) throw error;
      if (seen.has(e.constraint)) throw error;
      seen.add(e.constraint);

      const fk = (
        await client.query(
          `SELECT con.conrelid::regclass::text AS child,
                  con.confrelid::regclass::text AS parent,
                  (SELECT quote_ident(attname) FROM pg_attribute WHERE attrelid = con.conrelid AND attnum = con.conkey[1]) AS child_col,
                  (SELECT quote_ident(attname) FROM pg_attribute WHERE attrelid = con.confrelid AND attnum = con.confkey[1]) AS parent_col,
                  array_length(con.conkey, 1) AS ncols,
                  EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = con.confrelid AND attname = 'business_id' AND NOT attisdropped) AS parent_has_bid,
                  EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = con.conrelid AND attname = 'business_id' AND NOT attisdropped) AS child_has_bid
             FROM pg_constraint con
            WHERE con.contype = 'f' AND con.conname = $1
            ORDER BY (con.conrelid::regclass::text = $2) DESC
            LIMIT 1`,
          [e.constraint, e.table ?? ''],
        )
      ).rows[0] as BlockingFk | undefined;
      if (!fk || fk.ncols !== 1) throw error;

      const parentWhere = fk.parent_has_bid
        ? 'business_id = $1'
        : fk.parent === target.table
          ? target.where
          : null;
      if (!parentWhere) throw error;

      let childWhere = `${fk.child_col} IN (SELECT ${fk.parent_col} FROM ${fk.parent} WHERE ${parentWhere})`;
      if (fk.child_has_bid) childWhere += ' AND business_id = $1';
      await purgeTenantRows(client, businessId, { table: fk.child, where: childWhere }, budget);
    }
  }
}

/**
 * Hard-delete a tenant business via ON DELETE CASCADE, clearing RESTRICT blockers as needed.
 * Clears subscription caches and writes an admin audit log.
 */
export async function deleteBusinessCompletely(
  businessId: string,
  adminId: string,
): Promise<{ name: string }> {
  const existing = await queryOne<{ id: string; name: string }>(
    `SELECT id, name FROM businesses WHERE id = $1`,
    [businessId],
  );
  if (!existing) {
    throw new Error('Business not found');
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await withLedgerDelete(client, 'tenant_purge', null, async () => {
      await client.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [businessId]);
      await purgeTenantRows(client, businessId, { table: 'businesses', where: 'id = $1' });
    });
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    const code = (error as { code?: string })?.code;
    const detail = (error as { detail?: string; message?: string })?.detail
      || (error as { message?: string })?.message
      || 'Unknown database error';
    if (code === '23503') {
      throw new Error(
        `Cannot delete tenant: data outside this business still references it (${detail}).`,
      );
    }
    throw new Error(`Failed to delete tenant: ${detail}`);
  } finally {
    client.release();
  }

  clearSubscriptionCache(businessId);
  try {
    const { clearModuleSubscriptionCache } = await import('@/lib/subscription/module-subscriptions');
    clearModuleSubscriptionCache(businessId);
  } catch {
    /* optional */
  }

  await logAdminAction(adminId, 'delete_business', 'business', businessId, {
    name: existing.name,
  });

  return { name: existing.name };
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

const ADMIN_SUB_COLUMNS = `bms.business_id, bms.module_key, bms.plan_id, bms.status,
            bms.start_date::text AS start_date, bms.end_date::text AS end_date,
            bms.trial_end_date::text AS trial_end_date, bms.billing_cycle,
            bms.grace_period_end::text AS grace_period_end,
            COALESCE(bms.cancel_at_period_end, false) AS cancel_at_period_end,
            bms.cancelled_at::text AS cancelled_at, bms.scheduled_plan_id,
            sp.display_name AS plan_display_name`;

/** Every product subscription for a business, one row per module. */
export async function getBusinessModuleSubscriptions(
  businessId: string,
): Promise<BusinessSubscriptionRow[]> {
  return queryRows<BusinessSubscriptionRow>(
    `SELECT ${ADMIN_SUB_COLUMNS}
     FROM business_module_subscriptions bms
     LEFT JOIN subscription_plans sp ON sp.id = bms.plan_id
     WHERE bms.business_id = $1
     ORDER BY bms.module_key`,
    [businessId],
  );
}

export async function getBusinessSubscription(
  businessId: string,
  moduleKey: PlatformModule,
): Promise<BusinessSubscriptionRow | null> {
  return queryOne<BusinessSubscriptionRow>(
    `SELECT ${ADMIN_SUB_COLUMNS}
     FROM business_module_subscriptions bms
     LEFT JOIN subscription_plans sp ON sp.id = bms.plan_id
     WHERE bms.business_id = $1 AND bms.module_key = $2`,
    [businessId, moduleKey],
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
    billingCycle?: 'monthly' | 'yearly' | 'three_year';
  },
): {
  status: string;
  trialEnd: string | null;
  endDate: string | null;
  billingCycle: 'monthly' | 'yearly' | 'three_year';
} {
  const rawCycle = params.billingCycle ?? existing?.billing_cycle ?? 'monthly';
  const billingCycle = normalizeBillingCycle(rawCycle);

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
      end.setDate(end.getDate() + SIGNUP_TRIAL_DAYS);
      trialEnd = end.toISOString().split('T')[0];
    }
    return {
      status: 'trial',
      trialEnd,
      endDate: null,
      billingCycle,
    };
  }

  const allowed = allowedAdminStatusesForPlan(planId);
  if (allowed.length === 1 && allowed[0] === 'active') {
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

  const keptStatus =
    existing?.status && isAllowedAdminStatus(planId, existing.status) ? existing.status : 'active';
  const status = params.status ?? keptStatus;
  if (!isAllowedAdminStatus(planId, status)) {
    throw new Error(
      `Status "${status}" is not allowed for plan ${planId}. Allowed: ${allowedAdminStatusesForPlan(planId).join(', ')}`,
    );
  }
  const today = new Date().toISOString().split('T')[0];
  let endDate =
    params.endDate !== undefined ? params.endDate : existing?.end_date ?? null;
  if (params.endDate === undefined && endDate !== null && endDate < today && status === 'active') {
    endDate = null;
  }
  if (params.endDate === undefined && endDate === null && status === 'active') {
    endDate = computeSubscriptionPeriodEnd(billingCycle);
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
  billingCycle?: 'monthly' | 'yearly' | 'three_year';
  endDate?: string | null;
  moduleKey: PlatformModule;
}): Promise<BusinessSubscriptionRow> {
  const moduleKey = params.moduleKey;
  const existing = await getBusinessSubscription(params.businessId, moduleKey);
  const fromPlanId = existing?.plan_id ?? null;

  type PlanMeta = {
    display_name: string;
    price_monthly: number;
    price_yearly: number;
    price_3year: number | null;
    product_line: string | null;
  };
  let planPrices: PlanMeta | null = null;
  if (params.planId) {
    planPrices = await queryOne<PlanMeta>(
      `SELECT id, display_name, price_monthly, price_yearly, price_3year, product_line
       FROM subscription_plans WHERE id = $1 AND is_active = true`,
      [params.planId],
    );
    if (!planPrices) throw new Error('Invalid or inactive plan');
    const planModule = productLineToModule(normalizeProductLine(planPrices.product_line));
    if (planModule !== moduleKey) {
      throw new Error(`Plan ${params.planId} belongs to ${planModule}, not ${moduleKey}`);
    }
  }

  const planId = params.planId ?? existing?.plan_id;
  if (!planId) throw new Error(`No ${moduleKey} subscription yet; choose a plan`);
  const normalized = normalizeAdminSubscriptionFields(planId, existing, params);
  const { status, trialEnd, endDate, billingCycle } = normalized;

  const row = await queryOne<BusinessSubscriptionRow>(
    `INSERT INTO business_module_subscriptions AS bms (
       business_id, module_key, plan_id, status, start_date, end_date, trial_end_date,
       billing_cycle, cancelled_at, updated_at
     ) VALUES (
       $1, $2, $3, $4::varchar, COALESCE($5::date, CURRENT_DATE), $6::date, $7::date, $8,
       CASE WHEN $4::varchar = 'cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END, NOW()
     )
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       status = EXCLUDED.status,
       end_date = EXCLUDED.end_date,
       trial_end_date = EXCLUDED.trial_end_date,
       billing_cycle = EXCLUDED.billing_cycle,
       cancelled_at = CASE
         WHEN EXCLUDED.status = 'cancelled' THEN COALESCE(bms.cancelled_at, CURRENT_TIMESTAMP)
         ELSE NULL
       END,
       cancel_at_period_end = false,
       grace_period_end = NULL,
       scheduled_plan_id = NULL,
       updated_at = NOW()
     RETURNING bms.business_id, bms.module_key, bms.plan_id, bms.status,
               bms.start_date::text AS start_date, bms.end_date::text AS end_date,
               bms.trial_end_date::text AS trial_end_date, bms.billing_cycle,
               bms.grace_period_end::text AS grace_period_end,
               COALESCE(bms.cancel_at_period_end, false) AS cancel_at_period_end,
               bms.cancelled_at::text AS cancelled_at, bms.scheduled_plan_id`,
    [
      params.businessId,
      moduleKey,
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
  clearModuleSubscriptionCache(params.businessId);

  await logSubscriptionEvent(params.businessId, 'admin_updated', {
    from_plan_id: fromPlanId ?? undefined,
    to_plan_id: planId,
    module_key: moduleKey,
    admin_id: params.adminId,
    status,
    trial_end_date: trialEnd,
  });

  await logAdminAction(params.adminId, 'update_subscription', 'business', params.businessId, {
    module_key: moduleKey,
    plan_id: planId,
    status,
    trial_end_date: trialEnd,
  });

  const planMeta =
    planPrices ||
    (await queryOne<{
      display_name: string;
      price_monthly: number;
      price_yearly: number;
      price_3year: number | null;
    }>(
      `SELECT display_name, price_monthly, price_yearly, price_3year FROM subscription_plans WHERE id = $1`,
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
      if (!onlyTrialExtension && status !== 'cancelled') {
        const amount = planMeta ? computePlanAmount(planMeta, billingCycle) : 0;
        await recordUpgradeBilling({
          businessId: params.businessId,
          moduleKey,
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
