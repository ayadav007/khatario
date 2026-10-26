import type { PoolClient } from 'pg';
import { GodownStockError } from '@/lib/inventory/godown-stock';

/**
 * Alternate units of an item: "BOX = 12 PCS", "BAG = 50 KGS". Stock is always kept in the
 * item's own unit; these let a count (and a scanned box barcode) be entered in the unit on the
 * shelf and converted.
 */
type Queryable = Pick<PoolClient, 'query'>;

export interface ItemUnit {
  id: string;
  item_id: string;
  unit: string;
  factor_to_base: number;
  barcode: string | null;
}

export async function listItemUnits(db: Queryable, businessId: string, itemIds?: string[] | null): Promise<ItemUnit[]> {
  const r = await db.query(
    `SELECT id, item_id, unit, factor_to_base::float AS factor_to_base, barcode FROM item_units
      WHERE business_id = $1 AND ($2::uuid[] IS NULL OR item_id = ANY($2::uuid[])) ORDER BY unit`,
    [businessId, itemIds ?? null]
  );
  return r.rows;
}

/** Replaces an item's alternate units. */
export async function saveItemUnits(
  client: PoolClient,
  businessId: string,
  itemId: string,
  units: Array<{ unit: string; factor_to_base: number; barcode?: string | null }>
): Promise<ItemUnit[]> {
  const item = await client.query(`SELECT unit FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [itemId, businessId]);
  if (!item.rows[0]) throw new GodownStockError('Item not found', 404);
  const base = String(item.rows[0].unit || '').toUpperCase();
  const seen = new Set<string>();
  for (const u of units) {
    const name = String(u.unit || '').trim().toUpperCase();
    if (!name) throw new GodownStockError('Each unit needs a name');
    if (name === base) throw new GodownStockError(`${name} is already the item's own unit`);
    if (seen.has(name)) throw new GodownStockError(`${name} is listed twice`);
    seen.add(name);
    if (!(Number(u.factor_to_base) > 0)) throw new GodownStockError(`Say how many ${base} one ${name} holds`);
  }
  await client.query(`DELETE FROM item_units WHERE item_id = $1 AND business_id = $2`, [itemId, businessId]);
  for (const u of units) {
    await client.query(
      `INSERT INTO item_units (business_id, item_id, unit, factor_to_base, barcode) VALUES ($1, $2, $3, $4, $5)`,
      [businessId, itemId, String(u.unit).trim().toUpperCase(), Number(u.factor_to_base), String(u.barcode || '').trim() || null]
    );
  }
  return listItemUnits(client, businessId, [itemId]);
}

/** Base-unit quantity for a count entered in `unit` (the item's own unit when absent). */
export function toBaseQty(qty: number, unit: string | null | undefined, baseUnit: string | null, units: ItemUnit[]): number {
  if (!unit || String(unit).toUpperCase() === String(baseUnit || '').toUpperCase()) return qty;
  const u = units.find((x) => x.unit.toUpperCase() === String(unit).toUpperCase());
  if (!u) throw new GodownStockError(`${unit} is not a unit of this item`);
  return Math.round(qty * u.factor_to_base * 1000) / 1000;
}

/**
 * What each barcode on a count adds: an item's own barcode or code adds one base unit, a box
 * barcode adds the box. Keys are the scanned text.
 */
export async function countBarcodes(db: Queryable, businessId: string, countId: string): Promise<Record<string, { item_id: string; qty: number; label: string }>> {
  const r = await db.query(
    `SELECT i.id AS item_id, i.name, i.unit, i.barcode, i.code, u.unit AS alt_unit, u.factor_to_base::float AS factor, u.barcode AS alt_barcode
       FROM stock_count_lines l JOIN items i ON i.id = l.item_id
       LEFT JOIN item_units u ON u.item_id = i.id AND u.business_id = $1
      WHERE l.count_id = $2`,
    [businessId, countId]
  );
  const out: Record<string, { item_id: string; qty: number; label: string }> = {};
  for (const x of r.rows) {
    if (x.barcode) out[x.barcode] = { item_id: x.item_id, qty: 1, label: `${x.name} (1 ${x.unit || ''})`.trim() };
    if (x.code && !out[x.code]) out[x.code] = { item_id: x.item_id, qty: 1, label: `${x.name} (1 ${x.unit || ''})`.trim() };
    if (x.alt_barcode) out[x.alt_barcode] = { item_id: x.item_id, qty: Number(x.factor), label: `${x.name} (1 ${x.alt_unit} = ${x.factor} ${x.unit || ''})` };
  }
  return out;
}
