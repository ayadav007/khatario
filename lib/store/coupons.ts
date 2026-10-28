import type { PoolClient } from 'pg';

/**
 * Claim one use of a store coupon for an order, inside the order's transaction. The cap,
 * expiry and one-use-per-shopper rules are checked in the same statement that counts the use,
 * so concurrent checkouts cannot push a coupon past its cap. Returns false when it cannot be used.
 */
export async function claimStoreCouponUse(
  client: PoolClient,
  input: { businessId: string; code: string | null | undefined; orderId: string; storeCustomerId: string },
): Promise<boolean> {
  if (!input.code) return true;
  const used = await client.query(
    `SELECT 1 FROM store_coupon_redemptions r
       JOIN store_coupons c ON c.id = r.coupon_id
       JOIN store_orders o ON o.id = r.order_id
      WHERE c.business_id = $1 AND upper(c.code) = $2
        AND o.store_customer_id = $3 AND o.status <> 'cancelled'
      LIMIT 1`,
    [input.businessId, input.code.toUpperCase(), input.storeCustomerId],
  );
  if (used.rowCount) return false;
  const claimed = await client.query<{ id: string }>(
    `UPDATE store_coupons SET used_count = used_count + 1
      WHERE business_id = $1 AND upper(code) = $2 AND is_active = true
        AND (usage_cap IS NULL OR used_count < usage_cap)
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
      RETURNING id`,
    [input.businessId, input.code.toUpperCase()],
  );
  const couponId = claimed.rows[0]?.id;
  if (!couponId) return false;
  await client.query(
    `INSERT INTO store_coupon_redemptions (coupon_id, order_id) VALUES ($1, $2)`,
    [couponId, input.orderId],
  );
  return true;
}
