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
import { loadEffectivePlanPrices } from '@/lib/subscription/plan-terms';
import { normalizeProductLine, SIGNUP_TRIAL_DAYS } from '@/lib/product-lines';
import { productLineToModule, type PlatformModule } from '@/lib/platform-modules';
import { getBusinessPlatformRecipient, notifyAdminsSubscriptionChange } from '@/lib/platform-email';
import { recordUpgradeBilling } from '@/lib/platform-billing';
import { archiveBusinessBillingTransactions, ARCHIVE_MISSING_MESSAGE } from '@/lib/platform-billing-archive';
import {
  computePlanAmount,
  billingCycleMonths,
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
    // Lock 1: the business row. A concurrent insert of a child row (a new payment row) takes a
    // FOR KEY SHARE lock on it through the foreign key, which conflicts with FOR UPDATE, so it waits
    // until this transaction ends instead of being cascade-deleted with no archive copy.
    // Lock 2: the existing payment rows. A completion in flight holds them; we wait for it, and the
    // archive snapshot below (taken after the lock is granted) then sees the committed state instead
    // of an older 'pending' one. A deadlock with an in-flight completion is acceptable: one side aborts and retries.
    await client.query(`SELECT 1 FROM businesses WHERE id = $1 FOR UPDATE`, [businessId]);
    await client.query(`SELECT 1 FROM billing_transactions WHERE business_id = $1 FOR UPDATE`, [businessId]);
    // Payment records are Khatario's revenue records: copy them out before anything is deleted.
    // Refuses the whole delete (and rolls back) when migration 479 has not been applied.
    await archiveBusinessBillingTransactions(client, businessId, 'business_deleted');
    await withLedgerDelete(client, 'tenant_purge', null, async () => {
      await client.query(`DELETE FROM ledger_entry_deletions WHERE business_id = $1`, [businessId]);
      await purgeTenantRows(client, businessId, { table: 'businesses', where: 'id = $1' });
    });
    await client.query('COMMIT');
  } catch (error: unknown) {
    await client.query('ROLLBACK').catch(() => {});
    if ((error as Error)?.message === ARCHIVE_MISSING_MESSAGE) throw error;
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

/**
 * What the admin editor wants written. Dates that depend on "today" are described, not computed,
 * here: the INSERT below turns them into dates with the database clock (make_interval), so the
 * server's timezone and clock never decide when a customer's access ends.
 */
type AdminSubscriptionFields = {
  status: string;
  /** Explicit trial end (or the existing one) used as the base of an extension. */
  trialBase: string | null;
  trialExtendDays: number | null;
  /** Days from today when a trial plan has no trial end yet. */
  trialDefaultDays: number | null;
  /** Explicit or existing end date. */
  endDate: string | null;
  /** When set, a missing or past end date becomes today + this many months (database date). */
  endDefaultMonths: number | null;
  billingCycle: 'monthly' | 'yearly' | 'three_year';
};

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
): AdminSubscriptionFields {
  const rawCycle = params.billingCycle ?? existing?.billing_cycle ?? 'monthly';
  const billingCycle = normalizeBillingCycle(rawCycle);
  const extend =
    params.extendTrialDays != null && params.extendTrialDays > 0 ? Math.floor(params.extendTrialDays) : null;
  const none = { trialBase: null, trialExtendDays: null, trialDefaultDays: null, endDate: null, endDefaultMonths: null };

  if (isTrialPlanId(planId)) {
    const base = params.trialEndDate ?? existing?.trial_end_date ?? null;
    return {
      ...none,
      status: 'trial',
      trialBase: base,
      trialExtendDays: extend,
      trialDefaultDays: base || extend ? null : SIGNUP_TRIAL_DAYS,
      billingCycle,
    };
  }

  const allowed = allowedAdminStatusesForPlan(planId);
  if (allowed.length === 1 && allowed[0] === 'active') {
    return { ...none, status: 'active', billingCycle };
  }

  const keptStatus =
    existing?.status && isAllowedAdminStatus(planId, existing.status) ? existing.status : 'active';
  const status = params.status ?? keptStatus;
  if (!isAllowedAdminStatus(planId, status)) {
    throw new Error(
      `Status "${status}" is not allowed for plan ${planId}. Allowed: ${allowedAdminStatusesForPlan(planId).join(', ')}`,
    );
  }
  const explicitTrial = params.trialEndDate ?? null;
  const endDate = params.endDate !== undefined ? params.endDate : existing?.end_date ?? null;
  return {
    ...none,
    status,
    trialBase: explicitTrial ? explicitTrial : extend ? existing?.trial_end_date ?? null : null,
    trialExtendDays: explicitTrial ? null : extend,
    endDate,
    endDefaultMonths:
      params.endDate === undefined && status === 'active' ? billingCycleMonths(billingCycle) : null,
    billingCycle,
  };
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
  const { status, billingCycle } = normalized;

  const row = await queryOne<BusinessSubscriptionRow>(
    `INSERT INTO business_module_subscriptions AS bms (
       business_id, module_key, plan_id, status, start_date, end_date, trial_end_date,
       billing_cycle, cancelled_at, updated_at
     ) VALUES (
       $1, $2, $3, $4::varchar, COALESCE($5::date, CURRENT_DATE),
       CASE WHEN $9::int IS NOT NULL AND ($6::date IS NULL OR $6::date < CURRENT_DATE)
            THEN CURRENT_DATE + make_interval(months => $9::int)
            ELSE $6::date END,
       CASE WHEN $10::int IS NOT NULL THEN GREATEST(COALESCE($7::date, CURRENT_DATE), CURRENT_DATE) + $10::int
            WHEN $7::date IS NOT NULL THEN $7::date
            WHEN $11::int IS NOT NULL THEN CURRENT_DATE + $11::int
            ELSE NULL END,
       $8,
       CASE WHEN $4::varchar = 'cancelled' THEN CURRENT_TIMESTAMP ELSE NULL END, NOW()
     )
     ON CONFLICT (business_id, module_key) DO UPDATE SET
       plan_id = EXCLUDED.plan_id,
       plan_terms_id = CASE WHEN bms.plan_id IS DISTINCT FROM EXCLUDED.plan_id THEN NULL ELSE bms.plan_terms_id END,
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
      normalized.endDate,
      normalized.trialBase,
      billingCycle,
      normalized.endDefaultMonths,
      normalized.trialExtendDays,
      normalized.trialDefaultDays,
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
    trial_end_date: row.trial_end_date,
  });

  await logAdminAction(params.adminId, 'update_subscription', 'business', params.businessId, {
    module_key: moduleKey,
    plan_id: planId,
    status,
    trial_end_date: row.trial_end_date,
    end_date: row.end_date,
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
        // The amount a business pinned to older plan terms pays for this same plan is its own price.
        const effectivePrices = await loadEffectivePlanPrices(params.businessId, planId);
        const amount = planMeta ? computePlanAmount(effectivePrices ?? planMeta, billingCycle) : 0;
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
  // Claim the token atomically: two concurrent requests cannot both see it unused.
  const row = await queryOne<{
    id: string;
    user_id: string;
    business_id: string;
  }>(
    `UPDATE admin_impersonation_tokens SET used_at = NOW()
      WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
      RETURNING id, user_id, business_id`,
    [tokenHash],
  );

  if (!row) return null;

  if (await isBusinessPlatformSuspended(row.business_id)) return null;

  const updated = await queryOne<{ auth_session_version: string }>(
    `UPDATE users SET last_active_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING auth_session_version`,
    [row.user_id],
  );


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
