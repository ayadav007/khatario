import { queryRows } from '@/lib/db';

export const MAX_POPUP_DISMISS_ITEMS = 50;

/**
 * Records that the user dismissed reminder popups. Only the caller's own rows in the session
 * business are touched, and only up to the occurrence they saw (`seq`), so a re-fire that
 * happened meanwhile (new seq, popup_dismissed_at cleared by trigger) still pops.
 */
export async function dismissNotificationPopups(
  businessId: string,
  userId: string,
  items: { id: string; seq: string }[]
): Promise<string[]> {
  if (items.length === 0) return [];
  const rows = await queryRows<{ id: string }>(
    `UPDATE notifications n
        SET popup_dismissed_at = NOW()
       FROM unnest($3::uuid[], $4::bigint[]) AS d(id, seq)
      WHERE n.id = d.id
        AND n.business_id = $1
        AND n.user_id = $2
        AND n.seq <= d.seq
        AND n.popup_dismissed_at IS NULL
      RETURNING n.id`,
    [businessId, userId, items.map((i) => i.id), items.map((i) => i.seq)]
  );
  return rows.map((r) => r.id);
}
