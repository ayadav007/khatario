import type { PoolClient } from 'pg';

/**
 * Scan & Add Items review: the current state of the items a session touched, and what each one
 * still lacks before it is ready to bill. Read fresh from the database, so a fix made on the
 * item page shows up when the review is opened again.
 */

export type ReviewGap = 'hsn' | 'selling_price' | 'purchase_price' | 'mrp' | 'stock' | 'gst_zero';

export const REVIEW_GAP_LABELS: Record<ReviewGap, string> = {
  hsn: 'No HSN',
  selling_price: 'No selling price',
  purchase_price: 'No purchase price',
  mrp: 'No MRP',
  stock: 'No stock',
  gst_zero: 'GST 0%, check',
};

/** Gaps that stop a correct GST bill or stock value. The rest are worth a look but can be right. */
export const BLOCKING_GAPS: readonly ReviewGap[] = ['hsn', 'selling_price', 'purchase_price'];

export interface ReviewVariant {
  id: string;
  variant_name: string;
  selling_price: number | null;
  purchase_price: number | null;
  current_stock: number;
}

export interface ReviewItem {
  id: string;
  name: string;
  barcode: string | null;
  net_quantity: string | null;
  mrp: number | null;
  selling_price: number | null;
  purchase_price: number | null;
  tax_rate: number;
  hsn_sac: string | null;
  current_stock: number;
  has_variants: boolean;
  track_batch: boolean;
  /** Earliest expiry among batches that still hold stock. */
  next_expiry: string | null;
  from_database: boolean;
  variants: ReviewVariant[];
  gaps: ReviewGap[];
}

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** What an item still lacks. Sizes are checked one by one: any size without a price counts. */
export function reviewGaps(item: Omit<ReviewItem, 'gaps'>): ReviewGap[] {
  const gaps: ReviewGap[] = [];
  const sizes = item.has_variants ? item.variants : [];
  if (!item.hsn_sac) gaps.push('hsn');
  const sellMissing = sizes.length ? sizes.some((v) => !(Number(v.selling_price) > 0)) : !(Number(item.selling_price) > 0);
  if (sellMissing) gaps.push('selling_price');
  const costMissing = sizes.length ? sizes.some((v) => !(Number(v.purchase_price) > 0)) : !(Number(item.purchase_price) > 0);
  if (costMissing) gaps.push('purchase_price');
  if (!item.has_variants && !(Number(item.mrp) > 0)) gaps.push('mrp');
  const stock = sizes.length ? sizes.reduce((sum, v) => sum + (Number(v.current_stock) || 0), 0) : Number(item.current_stock) || 0;
  if (stock <= 0) gaps.push('stock');
  if (!item.tax_rate) gaps.push('gst_zero');
  return gaps;
}

/** Items of this business only; ids from another business are silently absent. */
export async function loadReviewItems(q: Pick<PoolClient, 'query'>, businessId: string, itemIds: string[]): Promise<ReviewItem[]> {
  if (itemIds.length === 0) return [];
  const rows = (
    await q.query(
      `SELECT i.id, i.name, i.barcode, i.net_quantity, i.mrp, i.selling_price, i.purchase_price,
              COALESCE(i.tax_rate, 0) AS tax_rate, i.hsn_sac, COALESCE(i.current_stock, 0) AS current_stock,
              COALESCE(i.has_variants, false) AS has_variants, COALESCE(i.track_batch, false) AS track_batch,
              i.external_source IS NOT NULL AS from_database,
              (SELECT MIN(b.expiry_date)::text FROM item_batches b
                WHERE b.item_id = i.id AND b.business_id = i.business_id AND b.quantity > 0) AS next_expiry,
              COALESCE((SELECT json_agg(json_build_object(
                         'id', v.id, 'variant_name', v.variant_name, 'selling_price', v.selling_price,
                         'purchase_price', v.purchase_price, 'current_stock', v.current_stock)
                       ORDER BY v.variant_name)
                 FROM item_variants v WHERE v.item_id = i.id), '[]'::json) AS variants
         FROM items i
        WHERE i.business_id = $1 AND i.id = ANY($2::uuid[]) AND i.deleted_at IS NULL
        ORDER BY i.name`,
      [businessId, itemIds]
    )
  ).rows as Array<Record<string, any>>;

  return rows.map((r) => {
    const base: Omit<ReviewItem, 'gaps'> = {
      id: String(r.id),
      name: String(r.name ?? ''),
      barcode: r.barcode ?? null,
      net_quantity: r.net_quantity ?? null,
      mrp: num(r.mrp),
      selling_price: num(r.selling_price),
      purchase_price: num(r.purchase_price),
      tax_rate: Number(r.tax_rate) || 0,
      hsn_sac: r.hsn_sac ?? null,
      current_stock: Number(r.current_stock) || 0,
      has_variants: r.has_variants === true,
      track_batch: r.track_batch === true,
      next_expiry: r.next_expiry ?? null,
      from_database: r.from_database === true,
      variants: (Array.isArray(r.variants) ? r.variants : []).map((v: Record<string, unknown>) => ({
        id: String(v.id),
        variant_name: String(v.variant_name ?? ''),
        selling_price: num(v.selling_price),
        purchase_price: num(v.purchase_price),
        current_stock: Number(v.current_stock) || 0,
      })),
    };
    return { ...base, gaps: reviewGaps(base) };
  });
}
