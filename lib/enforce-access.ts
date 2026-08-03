/**
 * Centralized access enforcement for API routes (subscription + feature + limits + branch).
 */

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

export type LimitType = LimitCheckType;

export interface EnforceAccessInput {
  businessId: string;
  userId: string;
  branchId?: string | null;
  feature?: string;
  limitType?: LimitType;
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

export async function enforceAccess(opts: EnforceAccessInput): Promise<void> {
  const {
    businessId,
    userId,
    branchId,
    feature,
    limitType,
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

  if (limitType) {
    if (poolClient) {
      const lim = await checkLimitInTransaction(poolClient, businessId, limitType);
      if (!lim.allowed) {
        throw new EnforceAccessError(403, 'SUBSCRIPTION_LIMIT_EXCEEDED', lim.message || 'Limit reached', {
          limit: lim.limit,
          current: lim.current,
        });
      }
    } else {
      const lim = await checkLimit(businessId, limitType);
      if (!lim.allowed) {
        throw new EnforceAccessError(403, 'SUBSCRIPTION_LIMIT_EXCEEDED', lim.message || 'Limit reached', {
          limit: lim.limit,
          current: lim.current,
        });
      }
    }
  }

  if (branchId) {
    const ok = await checkUserBranchPermission(userId, branchId, branchPermission);
    if (!ok) {
      throw new EnforceAccessError(403, 'BRANCH_ACCESS_DENIED', 'No permission for this branch.');
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
