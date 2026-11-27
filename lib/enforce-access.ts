/**
 * Centralized access enforcement for API routes (subscription + feature + limits + branch).
 */

import { BRANCH_READ_ONLY_MESSAGE, isBranchReadOnly } from '@/lib/subscription/over-limit-access';
import type { PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import {
  checkLimit,
  checkLimitInTransaction,
  type LimitCheckType,
} from '@/lib/subscription';
import {
  assertFeatureAccess,
  assertModuleAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';
import { getLimitOwnerModule } from '@/lib/subscription/module-entitlements';
import { getOperationalModuleSubscriptions } from '@/lib/subscription/module-subscriptions';
import { checkUserBranchPermission } from '@/lib/branch-access';
import { queryOne } from '@/lib/db';
import { assertSessionValidForCookieAuth } from '@/lib/auth-helpers';
import { AuthorizationError } from '@/lib/authorization';
import { LimitRefusedError } from '@/lib/subscription/limit-lock';

export type LimitType = LimitCheckType;

export interface EnforceAccessInput {
  businessId: string;
  userId: string;
  branchId?: string | null;
  feature?: string;
  limitType?: LimitType;
  /**
   * With `limitType`: still check that the limit's product is available, but do not count usage here.
   * The caller counts under the limit lock where it inserts (`withLimitedCreate`, lib/subscription/limit-lock.ts).
   */
  limitCountedByCaller?: boolean;
  poolClient?: PoolClient;
  branchPermission?: 'view' | 'create_transactions';
}

export class EnforceAccessError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'EnforceAccessError';
  }
}

/**
 * A refusal from withLimitedCreate as the EnforceAccessError that enforceAccessErrorResponse (and the
 * import runner) already turn into the standard limit answer: 403 upgrade prompt, or 503 try-again.
 */
export function limitRefusalToAccessError(e: LimitRefusedError): EnforceAccessError {
  if (e.check.unavailable) {
    return new EnforceAccessError(503, 'LIMIT_CHECK_UNAVAILABLE', e.message);
  }
  return new EnforceAccessError(403, 'SUBSCRIPTION_LIMIT_EXCEEDED', e.message, {
    limit: e.check.limit,
    current: e.check.current,
    limit_type: e.limitType,
  });
}

export async function enforceAccess(opts: EnforceAccessInput): Promise<void> {
  const {
    businessId,
    userId,
    branchId,
    feature,
    limitType,
    limitCountedByCaller,
    poolClient,
    branchPermission = 'create_transactions',
  } = opts;

  await assertSessionValidForCookieAuth(userId);

  if (feature) {
    try {
      await assertFeatureAccess(businessId, feature);
    } catch (e) {
      if (e instanceof FeatureAccessDeniedError) {
        const r = e.toResponse();
        throw new EnforceAccessError(403, r.code, r.error, { feature: r.feature });
      }
      throw e;
    }
  } else if (limitType) {
    const owner = getLimitOwnerModule(limitType);
    if (owner) {
      try {
        await assertModuleAccess(businessId, owner, limitType);
      } catch (e) {
        if (e instanceof FeatureAccessDeniedError) {
          const r = e.toResponse();
          throw new EnforceAccessError(403, r.code, r.error, { feature: r.feature });
        }
        throw e;
      }
    } else {
      const operational = await getOperationalModuleSubscriptions(businessId, true);
      if (operational.length === 0) {
        throw new EnforceAccessError(
          403,
          'NO_SUBSCRIPTION',
          'No active product subscription for this business.',
        );
      }
    }
  } else {
    const operational = await getOperationalModuleSubscriptions(businessId, true);
    if (operational.length === 0) {
      throw new EnforceAccessError(
        403,
        'NO_SUBSCRIPTION',
        'No active product subscription for this business.',
      );
    }
  }

  if (limitType && !limitCountedByCaller) {
    if (poolClient) {
      const lim = await checkLimitInTransaction(poolClient, businessId, limitType);
      if (!lim.allowed) {
        if (lim.unavailable) throw new EnforceAccessError(503, 'LIMIT_CHECK_UNAVAILABLE', lim.message || 'Please try again in a moment.');
        throw new EnforceAccessError(403, 'SUBSCRIPTION_LIMIT_EXCEEDED', lim.message || 'Limit reached', {
          limit: lim.limit,
          current: lim.current,
          limit_type: limitType,
        });
      }
    } else {
      const lim = await checkLimit(businessId, limitType);
      if (!lim.allowed) {
        if (lim.unavailable) throw new EnforceAccessError(503, 'LIMIT_CHECK_UNAVAILABLE', lim.message || 'Please try again in a moment.');
        throw new EnforceAccessError(403, 'SUBSCRIPTION_LIMIT_EXCEEDED', lim.message || 'Limit reached', {
          limit: lim.limit,
          current: lim.current,
          limit_type: limitType,
        });
      }
    }
  }

  if (branchId) {
    const ok = await checkUserBranchPermission(userId, branchId, branchPermission);
    if (!ok) {
      throw new EnforceAccessError(403, 'BRANCH_ACCESS_DENIED', 'No permission for this branch.');
    }
    // A branch beyond the plan's branch limit is read-only (SUB-24): writes are refused, viewing works.
    if (branchPermission !== 'view' && (await isBranchReadOnly(businessId, branchId))) {
      throw new EnforceAccessError(403, 'BRANCH_READ_ONLY', BRANCH_READ_ONLY_MESSAGE, { branch_id: branchId });
    }
  }
}

export function enforceAccessErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof EnforceAccessError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
      },
      { status: error.statusCode },
    );
  }
  if (error instanceof AuthorizationError) {
    return error.toNextResponse();
  }
  if (error instanceof FeatureAccessDeniedError) {
    return NextResponse.json(error.toResponse(), { status: 403 });
  }
  return null;
}

export async function isPrimaryAdminForBusiness(userId: string, businessId: string): Promise<boolean> {
  const row = await queryOne<{ ok: boolean }>(
    `SELECT is_primary_admin AS ok FROM users WHERE id = $1 AND business_id = $2`,
    [userId, businessId],
  );
  return row?.ok === true;
}
