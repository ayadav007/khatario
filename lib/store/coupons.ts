import { query } from '@/lib/db';

export async function incrementStoreCouponUse(
  businessId: string,
  code: string | null | undefined,
): Promise<void> {
  if (!code) return;
  await query(
    `UPDATE store_coupons SET used_count = used_count + 1
     WHERE business_id = $1 AND upper(code) = $2`,
    [businessId, code.toUpperCase()],
  );
}
