import { sendUsageLimitWarningEmail } from '@/lib/subscription/notifications';

/**
 * Fire-and-forget helper: send usage warning email when at 80% / 90% / 100%.
 * Dedup is handled inside sendUsageLimitWarningEmail (once per bucket per day).
 */
export async function notifyUsageThresholdIfNeeded(
  businessId: string,
  limitType: string,
  current: number,
  limit: number,
): Promise<void> {
  if (limit <= 0 || limit === -1) return;

  const pct = Math.round((current / limit) * 100);
  if (pct < 80) return;

  const bucket = pct >= 100 ? 100 : pct >= 90 ? 90 : 80;
  await sendUsageLimitWarningEmail(businessId, limitType, current, limit, bucket);
}
