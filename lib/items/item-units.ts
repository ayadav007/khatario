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
  /** Own selling price of one of this unit; null means the item's price × factor. */
  selling_price: number | null;
}

export async function listItemUnits(db: Queryable, businessId: string, itemIds?: string[] | null): Promise<ItemUnit[]> {
  const r = await db.query(
    `SELECT id, item_id, unit, factor_to_base::float AS factor_to_base, barcode, selling_price::float AS selling_price FROM item_units
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
  units: Array<{ unit: string; factor_to_base: number; barcode?: string | null; selling_price?: number | string | null }>
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
    if (u.selling_price != null && u.selling_price !== '' && !(Number(u.selling_price) >= 0)) {
      throw new GodownStockError(`The price of one ${name} cannot be negative`);
    }
  }
  await client.query(`DELETE FROM item_units WHERE item_id = $1 AND business_id = $2`, [itemId, businessId]);
  for (const u of units) {
    await client.query(
      `INSERT INTO item_units (business_id, item_id, unit, factor_to_base, barcode, selling_price) VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        businessId,
        itemId,
        String(u.unit).trim().toUpperCase(),
        Number(u.factor_to_base),
        String(u.barcode || '').trim() || null,
        u.selling_price == null || u.selling_price === '' ? null : Number(u.selling_price),
      ]
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

/** Base units for a saved sales line: quantity × the factor stored on it (1 for old rows). */
export function baseQty(row: { quantity?: unknown; qty?: unknown; unit_factor?: unknown }): number {
  const qty = Number(row.quantity ?? row.qty) || 0;
  const factor = Number(row.unit_factor) || 1;
  return factor === 1 ? qty : Math.round(qty * factor * 1000) / 1000;
}

/** SQL for the base quantity of a line row: `baseQtySql('ii')`, or `baseQtySql('cni', 'qty')`. */
export function baseQtySql(alias: string, qtyCol = 'quantity'): string {
  return `(${alias}.${qtyCol} * COALESCE(${alias}.unit_factor, 1))`;
}

export class SaleUnitError extends Error {
  constructor(message: string, public statusCode = 400, public code = 'INVALID_SALE_UNIT') {
    super(message);
    this.name = 'SaleUnitError';
  }
}

export interface SaleUnit {
  /** The unit to store on the line: the alternate unit's own spelling, or what was sent. */
  unit: string | null;
  /** Base units in one of `unit`; 1 for the item's own unit or any unit that is not one of its alternates. */
  unit_factor: number;
}

/**
 * The unit and factor of each sales line, worked out on the server from the item's alternate
 * units. A factor sent by the client is never read. A unit that is not one of the item's
 * alternates (the item's own unit, an old client's "PCS") counts as the base unit, as before.
 * Bundles and serial-tracked items cannot be sold in an alternate unit.
 */
export async function resolveSaleUnits(
  db: Queryable,
  businessId: string,
  lines: Array<{ item_id?: string | null; unit?: string | null; item_name?: string | null }>
): Promise<SaleUnit[]> {
  const itemIds = [...new Set(lines.map((l) => l.item_id).filter((x): x is string => !!x))];
  const units = itemIds.length ? await listItemUnits(db, businessId, itemIds) : [];
  const flags = new Map<string, { unit: string | null; is_bundle: boolean; track_serial: boolean }>();
  if (units.length) {
    const r = await db.query(
      `SELECT id, unit, COALESCE(is_bundle, false) AS is_bundle,
              COALESCE((to_jsonb(i) ->> 'track_serial')::boolean, false) AS track_serial
         FROM items i WHERE business_id = $1 AND id = ANY($2::uuid[])`,
      [businessId, [...new Set(units.map((u) => u.item_id))]]
    );
    for (const x of r.rows) flags.set(x.id, x);
  }
  return lines.map((line) => {
    const sent = String(line.unit ?? '').trim();
    if (!line.item_id || !sent) return { unit: sent || null, unit_factor: 1 };
    const alt = units.find((u) => u.item_id === line.item_id && u.unit.toUpperCase() === sent.toUpperCase());
    if (!alt) return { unit: sent, unit_factor: 1 };
    const f = flags.get(line.item_id);
    const name = line.item_name || 'This item';
    if (f?.is_bundle) throw new SaleUnitError(`${name} is a bundle and can only be sold in ${f.unit || 'its own unit'}`);
    if (f?.track_serial) {
      throw new SaleUnitError(`${name} has serial numbers and can only be sold in ${f.unit || 'its own unit'}`);
    }
    return { unit: alt.unit, unit_factor: Number(alt.factor_to_base) };
  });
}
