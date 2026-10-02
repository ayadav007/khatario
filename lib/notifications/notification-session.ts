import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';
import {
  assertUserSessionVersionMatches,
  getAuthenticatedUserId,
  getSessionScopedBusinessId,
} from '@/lib/auth-helpers';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

export type NotificationSessionResult =
  | { ok: true; userId: string; businessId: string }
  | { ok: false; response: NextResponse };

/**
 * Same tenant rule as `authorize()`: the user's current `users.business_id`, or any business
 * linked through `user_businesses`. `users.business_id` changes when the user switches business
 * on another device, so membership must also be accepted for older sessions to keep working.
 */
export async function userBelongsToSessionBusiness(userId: string, businessId: string): Promise<boolean> {
  const row = await queryOne<{ one: number }>(
    `SELECT 1 AS one
       FROM users u
      WHERE u.id = $1
        AND u.is_active = true
        AND (
          u.business_id = $2
          OR EXISTS (SELECT 1 FROM user_businesses ub WHERE ub.user_id = u.id AND ub.business_id = $2)
        )
      LIMIT 1`,
    [userId, businessId]
  );
  return row != null;
}

/**
 * Identity for notification routes comes only from the middleware-verified session headers.
 * Query, body and legacy `x-user-id` values are ignored, so requests without a session (store
 * subdomains, public paths) are refused instead of falling back to client-supplied ids.
 */
export async function requireNotificationSession(request: NextRequest): Promise<NotificationSessionResult> {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!isUuid(userId) || !isUuid(businessId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 }),
    };
  }

  const version = await assertUserSessionVersionMatches(request, userId);
  if (!version.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Session revoked', code: 'SESSION_REVOKED' }, { status: 401 }),
    };
  }

  if (!(await userBelongsToSessionBusiness(userId, businessId))) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'User does not belong to this business', code: 'CROSS_TENANT_DENIED' },
        { status: 403 }
      ),
    };
  }

  return { ok: true, userId, businessId };
}
