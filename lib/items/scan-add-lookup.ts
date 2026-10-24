import type { PoolClient } from 'pg';
import { normalizeBarcode } from '@/lib/barcode-validator';

type Queryable = Pick<PoolClient, 'query'>;

export interface ShopBarcodeVariant {
  id: string;
  variant_name: string;
  barcode: string | null;
  current_stock: number;
}

export interface ShopBarcodeMatch {
  item: {
    id: string;
    name: string;
    barcode: string | null;
    unit: string | null;
    brand: string | null;
    mrp: number | null;
    selling_price: number | null;
    purchase_price: number | null;
    current_stock: number;
    has_variants: boolean;
    image_url: string | null;
    /** Size on pack, e.g. "100 g". */
    net_quantity: string | null;
    /** Prices include GST. */
    gst_included: boolean;
  };
  /** Set when the code is a variant's own barcode rather than the item's. */
  matched_variant_id: string | null;
  variants: ShopBarcodeVariant[];
  /** Sold, bought or adjusted since its opening stock. Such an item cannot be turned into variants. */
  has_history: boolean;
}

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/**
 * Scan & Add: is this exact barcode already an item (or variant) in this business?
 * Exact match only, unlike /api/items/search, so it never suggests a different product.
 */
export async function findShopBarcodeMatch(
  q: Queryable,
  businessId: string,
  rawBarcode: string
): Promise<ShopBarcodeMatch | null> {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) return null;

  const hit = (
    await q.query<{ item_id: string; variant_id: string | null }>(
      `SELECT i.id AS item_id, NULL::uuid AS variant_id
         FROM items i
        WHERE i.business_id = $1 AND i.barcode = $2 AND i.deleted_at IS NULL
       UNION ALL
       SELECT i.id, v.id
         FROM item_variants v
         JOIN items i ON i.id = v.item_id
        WHERE i.business_id = $1 AND v.barcode = $2 AND i.deleted_at IS NULL
        LIMIT 1`,
      [businessId, barcode]
    )
  ).rows[0];
  if (!hit) return null;

  const item = (
    await q.query(
      `SELECT i.id, i.name, i.barcode, i.unit, i.brand, i.mrp, i.selling_price, i.purchase_price,
              i.current_stock, i.has_variants, i.image_url, i.net_quantity, COALESCE(i.gst_included, false) AS gst_included,
              (EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.item_id = i.id)
               OR EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.item_id = i.id)
               OR EXISTS (SELECT 1 FROM stock_movements sm
                           WHERE sm.item_id = i.id AND sm.business_id = i.business_id
                             AND COALESCE(sm.notes, '') NOT LIKE 'Opening Stock%')) AS has_history
         FROM items i
        WHERE i.id = $1 AND i.business_id = $2`,
      [hit.item_id, businessId]
    )
  ).rows[0] as Record<string, unknown> | undefined;
  if (!item) return null;

  const variants = (
    await q.query(
      `SELECT id, variant_name, barcode, current_stock
         FROM item_variants
        WHERE item_id = $1
        ORDER BY variant_name`,
      [hit.item_id]
    )
  ).rows.map((v: Record<string, unknown>) => ({
    id: String(v.id),
    variant_name: String(v.variant_name ?? ''),
    barcode: (v.barcode as string | null) ?? null,
    current_stock: Number(v.current_stock) || 0,
  }));

  return {
    item: {
      id: String(item.id),
      name: String(item.name ?? ''),
      barcode: (item.barcode as string | null) ?? null,
      unit: (item.unit as string | null) ?? null,
      brand: (item.brand as string | null) ?? null,
      mrp: n(item.mrp),
      selling_price: n(item.selling_price),
      purchase_price: n(item.purchase_price),
      current_stock: Number(item.current_stock) || 0,
      has_variants: item.has_variants === true,
      image_url: (item.image_url as string | null) ?? null,
      net_quantity: (item.net_quantity as string | null) ?? null,
      gst_included: item.gst_included === true,
    },
    matched_variant_id: hit.variant_id,
    variants,
    has_history: item.has_history === true,
  };
}
