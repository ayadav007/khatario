/**
 * Repack: take N of a bulk item out, put M of a packed item in (docs/REPACK_STOCK_DESIGN.md).
 * Two quantity adjustments (REPACK_OUT, REPACK_IN) on one transaction; the whole cost taken out
 * of the source, wastage included, becomes the packed item's cost. Inventory goes down and up by
 * the same amount, so no voucher is posted and there is no GST event.
 */

import type { PoolClient } from 'pg';
import { getPool, queryOne } from '@/lib/db';
import { adjustBranchItemStock, refreshItemGlobalStockFromBranches } from '@/lib/branch-stock';
import { currentUnitCosts } from '@/lib/inventory/cogs-posting';
import { fifoCostForDocument, getValuationMethod } from '@/lib/inventory/fifo-costing';
import { recostAfterStockChange } from '@/lib/inventory/fifo-recost';

export const WASTAGE_REASONS = ['SPILLAGE', 'MOISTURE', 'PACKAGING', 'OTHER'] as const;
export type WastageReason = (typeof WASTAGE_REASONS)[number];

export class RepackError extends Error {
  constructor(message: string, public code: string, public status = 400) {
    super(message);
  }
}

export interface CreateRepackParams {
  businessId: string;
  userId: string;
  sourceItemId: string;
  packedItemId: string;
  /** In the source item's unit. */
  sourceQty: number;
  /** In the packed item's unit. */
  packedQty: number;
  /** Source units in one packed unit; defaults to the packed item's saved "packed from" content. */
  contentPerUnit?: number | null;
  wastageReason?: WastageReason | null;
  wastageNotes?: string | null;
  notes?: string | null;
  repackDate: string;
  branchId?: string | null;
  locationId?: string | null;
}

export interface RepackResult {
  id: string;
  repackNumber: string;
  wastageQty: number;
  totalCost: number;
  unitCost: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const round3 = (n: number) => Math.round(n * 1000) / 1000;

/** Wastage in source units (negative when more was packed than taken out). */
export function repackWastage(sourceQty: number, packedQty: number, contentPerUnit: number) {
  const wastage = round3(sourceQty - packedQty * contentPerUnit);
  const percent = sourceQty > 0 ? Math.round((wastage / sourceQty) * 1000) / 10 : 0;
  return { wastage, percent };
}

interface Place {
  warehouse: boolean;
  branchId: string | null;
  locationId: string | null;
}

/** Branch or warehouse the repack happens at; both must belong to the business. */
async function resolvePlace(
  client: PoolClient,
  businessId: string,
  branchId?: string | null,
  locationId?: string | null
): Promise<Place> {
  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  if (await isWarehouseModeEnabled(businessId)) {
    if (!locationId) throw new RepackError('Pick the warehouse to repack in', 'LOCATION_REQUIRED');
    const w = await client.query<{ branch_id: string | null }>(
      'SELECT branch_id FROM warehouses WHERE id = $1 AND business_id = $2',
      [locationId, businessId]
    );
    if (w.rows.length === 0) throw new RepackError('Warehouse not found', 'LOCATION_NOT_FOUND', 404);
    return { warehouse: true, branchId: w.rows[0].branch_id, locationId };
  }
  let branch = branchId || null;
  if (!branch) {
    const { getDefaultBranchId } = await import('@/lib/branch-helpers');
    branch = (await getDefaultBranchId(businessId)) || null;
  }
  if (!branch) throw new RepackError('Pick the branch to repack in', 'BRANCH_REQUIRED');
  const b = await client.query('SELECT 1 FROM branches WHERE id = $1 AND business_id = $2', [branch, businessId]);
  if (b.rows.length === 0) throw new RepackError('Branch not found', 'BRANCH_NOT_FOUND', 404);
  return { warehouse: false, branchId: branch, locationId: null };
}

async function stockAt(client: PoolClient, businessId: string, place: Place, itemId: string): Promise<number> {
  const r = place.warehouse
    ? await client.query<{ q: string }>(
        'SELECT current_stock_qty AS q FROM location_stock WHERE location_id = $1 AND item_id = $2',
        [place.locationId, itemId]
      )
    : await client.query<{ q: string }>(
        'SELECT quantity AS q FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3',
        [businessId, place.branchId, itemId]
      );
  return Number(r.rows[0]?.q) || 0;
}

/** Locks both stock rows in item-id order so a concurrent sale cannot deadlock with us. */
async function lockStock(client: PoolClient, businessId: string, place: Place, itemIds: string[]) {
  for (const id of [...itemIds].sort()) {
    if (place.warehouse) {
      await client.query('SELECT 1 FROM location_stock WHERE location_id = $1 AND item_id = $2 FOR UPDATE', [
        place.locationId,
        id,
      ]);
    } else {
      await client.query(
        'SELECT 1 FROM branch_item_stock WHERE business_id = $1 AND branch_id = $2 AND item_id = $3 FOR UPDATE',
        [businessId, place.branchId, id]
      );
    }
  }
}

async function moveStock(client: PoolClient, businessId: string, place: Place, itemId: string, delta: number) {
  if (place.warehouse) {
    await client.query(
      `INSERT INTO location_stock (location_id, item_id, current_stock_qty, last_updated)
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)
       ON CONFLICT (location_id, item_id)
       DO UPDATE SET current_stock_qty = location_stock.current_stock_qty + EXCLUDED.current_stock_qty,
                     last_updated = CURRENT_TIMESTAMP`,
      [place.locationId, itemId, delta]
    );
  } else {
    await adjustBranchItemStock(client, businessId, place.branchId!, itemId, delta);
    await refreshItemGlobalStockFromBranches(client, businessId, itemId);
  }
}

async function insertMovement(
  client: PoolClient,
  p: {
    businessId: string;
    itemId: string;
    locationId: string | null;
    quantity: number;
    referenceType: 'adjustment' | 'repack_cancel';
    referenceId: string;
    unitCost: number;
    notes: string;
    userId: string;
  }
) {
  await client.query(
    `INSERT INTO stock_movements (business_id, item_id, location_id, type, quantity, unit_cost,
                                  reference_type, reference_id, notes, created_by)
     VALUES ($1, $2, $3, 'adjustment', $4, $5, $6, $7, $8, $9)`,
    [p.businessId, p.itemId, p.locationId, p.quantity, round2(p.unitCost), p.referenceType, p.referenceId, p.notes, p.userId]
  );
}

interface ItemRow {
  id: string;
  name: string;
  unit: string | null;
  item_type: string | null;
  is_bundle: boolean | null;
  has_variants: boolean | null;
  deleted_at: string | null;
  purchase_price: string | null;
  current_stock: string | null;
  pack_source_item_id: string | null;
  pack_source_qty: string | null;
}

function checkRepackable(item: ItemRow | undefined, label: string): ItemRow {
  if (!item || item.deleted_at) throw new RepackError(`${label} not found`, 'ITEM_NOT_FOUND', 404);
  if ((item.item_type || 'goods') !== 'goods') {
    throw new RepackError(`${item.name} is a service; only goods can be repacked`, 'NOT_GOODS');
  }
  if (item.is_bundle) {
    throw new RepackError(
      `${item.name} is a bundle, so it has no stock of its own. Repack needs a counted item`,
      'IS_BUNDLE'
    );
  }
  if (item.has_variants) {
    throw new RepackError(`${item.name} has variants; repack does not support variants yet`, 'HAS_VARIANTS');
  }
  return item;
}

async function nextRepackNumber(client: PoolClient, businessId: string): Promise<string> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`repack:${businessId}`]);
  const r = await client.query<{ n: number }>(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(repack_number FROM '[0-9]+$') AS INTEGER)), 0) + 1 AS n
       FROM stock_repacks WHERE business_id = $1`,
    [businessId]
  );
  return `RPK-${String(r.rows[0].n).padStart(4, '0')}`;
}

async function adjustmentNumber(client: PoolClient, businessId: string): Promise<string> {
  const r = await client.query<{ number: string }>('SELECT generate_adjustment_number($1) AS number', [businessId]);
  return r.rows[0].number;
}

export async function createRepack(p: CreateRepackParams): Promise<RepackResult> {
  const sourceQty = round3(Number(p.sourceQty));
  const packedQty = round3(Number(p.packedQty));
  if (!(sourceQty > 0)) throw new RepackError('Enter how much you took out', 'SOURCE_QTY_REQUIRED');
  if (!(packedQty > 0)) throw new RepackError('Enter how many you packed', 'PACKED_QTY_REQUIRED');
  if (p.sourceItemId === p.packedItemId) {
    throw new RepackError('Pick a different item to pack into', 'SAME_ITEM');
  }
  if (p.wastageReason && !WASTAGE_REASONS.includes(p.wastageReason)) {
    throw new RepackError('Unknown wastage reason', 'BAD_WASTAGE_REASON');
  }

  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const place = await resolvePlace(client, p.businessId, p.branchId, p.locationId);

    const items = await client.query<ItemRow>(
      `SELECT id, name, unit, item_type, is_bundle, has_variants, deleted_at, purchase_price, current_stock,
              pack_source_item_id, pack_source_qty
         FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])
        ORDER BY id FOR UPDATE`,
      [p.businessId, [p.sourceItemId, p.packedItemId]]
    );
    const source = checkRepackable(items.rows.find((i) => i.id === p.sourceItemId), 'Source item');
    const packed = checkRepackable(items.rows.find((i) => i.id === p.packedItemId), 'Packed item');

    const saved = packed.pack_source_item_id === source.id ? Number(packed.pack_source_qty) || 0 : 0;
    const content = Number(p.contentPerUnit) > 0 ? Number(p.contentPerUnit) : saved;
    if (!(content > 0)) {
      throw new RepackError(
        `How much ${source.unit || 'of ' + source.name} goes into one ${packed.name}?`,
        'CONTENT_REQUIRED'
      );
    }
    const { wastage } = repackWastage(sourceQty, packedQty, content);
    if (wastage < 0) {
      throw new RepackError('Packed more than you took out; check the numbers', 'NEGATIVE_WASTAGE');
    }
    if (wastage > 0 && !p.wastageReason) {
      throw new RepackError('Pick a reason for the wastage', 'WASTAGE_REASON_REQUIRED');
    }

    await lockStock(client, p.businessId, place, [source.id, packed.id]);
    const sourceBefore = await stockAt(client, p.businessId, place, source.id);
    if (sourceBefore + 1e-9 < sourceQty) {
      throw new RepackError(
        `Only ${round3(sourceBefore)} ${source.unit || ''} of ${source.name} in stock here`.replace(/\s+/g, ' '),
        'INSUFFICIENT_STOCK'
      );
    }
    const packedBefore = await stockAt(client, p.businessId, place, packed.id);

    const repackNumber = await nextRepackNumber(client, p.businessId);
    const repack = await client.query<{ id: string }>(
      `INSERT INTO stock_repacks (business_id, repack_number, repack_date, branch_id, location_id,
         source_item_id, source_qty, packed_item_id, packed_qty, content_per_unit,
         wastage_qty, wastage_reason, wastage_notes, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id`,
      [
        p.businessId, repackNumber, p.repackDate, place.branchId, place.locationId,
        source.id, sourceQty, packed.id, packedQty, content,
        wastage, wastage > 0 ? p.wastageReason : null, wastage > 0 ? p.wastageNotes || null : null,
        p.notes || null, p.userId,
      ]
    );
    const repackId = repack.rows[0].id;

    const costs = await currentUnitCosts(client, p.businessId, [source.id, packed.id], p.repackDate, place.branchId);
    const sourceRate = costs.get(source.id) || Number(source.purchase_price) || 0;
    const packedRate = costs.get(packed.id) || Number(packed.purchase_price) || 0;

    const outNumber = await adjustmentNumber(client, p.businessId);
    const out = await client.query<{ id: string }>(
      `INSERT INTO inventory_adjustments (business_id, adjustment_number, adjustment_date, adjustment_type, direction,
         item_id, location_id, branch_id, quantity_change, quantity_before, quantity_after,
         unit_cost_before, unit_cost_after, total_value_before, total_value_after,
         reason_code, reason_notes, notes, gst_impact, created_by, repack_id)
       VALUES ($1, $2, $3, 'QUANTITY', 'DECREASE', $4, $5, $6, $7, $8, $9, $10, $10, $11, $12,
               'REPACK_OUT', $13, $14, 0, $15, $16)
       RETURNING id`,
      [
        p.businessId, outNumber, p.repackDate, source.id, place.locationId, place.branchId,
        -sourceQty, sourceBefore, round3(sourceBefore - sourceQty), round2(sourceRate),
        round2(sourceBefore * sourceRate), round2((sourceBefore - sourceQty) * sourceRate),
        `${repackNumber}: into ${packedQty} ${packed.name}`, p.notes || null, p.userId, repackId,
      ]
    );
    const outId = out.rows[0].id;

    let totalCost = round2(sourceQty * sourceRate);
    if ((await getValuationMethod(client, p.businessId)) === 'fifo') {
      totalCost = round2(
        await fifoCostForDocument(client, p.businessId, new Map([[source.id, sourceQty]]), {
          kind: 'adjustment_out',
          docId: outId,
        })
      );
    }
    const unitCost = packedQty > 0 ? totalCost / packedQty : 0;
    await client.query('UPDATE inventory_adjustments SET value_change = $1 WHERE id = $2', [-totalCost, outId]);

    const inNumber = await adjustmentNumber(client, p.businessId);
    const packedAfter = round3(packedBefore + packedQty);
    const blended = packedAfter > 0 ? (Math.max(packedBefore, 0) * packedRate + totalCost) / (Math.max(packedBefore, 0) + packedQty) : unitCost;
    const inn = await client.query<{ id: string }>(
      `INSERT INTO inventory_adjustments (business_id, adjustment_number, adjustment_date, adjustment_type, direction,
         item_id, location_id, branch_id, quantity_change, quantity_before, quantity_after,
         unit_cost_before, unit_cost_after, total_value_before, total_value_after, value_change,
         reason_code, reason_notes, notes, gst_impact, created_by, repack_id)
       VALUES ($1, $2, $3, 'QUANTITY', 'INCREASE', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
               'REPACK_IN', $15, $16, 0, $17, $18)
       RETURNING id`,
      [
        p.businessId, inNumber, p.repackDate, packed.id, place.locationId, place.branchId,
        packedQty, packedBefore, packedAfter, round2(packedRate), round2(blended),
        round2(packedBefore * packedRate), round2(packedBefore * packedRate + totalCost), totalCost,
        `${repackNumber}: from ${sourceQty} ${source.unit || ''} ${source.name}`.replace(/\s+/g, ' '),
        p.notes || null, p.userId, repackId,
      ]
    );
    const inId = inn.rows[0].id;

    await moveStock(client, p.businessId, place, source.id, -sourceQty);
    await moveStock(client, p.businessId, place, packed.id, packedQty);
    await insertMovement(client, {
      businessId: p.businessId, itemId: source.id, locationId: place.locationId, quantity: -sourceQty,
      referenceType: 'adjustment', referenceId: outId, unitCost: sourceQty > 0 ? totalCost / sourceQty : 0,
      notes: `Repack ${repackNumber}: ${sourceQty} into ${packedQty} ${packed.name}`, userId: p.userId,
    });
    await insertMovement(client, {
      businessId: p.businessId, itemId: packed.id, locationId: place.locationId, quantity: packedQty,
      referenceType: 'adjustment', referenceId: inId, unitCost,
      notes: `Repack ${repackNumber}: ${packedQty} from ${sourceQty} ${source.name}`, userId: p.userId,
    });

    await client.query(
      `UPDATE stock_repacks SET total_cost = $1, out_adjustment_id = $2, in_adjustment_id = $3 WHERE id = $4`,
      [totalCost, outId, inId, repackId]
    );
    // Weighted-average and simple shops cost sales from purchase_price; FIFO keeps it as the fallback rate.
    await client.query(
      `UPDATE items SET purchase_price = $1,
              pack_source_item_id = $2, pack_source_qty = $3, updated_at = CURRENT_TIMESTAMP
        WHERE id = $4 AND business_id = $5`,
      [round2(blended), source.id, content, packed.id, p.businessId]
    );

    await recostAfterStockChange(client, p.businessId, [source.id, packed.id]);
    await client.query('COMMIT');
    return { id: repackId, repackNumber, wastageQty: wastage, totalCost, unitCost: round2(unitCost) };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Puts both items back; refused when the packets have already gone. */
export async function cancelRepack(businessId: string, userId: string, repackId: string): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const r = await client.query<{
      repack_number: string; status: string; branch_id: string | null; location_id: string | null;
      source_item_id: string; source_qty: string; packed_item_id: string; packed_qty: string;
      total_cost: string; packed_name: string; source_name: string; packed_unit: string | null;
    }>(
      `SELECT r.repack_number, r.status, r.branch_id, r.location_id, r.source_item_id, r.source_qty,
              r.packed_item_id, r.packed_qty, r.total_cost, pi.name AS packed_name, si.name AS source_name,
              pi.unit AS packed_unit
         FROM stock_repacks r
         JOIN items pi ON pi.id = r.packed_item_id
         JOIN items si ON si.id = r.source_item_id
        WHERE r.id = $1 AND r.business_id = $2
        FOR UPDATE OF r`,
      [repackId, businessId]
    );
    const row = r.rows[0];
    if (!row) throw new RepackError('Repack not found', 'NOT_FOUND', 404);
    if (row.status === 'cancelled') throw new RepackError('This repack is already cancelled', 'ALREADY_CANCELLED', 409);

    const place: Place = { warehouse: !!row.location_id, branchId: row.branch_id, locationId: row.location_id };
    const sourceQty = Number(row.source_qty);
    const packedQty = Number(row.packed_qty);
    const totalCost = Number(row.total_cost) || 0;
    await client.query('SELECT 1 FROM items WHERE business_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE', [
      businessId,
      [row.source_item_id, row.packed_item_id],
    ]);
    await lockStock(client, businessId, place, [row.source_item_id, row.packed_item_id]);
    const packedNow = await stockAt(client, businessId, place, row.packed_item_id);
    if (packedNow + 1e-9 < packedQty) {
      throw new RepackError(
        `Only ${round3(packedNow)} of ${row.packed_name} left here, so this repack can't be undone. Use a stock adjustment instead`,
        'PACKED_STOCK_SHORT',
        409
      );
    }

    await moveStock(client, businessId, place, row.packed_item_id, -packedQty);
    await moveStock(client, businessId, place, row.source_item_id, sourceQty);
    const note = `Repack ${row.repack_number} cancelled`;
    await insertMovement(client, {
      businessId, itemId: row.packed_item_id, locationId: place.locationId, quantity: -packedQty,
      referenceType: 'repack_cancel', referenceId: repackId, unitCost: packedQty ? totalCost / packedQty : 0,
      notes: note, userId,
    });
    await insertMovement(client, {
      businessId, itemId: row.source_item_id, locationId: place.locationId, quantity: sourceQty,
      referenceType: 'repack_cancel', referenceId: repackId, unitCost: sourceQty ? totalCost / sourceQty : 0,
      notes: note, userId,
    });
    await client.query(
      `UPDATE stock_repacks SET status = 'cancelled', cancelled_by = $1, cancelled_at = CURRENT_TIMESTAMP
        WHERE id = $2 AND business_id = $3`,
      [userId, repackId, businessId]
    );
    await recostAfterStockChange(client, businessId, [row.source_item_id, row.packed_item_id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export interface RepackDetail {
  id: string;
  repack_number: string;
  repack_date: string;
  status: 'posted' | 'cancelled';
  branch_id: string | null;
  branch_name: string | null;
  location_id: string | null;
  location_name: string | null;
  source_item_id: string;
  source_name: string;
  source_unit: string | null;
  source_qty: number;
  packed_item_id: string;
  packed_name: string;
  packed_unit: string | null;
  packed_qty: number;
  content_per_unit: number;
  wastage_qty: number;
  wastage_reason: WastageReason | null;
  wastage_notes: string | null;
  notes: string | null;
  total_cost: number;
  unit_cost: number;
  created_by_name: string | null;
  created_at: string;
  cancelled_at: string | null;
}

export const REPACK_SELECT = `
  SELECT r.id, r.repack_number, to_char(r.repack_date, 'YYYY-MM-DD') AS repack_date, r.status,
         r.branch_id, b.name AS branch_name, r.location_id, w.name AS location_name,
         r.source_item_id, si.name AS source_name, si.unit AS source_unit, r.source_qty::float AS source_qty,
         r.packed_item_id, pi.name AS packed_name, pi.unit AS packed_unit, r.packed_qty::float AS packed_qty,
         r.content_per_unit::float AS content_per_unit, r.wastage_qty::float AS wastage_qty,
         r.wastage_reason, r.wastage_notes, r.notes, r.total_cost::float AS total_cost,
         ROUND(r.total_cost / NULLIF(r.packed_qty, 0), 2)::float AS unit_cost,
         u.name AS created_by_name, r.created_at, r.cancelled_at
    FROM stock_repacks r
    JOIN items si ON si.id = r.source_item_id
    JOIN items pi ON pi.id = r.packed_item_id
    LEFT JOIN branches b ON b.id = r.branch_id
    LEFT JOIN warehouses w ON w.id = r.location_id
    LEFT JOIN users u ON u.id = r.created_by`;

export async function getRepack(businessId: string, id: string): Promise<RepackDetail | null> {
  return queryOne<RepackDetail>(`${REPACK_SELECT} WHERE r.id = $1 AND r.business_id = $2`, [id, businessId]);
}
