import type { PoolClient } from 'pg';

/**
 * Stock at online-store checkout (Shopify-style "don't oversell").
 *
 * Available = on-hand − active holds. On-hand matches what the storefront shows: branch stock when
 * the order names a branch and a row exists, else the item (or variant) stock. Only goods that are
 * not bundles are counted; services, bundles and items allowed to sell when out of stock
 * (Business profile > Billing preferences, or per item) are not checked.
 *
 * Placing an order holds its quantities in stock_reservations (reserved_for_type 'store_order').
 * Pay-online orders hold for STORE_ONLINE_HOLD_MINUTES; COD / UPI orders hold until the invoice is
 * posted (which deducts stock) or the order is cancelled.
 */

export const STORE_RESERVATION_TYPE = 'store_order';
export const STORE_ONLINE_HOLD_MINUTES = 30;

export type StoreStockLine = {
  item_id: string;
  variant_id: string | null;
  item_name: string;
  variant_name?: string | null;
  quantity: number;
};

export type StoreStockShortfall = {
  item_id: string;
  variant_id: string | null;
  name: string;
  requested: number;
  available: number;
};

/** The buyer-facing message for a cart that asks for more than is left. */
export function shortfallMessage(short: StoreStockShortfall[]): string {
  const first = short[0];
  if (!first) return '';
  const left = Math.max(0, Math.floor(first.available));
  const what = left > 0 ? `Only ${left} left` : 'Out of stock';
  const more = short.length > 1 ? ` (and ${short.length - 1} more item${short.length > 2 ? 's' : ''})` : '';
  return `${what}: ${first.name}${more}. Please update your cart.`;
}

function lineKey(itemId: string, variantId: string | null): string {
  return `${itemId}:${variantId ?? ''}`;
}

/**
 * Checks the cart against available stock. Locks the item rows so two checkouts for the last unit
 * cannot both pass. Must run inside the caller's transaction.
 */
export async function checkStoreCartStock(
  client: PoolClient,
  p: { businessId: string; branchId: string | null; lines: StoreStockLine[]; excludeOrderId?: string | null },
): Promise<StoreStockShortfall[]> {
  // Same item can appear on two lines (e.g. added twice); compare the total.
  const wanted = new Map<string, StoreStockLine & { quantity: number }>();
  for (const line of p.lines) {
    const qty = Number(line.quantity);
    if (!line.item_id || !Number.isFinite(qty) || qty <= 0) continue;
    const key = lineKey(line.item_id, line.variant_id);
    const prev = wanted.get(key);
    if (prev) prev.quantity += qty;
    else wanted.set(key, { ...line, quantity: qty });
  }
  if (wanted.size === 0) return [];

  const itemIds = [...new Set([...wanted.values()].map((l) => l.item_id))];
  const items = await client.query<{ id: string; tracked: boolean; stock: string }>(
    `SELECT i.id,
            (COALESCE(i.item_type, 'goods') = 'goods' AND NOT COALESCE(i.is_bundle, false)
             -- "Allow sales when out of stock" (item, else the business default) skips the check.
             AND NOT COALESCE(i.allow_sale_when_out_of_stock,
                              (SELECT bs.default_allow_sale_when_out_of_stock FROM business_settings bs WHERE bs.business_id = i.business_id),
                              false)) AS tracked,
            COALESCE(
              (SELECT bis.quantity FROM branch_item_stock bis
                WHERE bis.business_id = i.business_id AND bis.item_id = i.id
                  AND $3::uuid IS NOT NULL AND bis.branch_id = $3::uuid),
              i.current_stock, 0)::text AS stock
       FROM items i
      WHERE i.business_id = $1 AND i.id = ANY($2::uuid[])
      ORDER BY i.id
      FOR UPDATE OF i`,
    [p.businessId, itemIds, p.branchId],
  );
  const itemById = new Map(items.rows.map((r) => [r.id, r]));

  const variantIds = [...wanted.values()].map((l) => l.variant_id).filter(Boolean) as string[];
  const variantStock = new Map<string, number>();
  if (variantIds.length > 0) {
    const vs = await client.query<{ id: string; stock: string }>(
      `SELECT iv.id,
              COALESCE(
                (SELECT biv.quantity FROM branch_item_variant_stock biv
                  WHERE biv.business_id = $1 AND biv.item_variant_id = iv.id
                    AND $3::uuid IS NOT NULL AND biv.branch_id = $3::uuid),
                iv.current_stock, 0)::text AS stock
         FROM item_variants iv
        WHERE iv.id = ANY($2::uuid[])`,
      [p.businessId, variantIds, p.branchId],
    );
    for (const r of vs.rows) variantStock.set(r.id, Number(r.stock) || 0);
  }

  const held = await client.query<{ item_id: string; variant_id: string | null; q: string }>(
    `SELECT item_id, variant_id, COALESCE(SUM(quantity), 0)::text AS q
       FROM stock_reservations
      WHERE business_id = $1 AND item_id = ANY($2::uuid[]) AND status = 'active'
        AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)
        AND NOT ($3::uuid IS NOT NULL AND reserved_for_type = '${STORE_RESERVATION_TYPE}' AND reserved_for_id = $3::uuid)
      GROUP BY item_id, variant_id`,
    [p.businessId, itemIds, p.excludeOrderId ?? null],
  );
  const heldByKey = new Map(held.rows.map((r) => [lineKey(r.item_id, r.variant_id), Number(r.q) || 0]));

  const short: StoreStockShortfall[] = [];
  for (const [key, line] of wanted) {
    const item = itemById.get(line.item_id);
    if (!item || !item.tracked) continue;
    const onHand = line.variant_id ? variantStock.get(line.variant_id) ?? 0 : Number(item.stock) || 0;
    const available = onHand - (heldByKey.get(key) ?? 0);
    if (line.quantity > available + 0.0001) {
      short.push({
        item_id: line.item_id,
        variant_id: line.variant_id,
        name: line.variant_name ? `${line.item_name} (${line.variant_name})` : line.item_name,
        requested: line.quantity,
        available: Math.max(0, available),
      });
    }
  }
  return short;
}

/** Holds the order's quantities. Replaces any earlier hold for the same order. */
export async function holdStoreOrderStock(
  client: PoolClient,
  p: { businessId: string; orderId: string; lines: StoreStockLine[]; expiresAt: Date | null },
): Promise<number> {
  await releaseStoreOrderStock(client, { businessId: p.businessId, orderId: p.orderId, outcome: 'cancelled' });
  let held = 0;
  for (const line of p.lines) {
    const qty = Number(line.quantity);
    if (!line.item_id || !Number.isFinite(qty) || qty <= 0) continue;
    await client.query(
      `INSERT INTO stock_reservations
         (business_id, item_id, variant_id, quantity, reserved_for_type, reserved_for_id, status, expires_at, notes)
       SELECT $1, i.id, $3, $4, '${STORE_RESERVATION_TYPE}', $5, 'active', $6, 'Online store order'
         FROM items i
        WHERE i.business_id = $1 AND i.id = $2
          AND COALESCE(i.item_type, 'goods') = 'goods' AND NOT COALESCE(i.is_bundle, false)`,
      [p.businessId, line.item_id, line.variant_id || null, qty, p.orderId, p.expiresAt],
    );
    held += 1;
  }
  return held;
}

/**
 * Ends the order's hold: 'fulfilled' once the invoice has deducted stock, 'cancelled' when the order
 * is cancelled. Safe to call more than once.
 */
export async function releaseStoreOrderStock(
  client: PoolClient,
  p: { businessId: string; orderId: string; outcome: 'fulfilled' | 'cancelled'; userId?: string | null },
): Promise<number> {
  const res =
    p.outcome === 'fulfilled'
      ? await client.query(
          `UPDATE stock_reservations
              SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP
            WHERE business_id = $1 AND reserved_for_type = '${STORE_RESERVATION_TYPE}'
              AND reserved_for_id = $2 AND status = 'active'`,
          [p.businessId, p.orderId],
        )
      : await client.query(
          `UPDATE stock_reservations
              SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3
            WHERE business_id = $1 AND reserved_for_type = '${STORE_RESERVATION_TYPE}'
              AND reserved_for_id = $2 AND status = 'active'`,
          [p.businessId, p.orderId, p.userId ?? null],
        );
  return res.rowCount ?? 0;
}
