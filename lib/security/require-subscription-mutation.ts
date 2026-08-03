/**
 * Subscription / billing mutations may only be performed by the business owner
 * (is_primary_admin) or a user assigned the primary_admin tenant role.
 */

import { NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const SUBSCRIPTION_MUTATION_FORBIDDEN_CODE = 'FORBIDDEN' as const;

export async function userCanMutateSubscription(
  userId: string,
  businessId: string,
): Promise<boolean> {
  const user = await queryOne<{
    is_primary_admin: boolean;
    business_id: string;
    role_id: string | null;
  }>(
    `SELECT is_primary_admin, business_id, role_id FROM users WHERE id = $1`,
    [userId],
  );

  if (!user || user.business_id !== businessId) {
    return false;
  }

  if (user.is_primary_admin) {
    return true;
  }

  if (user.role_id) {
    const role = await queryOne<{ role_key: string }>(
      `SELECT role_key FROM user_roles WHERE id = $1 AND business_id = $2`,
      [user.role_id, businessId],
    );
    if (role?.role_key === 'primary_admin') {
      return true;
    }
  }

  return false;
}

export async function requireSubscriptionMutationAccess(
  userId: string,
  businessId: string,
): Promise<NextResponse | null> {
  const allowed = await userCanMutateSubscription(userId, businessId);
  if (allowed) {
    return null;
  }

  return NextResponse.json(
    {
      error: 'Only the business owner or tenant admin can manage subscriptions.',
      code: SUBSCRIPTION_MUTATION_FORBIDDEN_CODE,
    },
    { status: 403 },
  );
}
