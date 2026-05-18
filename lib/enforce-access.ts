/**
 * Centralized access enforcement for API routes (subscription + feature + limits + branch).
 * Compose this at the start of mutating handlers; keep domain validation separate.
 */

import type { PoolClient } from 'pg';
import { NextResponse } from 'next/server';
import {
  getBusinessSubscription,
  checkLimit,
  checkLimitInTransaction,
  isSubscriptionOperationalStatus,
  type LimitCheckType,
} from '@/lib/subscription';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { checkUserBranchPermission } from '@/lib/branch-access';
import { queryOne } from '@/lib/db';
import { assertSessionValidForCookieAuth } from '@/lib/auth-helpers';
import { AuthorizationError } from '@/lib/authorization';

export type LimitType = LimitCheckType;

export interface EnforceAccessInput {
  businessId: string;
  userId: string;
  /** When set, verifies user may act on this branch (create_transactions for writes). */
  branchId?: string | null;
  /** Registry / mapped feature key for assertFeatureAccess */
  feature?: string;
  /** When set, runs checkLimit after subscription exists */
  limitType?: LimitType;
  /** When set with limitType, uses locked subscription row + count inside the open transaction. */
  poolClient?: PoolClient;
  /** For branch checks on write paths */
  branchPermission?: 'view' | 'create_transactions';
}

export class EnforceAccessError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message);
    this.name = 'EnforceAccessError';
  }
}

/**
 * Throws EnforceAccessError with .statusCode / .code for route handlers.
 */
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

  const sub = await getBusinessSubscription(businessId, true);
  if (!sub) {
    throw new EnforceAccessError(403, 'NO_SUBSCRIPTION', 'No active subscription for this business.');
  }

  if (sub.status && !isSubscriptionOperationalStatus(sub.status)) {
    throw new EnforceAccessError(403, 'SUBSCRIPTION_INACTIVE', `Subscription status is ${sub.status}.`);
  }

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

/** True if user is primary admin for the business (full customer list, etc.). */
/** Map thrown errors from enforceAccess (and nested feature errors) to a NextResponse, or null. */
export function enforceAccessErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof EnforceAccessError) {
    return NextResponse.json(
      {
        error: error.message,
        code: error.code,
        ...(error.details && typeof error.details === 'object' ? error.details : {}),
      },
      { status: error.statusCode }
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
    [userId, businessId]
  );
  return row?.ok === true;
}
