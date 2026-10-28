import type { PoolClient } from 'pg';
import { GodownStockError } from '@/lib/inventory/godown-stock';
import { recostAfterStockChange } from '@/lib/inventory/fifo-recost';

/**
 * Folds a duplicate item (the same goods entered twice under different names) into the one that
 * stays. Every document line, stock movement and adjustment is repointed; godown quantities are
 * added together; per-item settings the target already has (party prices, store favourites,
 * listings) keep the target's. The source is soft-deleted and the merge is logged. One unit
 * between the two is required, since quantities are moved as they are.
 */

const r3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;

/** Rows of the source whose key already exists for the target: the target's row is kept. */
const KEEP_TARGET: Record<string, string> = {
  bundle_items: 'bundle_id',
  party_item_prices: 'business_id, party_id, variant_id',
  store_item_favorites: 'business_id, customer_id',
  store_item_ratings: 'business_id, customer_id',
  supplier_item_thresholds: 'supplier_business_id, customer_business_id',
  supplier_published_listings: 'supplier_business_id',
  closing_stock_snapshot_items: 'snapshot_id',
  stock_audit_entries: 'snapshot_id',
  stock_count_lines: 'count_id',
  whatsapp_catalog_items: 'business_id',
};

/** Godown quantities are added, not repointed. */
const QUANTITY_TABLES = new Set(['location_stock', 'branch_item_stock']);

export interface MergePreview {
  source: { id: string; name: string; unit: string | null };
  target: { id: string; name: string; unit: string | null };
  references: Record<string, number>;
  problems: string[];
}

async function lockItems(client: PoolClient, businessId: string, sourceId: string, targetId: string) {
  const r = await client.query(
    `SELECT id, name, unit, item_type, has_variants, is_bundle, track_batch, track_serial, barcode, current_stock, deleted_at
       FROM items WHERE business_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [businessId, [sourceId, targetId]]
  );
  const source = r.rows.find((x: any) => x.id === sourceId);
  const target = r.rows.find((x: any) => x.id === targetId);
  if (!source || !target) throw new GodownStockError('Both items must belong to this business', 404);
  return { source, target };
}

async function itemReferences(client: Pick<PoolClient, 'query'>): Promise<Array<{ table: string; column: string }>> {
  const r = await client.query(
    `SELECT c.conrelid::regclass::text AS tbl, a.attname AS col
       FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey)
      WHERE c.contype = 'f' AND c.confrelid = 'items'::regclass`
  );
  const refs = r.rows.map((x: any) => ({ table: x.tbl as string, column: x.col as string }));
  // Not a foreign key, but keyed by item.
  if (!refs.some((x) => x.table === 'whatsapp_catalog_items')) {
    const exists = await client.query(`SELECT to_regclass('public.whatsapp_catalog_items') IS NOT NULL AS ok`);
    if (exists.rows[0].ok) refs.push({ table: 'whatsapp_catalog_items', column: 'item_id' });
  }
  return refs;
}

function problemsFor(source: any, target: any): string[] {
  const p: string[] = [];
  if (source.id === target.id) p.push('Choose two different items');
  if (source.deleted_at || target.deleted_at) p.push('A deleted item cannot be merged');
  if ((source.item_type || 'goods') !== (target.item_type || 'goods')) p.push('Goods and services cannot be merged');
  if (source.has_variants || target.has_variants) p.push('Items with variants cannot be merged yet');
  if (source.is_bundle || target.is_bundle) p.push('Bundles cannot be merged');
  if (String(source.unit || '').toUpperCase() !== String(target.unit || '').toUpperCase()) {
    p.push(`Units differ (${source.unit || 'none'} and ${target.unit || 'none'}); quantities would be wrong`);
  }
  if (!!source.track_serial !== !!target.track_serial) p.push('One item is serial-tracked and the other is not');
  return p;
}

export async function previewItemMerge(client: PoolClient, businessId: string, sourceId: string, targetId: string): Promise<MergePreview> {
  const { source, target } = await lockItems(client, businessId, sourceId, targetId);
  const problems = problemsFor(source, target);
  const open = await client.query(
    `SELECT sc.count_number FROM stock_counts sc JOIN stock_count_lines l ON l.count_id = sc.id
      WHERE sc.business_id = $1 AND sc.status IN ('counting', 'review') AND l.item_id = ANY($2::uuid[]) LIMIT 1`,
    [businessId, [sourceId, targetId]]
  );
  if (open.rows[0]) problems.push(`Stock count ${open.rows[0].count_number} is open with one of these items`);
  const references: Record<string, number> = {};
  for (const ref of await itemReferences(client)) {
    if (ref.table === 'items') continue;
    const n = await client.query(`SELECT COUNT(*)::int AS n FROM ${ref.table} WHERE ${ref.column} = $1`, [sourceId]);
    if (n.rows[0].n > 0) references[`${ref.table}.${ref.column}`] = n.rows[0].n;
  }
  return {
    source: { id: source.id, name: source.name, unit: source.unit },
    target: { id: target.id, name: target.name, unit: target.unit },
    references,
    problems,
  };
}

export async function mergeItems(client: PoolClient, businessId: string, sourceId: string, targetId: string, userId: string | null) {
  const preview = await previewItemMerge(client, businessId, sourceId, targetId);
  if (preview.problems.length) throw new GodownStockError(preview.problems.join('. '), 409, 'MERGE_BLOCKED');
  const { source, target } = await lockItems(client, businessId, sourceId, targetId);

  // Serial numbers must not clash between the two.
  const clash = await client.query(
    `SELECT s.serial_number FROM item_serials s JOIN item_serials t ON t.item_id = $2 AND t.serial_number = s.serial_number
      WHERE s.item_id = $1 LIMIT 1`,
    [sourceId, targetId]
  );
  if (clash.rows[0]) throw new GodownStockError(`Serial ${clash.rows[0].serial_number} exists on both items`, 409, 'MERGE_BLOCKED');

  // 1. Godown quantities add up.
  await client.query(
    `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
     SELECT location_id, $2, current_stock_qty, CURRENT_TIMESTAMP FROM location_stock WHERE item_id = $1
     ON CONFLICT (location_id, item_id)
     DO UPDATE SET current_stock_qty = location_stock.current_stock_qty + EXCLUDED.current_stock_qty, last_updated = CURRENT_TIMESTAMP`,
    [sourceId, targetId]
  );
  await client.query(`DELETE FROM location_stock WHERE item_id = $1`, [sourceId]);
  await client.query(
    `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity, created_at, updated_at)
     SELECT business_id, branch_id, $2, quantity, NOW(), NOW() FROM branch_item_stock WHERE item_id = $1
     ON CONFLICT (business_id, branch_id, item_id)
     DO UPDATE SET quantity = branch_item_stock.quantity + EXCLUDED.quantity, updated_at = NOW()`,
    [sourceId, targetId]
  );
  await client.query(`DELETE FROM branch_item_stock WHERE item_id = $1`, [sourceId]);

  // 2. Everything else is repointed; keyed rows the target already has keep the target's.
  const moved: Record<string, number> = {};
  for (const ref of await itemReferences(client)) {
    if (ref.table === 'items' || QUANTITY_TABLES.has(ref.table)) continue;
    const keep = KEEP_TARGET[ref.table];
    if (keep && ref.column === 'item_id') {
      const cols = keep.split(',').map((c) => c.trim());
      await client.query(
        `DELETE FROM ${ref.table} s
          WHERE s.item_id = $1 AND EXISTS (
            SELECT 1 FROM ${ref.table} t WHERE t.item_id = $2 AND ${cols.map((c) => `t.${c} IS NOT DISTINCT FROM s.${c}`).join(' AND ')}
          )`,
        [sourceId, targetId]
      );
    }
    const u = await client.query(`UPDATE ${ref.table} SET ${ref.column} = $2 WHERE ${ref.column} = $1`, [sourceId, targetId]);
    if (u.rowCount) moved[`${ref.table}.${ref.column}`] = u.rowCount;
  }
  await client.query(`UPDATE items SET pack_source_item_id = $2 WHERE pack_source_item_id = $1 AND business_id = $3`, [sourceId, targetId, businessId]);

  // 3. The source is retired first so its barcode is free; the target keeps both items' stock
  //    figure and takes that barcode if it had none.
  await client.query(
    `UPDATE items SET deleted_at = NOW(), is_active = false, barcode = NULL, current_stock = 0,
            description = TRIM(BOTH FROM COALESCE(description, '') || ' Merged into ' || $3), updated_at = NOW()
      WHERE id = $1 AND business_id = $2`,
    [sourceId, businessId, target.name]
  );
  await client.query(
    `UPDATE items SET current_stock = COALESCE(current_stock, 0) + $3,
            barcode = COALESCE(barcode, $4), track_batch = track_batch OR $5, updated_at = NOW()
      WHERE id = $1 AND business_id = $2`,
    [targetId, businessId, r3(source.current_stock), source.barcode, !!source.track_batch]
  );
  await client.query(
    `INSERT INTO item_merges (business_id, source_item_id, source_name, target_item_id, moved, merged_by) VALUES ($1, $2, $3, $4, $5, $6)`,
    [businessId, sourceId, source.name, targetId, JSON.stringify(moved), userId]
  );
  await recostAfterStockChange(client, businessId, [targetId]);
  return { moved, source: preview.source, target: preview.target };
}
