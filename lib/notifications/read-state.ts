import { query } from '@/lib/db';

/**
 * Broadcast rows (`user_id IS NULL`) share one `is_read` flag across the business until
 * per-user read receipts exist, so they stay markable by any member of that business.
 */
export async function markNotificationRead(
  notificationId: string,
  businessId: string,
  userId: string
): Promise<boolean> {
  const result = await query(
    `UPDATE notifications
        SET is_read = true, read_at = NOW()
      WHERE id = $1
        AND business_id = $2
        AND (user_id = $3 OR user_id IS NULL)
        AND is_read IS NOT TRUE
      RETURNING id`,
    [notificationId, businessId, userId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function markAllNotificationsRead(businessId: string, userId: string): Promise<void> {
  await query(
    `UPDATE notifications
        SET is_read = true, read_at = NOW()
      WHERE business_id = $1
        AND is_read IS NOT TRUE
        AND (user_id = $2 OR user_id IS NULL)`,
    [businessId, userId]
  );
}
