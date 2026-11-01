/**
 * Supplier Hub prices for a connected buyer, from the same rules as the supplier's own bills
 * (lib/pricing/resolve-price) for the supplier's customer linked to that buyer: customer price,
 * price level with quantity slabs and dates, the customer's item discount, category discount and
 * size/colour prices.
 *
 * A rule price (customer or price level) wins. Without one, the price the supplier published on
 * the hub stands (the listing option's, else the listing's); with neither, the line has no price
 * yet and the bill uses the item's own price, as a bill would. The discount always comes from the
 * rules. Without the party pricing plan the supplier's bills ignore customer rules, and so does
 * the hub (every plan with Supplier Hub includes party pricing).
 */
import type { Exec } from './supplier-hub-links';
import { resolvePrices } from './pricing/resolve-price';
import { FeatureKeys } from './featureKeys';
import { assertFeatureAccess, FeatureAccessDeniedError } from './subscription/feature-access';

export type HubPriceInput = {
  vendorItemId: string;
  vendorVariantId?: string | null;
  /** Supplier units; quantity slabs count these */
  qty: number;
  /** What the supplier published on the hub for this item or option, if anything */
  publishedPrice?: number | null;
};

export type HubPrice = {
  /** Price per supplier unit on the item's own GST basis, or null when nothing sets one */
  price: number | null;
  discountPercent: number;
  /** True when a customer or price-level rule set the price ("your price") */
  fromRule: boolean;
  /** What a bill would charge with no hub price: rule price, else the item's (or size's) own price */
  billPrice: number | null;
};

/** Today's date in India, the day the supplier's bills are dated. */
export function hubPricingDate(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(now);
}

/** The supplier's customer record for this buyer (the oldest, if more than one is linked). */
export async function linkedCustomerFor(exec: Exec, vendorBusinessId: string, buyerBusinessId: string): Promise<string | null> {
  const row = (
    await exec(
      `SELECT id FROM customers
        WHERE business_id = $1 AND linked_business_id = $2 AND deleted_at IS NULL
        ORDER BY created_at
        LIMIT 1`,
      [vendorBusinessId, buyerBusinessId]
    )
  ).rows[0];
  return row ? String(row.id) : null;
}

async function partyPricingOn(vendorBusinessId: string): Promise<boolean> {
  try {
    await assertFeatureAccess(vendorBusinessId, FeatureKeys.PARTY_PRICING);
    return true;
  } catch (error) {
    if (error instanceof FeatureAccessDeniedError) return false;
    throw error;
  }
}

/** Prices for several of the supplier's items as this buyer would be billed for them. */
export async function hubPricesFor(
  exec: Exec,
  vendorBusinessId: string,
  buyerBusinessId: string,
  lines: HubPriceInput[],
  date = hubPricingDate()
): Promise<HubPrice[]> {
  if (lines.length === 0) return [];
  const customerId = (await partyPricingOn(vendorBusinessId))
    ? await linkedCustomerFor(exec, vendorBusinessId, buyerBusinessId)
    : null;
  const resolved = await resolvePrices(
    { query: (text: string, params?: unknown[]) => exec(text, params as any[]) } as any,
    vendorBusinessId,
    customerId,
    lines.map((l) => ({ itemId: l.vendorItemId, variantId: l.vendorVariantId ?? null, qty: l.qty > 0 ? l.qty : 1 })),
    date
  );
  return lines.map((l, i) => {
    const r = resolved[i];
    const fromRule = !!r && (r.priceSource === 'party' || r.priceSource === 'level') && r.price != null;
    return {
      price: fromRule ? r.price : l.publishedPrice ?? null,
      discountPercent: Number(r?.discountPercent) || 0,
      fromRule,
      billPrice: r?.price ?? null,
    };
  });
}

/** The supplier's size/colour of an item with sizes, matched by name (a listing option or the buyer's size). */
export async function vendorVariantByName(exec: Exec, vendorItemId: string, name: string | null | undefined): Promise<string | null> {
  const label = String(name ?? '').trim();
  if (!label) return null;
  const row = (
    await exec(
      `SELECT v.id FROM item_variants v
         JOIN items i ON i.id = v.item_id
        WHERE v.item_id = $1 AND COALESCE(i.has_variants, false) = true
          AND LOWER(TRIM(v.variant_name)) = LOWER($2)
        ORDER BY v.created_at
        LIMIT 1`,
      [vendorItemId, label]
    )
  ).rows[0];
  return row ? String(row.id) : null;
}

/**
 * Price an order's lines (all, or `lineIds`) from the rules above and store price, discount and
 * the supplier's size. Lines without a supplier item are left alone. Call it when lines are made,
 * when the supplier picks or changes a line's item, when a quantity changes before the order is
 * agreed, and when a first order's connection is accepted. After that the price is the agreed one.
 */
export async function priceOrderLines(exec: Exec, orderId: string, lineIds?: string[]): Promise<void> {
  if (lineIds && lineIds.length === 0) return;
  const order = (await exec(`SELECT buyer_business_id, vendor_business_id FROM supply_orders WHERE id = $1`, [orderId])).rows[0];
  if (!order) return;
  const rows = (
    await exec(
      `SELECT l.id, l.vendor_item_id, l.vendor_variant_id, l.qty, l.option_label, bv.variant_name AS buyer_variant_name,
              CASE WHEN pl.is_active THEN pl.price END AS listing_price,
              (SELECT o.price FROM supplier_listing_options o
                WHERE o.listing_id = pl.id AND LOWER(o.label) = LOWER(l.option_label) LIMIT 1) AS option_price
         FROM supply_order_lines l
         LEFT JOIN supplier_published_listings pl ON pl.supplier_business_id = $2 AND pl.item_id = l.vendor_item_id
         LEFT JOIN item_variants bv ON bv.id = l.buyer_variant_id
        WHERE l.order_id = $1 AND l.vendor_item_id IS NOT NULL
          ${lineIds ? 'AND l.id = ANY($3::uuid[])' : ''}
        ORDER BY l.sort_order`,
      lineIds ? [orderId, order.vendor_business_id, lineIds] : [orderId, order.vendor_business_id]
    )
  ).rows;
  if (rows.length === 0) return;
  for (const r of rows) {
    if (!r.vendor_variant_id) {
      r.vendor_variant_id =
        (await vendorVariantByName(exec, r.vendor_item_id, r.option_label)) ??
        (await vendorVariantByName(exec, r.vendor_item_id, r.buyer_variant_name));
    }
  }
  const prices = await hubPricesFor(
    exec,
    order.vendor_business_id,
    order.buyer_business_id,
    rows.map((r: any) => ({
      vendorItemId: r.vendor_item_id,
      vendorVariantId: r.vendor_variant_id,
      qty: Number(r.qty) || 1,
      publishedPrice: r.option_price != null ? Number(r.option_price) : r.listing_price != null ? Number(r.listing_price) : null,
    }))
  );
  for (let i = 0; i < rows.length; i++) {
    await exec(
      `UPDATE supply_order_lines SET unit_price = $2, discount_percent = $3, vendor_variant_id = $4 WHERE id = $1`,
      [rows[i].id, prices[i].price, prices[i].discountPercent, rows[i].vendor_variant_id]
    );
  }
}
