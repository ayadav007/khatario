import { queryOne } from '@/lib/db';

/** The business owner, used as the actor for platform diagnostics that write tenant data. */
export async function primaryAdminUserId(businessId: string): Promise<string | null> {
  const row = await queryOne<{ id: string }>(
    `SELECT id FROM users
      WHERE business_id = $1 AND is_primary_admin = true AND is_active = true
      ORDER BY created_at ASC
      LIMIT 1`,
    [businessId]
  );
  return row?.id ?? null;
}
