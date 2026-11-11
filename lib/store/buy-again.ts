import { queryRows } from '@/lib/db';
import { buildStoreItemsQuery, type StoreItemsOutOfStock } from '@/lib/store/store-items-query';
import { mapStoreItemRow, type StoreItem } from '@/lib/store/map-store-product';

/** Order lines read per shopper, newest first; enough for a dozen distinct products and packs. */
export const BUY_AGAIN_LINES = 60;
/** Products (each pack its own) the route returns at most; the section shows `max_items` of them. */
export const BUY_AGAIN_MAX = 12;

export type BuyAgainItem = StoreItem & { buy_again_variant_id: string | null };

export interface BuyAgainPair {
  itemId: string;
  variantId: string | null;
}

/** Distinct item-and-pack pairs, newest order first: the same pack ordered twice counts once, two packs twice. */
export function buyAgainPairs(
  rows: { item_id: string; variant_id: string | null; ordered_at: string }[],
  limit: number,
): BuyAgainPair[] {
  const time = (s: string) => {
    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
  };
  // Array.prototype.sort is stable, so lines of one order keep their order.
  const sorted = [...rows].sort((a, b) => time(b.ordered_at) - time(a.ordered_at));
  const seen = new Set<string>();
  const out: BuyAgainPair[] = [];
  for (const r of sorted) {
    if (out.length >= limit) break;
    const key = `${r.item_id}|${r.variant_id ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ itemId: r.item_id, variantId: r.variant_id ?? null });
  }
  return out;
}

/**
 * One entry per pair whose product was found, in pair order. A pack the product no longer has is dropped (the
 * product stays, with no pack), and pairs that end up the same are kept once.
 */
export function attachBuyAgainVariants<T extends { id: string; variants: Array<{ id: string }> }>(
  pairs: BuyAgainPair[],
  items: T[],
): Array<T & { buy_again_variant_id: string | null }> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const seen = new Set<string>();
  const out: Array<T & { buy_again_variant_id: string | null }> = [];
  for (const p of pairs) {
    const item = byId.get(p.itemId);
    if (!item) continue;
    const variantId = p.variantId && item.variants.some((v) => v.id === p.variantId) ? p.variantId : null;
    const key = `${item.id}|${variantId ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, buy_again_variant_id: variantId });
  }
  return out;
}

/**
 * The shopper's own products to buy again in this business's store. `customerId` must come from a verified session
 * for `businessId` (never from the request). Cancelled orders are left out, and the products load through the shared
 * store items query, so a product hidden from the store (or deleted) is left out as in the catalogue.
 */
export async function loadBuyAgainItems(opts: {
  businessId: string;
  customerId: string;
  branchId?: string | null;
  outOfStock?: StoreItemsOutOfStock;
}): Promise<BuyAgainItem[]> {
  const lines = await queryRows<{ item_id: string; variant_id: string | null; ordered_at: Date | string }>(
    `SELECT soi.item_id, soi.variant_id, so.created_at AS ordered_at
       FROM store_order_items soi
       JOIN store_orders so ON so.id = soi.order_id
      WHERE so.business_id = $1
        AND so.store_customer_id = $2
        AND so.status <> 'cancelled'
      ORDER BY so.created_at DESC, so.id, soi.id
      LIMIT ${BUY_AGAIN_LINES}`,
    [opts.businessId, opts.customerId],
  );
  const pairs = buyAgainPairs(
    lines.map((l) => ({
      item_id: l.item_id,
      variant_id: l.variant_id,
      ordered_at: new Date(l.ordered_at).toISOString(),
    })),
    BUY_AGAIN_MAX,
  );
  if (!pairs.length) return [];

  const ids = Array.from(new Set(pairs.map((p) => p.itemId)));
  const q = buildStoreItemsQuery({
    businessId: opts.businessId,
    ids,
    branchId: opts.branchId ?? null,
    outOfStock: opts.outOfStock,
    limit: ids.length,
    offset: 0,
  });
  const rows = await queryRows<Record<string, unknown>>(q.listSql, q.listParams);
  return attachBuyAgainVariants(pairs, rows.map(mapStoreItemRow));
}
