import { queryRows, queryOne } from '@/lib/db';

export interface UserBusinessMembershipRow {
  id: string;
  name: string;
  role: 'owner' | 'admin' | 'staff';
}

/**
 * Businesses the user belongs to via user_businesses (with role per business).
 */
export async function listUserBusinessMemberships(
  userId: string
): Promise<UserBusinessMembershipRow[]> {
  return queryRows<UserBusinessMembershipRow>(
    `
    SELECT b.id, b.name, ub.role
    FROM user_businesses ub
    INNER JOIN businesses b ON b.id = ub.business_id
    WHERE ub.user_id = $1
    ORDER BY b.name ASC
    `,
    [userId]
  );
}

/** True if user_businesses has a row for this user and business */
export async function userBelongsToBusiness(
  userId: string,
  businessId: string
): Promise<boolean> {
  const row = await queryOne<{ one: number }>(
    `SELECT 1 AS one FROM user_businesses WHERE user_id = $1 AND business_id = $2 LIMIT 1`,
    [userId, businessId]
  );
  return row != null;
}
