import { queryRows, queryOne, query } from '@/lib/db';

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

/**
 * Make `businessId` the user's active business (users.business_id, and the primary_admin role only for a real
 * owner of that business). Shared by the switch route and by sign-in when the current business pauses the user.
 * The caller has already checked membership.
 */
export async function setActiveBusiness(userId: string, businessId: string): Promise<void> {
  // Only a user the platform recognises as a business owner (is_primary_admin) may take the
  // primary_admin role of the business they switch to. Membership rows alone are not proof:
  // migration 208 recorded every pre-existing user, staff included, as an 'owner' member.
  await query(
    `UPDATE users u
     SET business_id = $1,
         role_id = CASE
           WHEN u.is_primary_admin = true AND ub.role = 'owner' THEN COALESCE(
             (SELECT id FROM user_roles WHERE business_id = $1 AND role_key = 'primary_admin' LIMIT 1),
             u.role_id
           )
           ELSE u.role_id
         END,
         updated_at = CURRENT_TIMESTAMP
     FROM user_businesses ub
     WHERE u.id = $2 AND ub.user_id = u.id AND ub.business_id = $1`,
    [businessId, userId]
  );
}
