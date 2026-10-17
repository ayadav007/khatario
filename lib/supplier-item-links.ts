/**
 * Supplier Hub item map (migration 391).
 *
 * A link says: supplier B's item X is buyer A's item Y, and one X is `factor` of Y
 * (a carton of 144 against single packs has factor 144). Links are learned from request
 * mappings and bill conversions, can be set by hand, and turn B's invoice lines into A's
 * purchase lines. A hand-set link is never overwritten by a learned one.
 */

import type { PoolClient } from 'pg';
import { execFor } from './supplier-hub-links';

export type ItemLinkSource = 'manual' | 'request' | 'conversion';

export type ItemLink = {
  vendorItemId: string;
  buyerItemId: string;
  factor: number;
  buyerUnit: string | null;
  source: ItemLinkSource;
};

export type ItemSuggestion = { id: string; name: string; unit: string | null; score: number };

/** Create or update the link for one supplier item. Learned links never replace a manual one. */
export async function saveItemLink(
  params: {
    buyerBusinessId: string;
    vendorBusinessId: string;
    buyerItemId: string;
    vendorItemId: string;
    factor?: number | null;
    source: ItemLinkSource;
    rate?: number | null;
    userId?: string | null;
  },
  client?: PoolClient
): Promise<void> {
  const exec = execFor(client);
  const factor = params.factor != null && Number(params.factor) > 0 ? Number(params.factor) : null;
  await exec(
    `
    INSERT INTO supplier_item_links (
      buyer_business_id, vendor_business_id, buyer_item_id, vendor_item_id,
      buyer_units_per_vendor_unit, source, last_rate, last_used_at, created_by_user_id
    )
    VALUES ($1, $2, $3, $4, COALESCE($5, 1), $6, $7, CURRENT_TIMESTAMP, $8)
    ON CONFLICT (buyer_business_id, vendor_business_id, vendor_item_id) DO UPDATE SET
      buyer_item_id = CASE
        WHEN supplier_item_links.source = 'manual' AND EXCLUDED.source <> 'manual'
          THEN supplier_item_links.buyer_item_id
        ELSE EXCLUDED.buyer_item_id
      END,
      buyer_units_per_vendor_unit = CASE
        WHEN supplier_item_links.source = 'manual' AND EXCLUDED.source <> 'manual'
          THEN supplier_item_links.buyer_units_per_vendor_unit
        WHEN $5::numeric IS NULL THEN supplier_item_links.buyer_units_per_vendor_unit
        ELSE EXCLUDED.buyer_units_per_vendor_unit
      END,
      source = CASE
        WHEN supplier_item_links.source = 'manual' THEN 'manual'
        ELSE EXCLUDED.source
      END,
      last_rate = COALESCE(EXCLUDED.last_rate, supplier_item_links.last_rate),
      last_used_at = CURRENT_TIMESTAMP
    `,
    [
      params.buyerBusinessId,
      params.vendorBusinessId,
      params.buyerItemId,
      params.vendorItemId,
      factor,
      params.source,
      params.rate ?? null,
      params.userId ?? null,
    ]
  );
}

/** Links for the given supplier items, keyed by supplier item id. */
export async function loadItemLinks(
  buyerBusinessId: string,
  vendorBusinessId: string,
  vendorItemIds: string[],
  client?: PoolClient
): Promise<Map<string, ItemLink>> {
  const map = new Map<string, ItemLink>();
  if (vendorItemIds.length === 0) return map;
  const res = await execFor(client)(
    `
    SELECT l.vendor_item_id, l.buyer_item_id, l.buyer_units_per_vendor_unit, l.source, bi.unit
    FROM supplier_item_links l
    JOIN items bi ON bi.id = l.buyer_item_id AND bi.deleted_at IS NULL
    WHERE l.buyer_business_id = $1
      AND l.vendor_business_id = $2
      AND l.vendor_item_id = ANY($3::uuid[])
    `,
    [buyerBusinessId, vendorBusinessId, vendorItemIds]
  );
  for (const r of res.rows) {
    map.set(String(r.vendor_item_id), {
      vendorItemId: String(r.vendor_item_id),
      buyerItemId: String(r.buyer_item_id),
      factor: Number(r.buyer_units_per_vendor_unit) || 1,
      buyerUnit: r.unit ?? null,
      source: r.source,
    });
  }
  return map;
}

/**
 * The buyer's items most likely to be this supplier line: same barcode first, then name
 * similarity, nudged up when the HSN code matches.
 */
export async function suggestBuyerItems(
  buyerBusinessId: string,
  line: { name: string; hsn?: string | null; barcode?: string | null },
  client?: PoolClient,
  limit = 3
): Promise<ItemSuggestion[]> {
  const name = String(line.name || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const hsn = String(line.hsn || '').trim();
  const barcode = String(line.barcode || '').trim();
  if (!name && !barcode) return [];
  const res = await execFor(client)(
    `
    WITH scored AS (
      SELECT i.id, i.name, i.unit,
        CASE
          WHEN $3 <> '' AND i.barcode = $3 THEN 1.0
          ELSE similarity(TRIM(REGEXP_REPLACE(LOWER(i.name), '[^a-z0-9]+', ' ', 'g')), $2)
               + CASE WHEN $4 <> '' AND i.hsn_sac = $4 THEN 0.15 ELSE 0 END
        END AS score
      FROM items i
      WHERE i.business_id = $1
        AND i.deleted_at IS NULL
        AND COALESCE(i.is_active, true) = true
        AND COALESCE(i.item_type, 'goods') <> 'service'
    )
    SELECT id, name, unit, ROUND(score::numeric, 3) AS score
    FROM scored
    WHERE score >= 0.25
    ORDER BY score DESC, name ASC
    LIMIT $5
    `,
    [buyerBusinessId, name, barcode, hsn, limit]
  );
  return res.rows.map((r) => ({ id: String(r.id), name: r.name, unit: r.unit ?? null, score: Number(r.score) }));
}
