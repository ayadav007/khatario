import { queryOne } from '@/lib/db';
import { checkUserPermission } from '@/lib/permissions';

/** Primary admin, HR Admin, and Payroll Clerk can see wage amounts. Team Lead cannot. */
export async function viewerCanSeeWages(userId: string): Promise<boolean> {
  const user = await queryOne<{ is_primary_admin: boolean | null }>(
    'SELECT is_primary_admin FROM users WHERE id = $1',
    [userId],
  );
  if (user?.is_primary_admin) return true;
  return checkUserPermission(userId, 'payroll', 'view');
}
