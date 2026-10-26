import type { PoolClient } from 'pg';
import { GodownStockError, resolveGodown } from '@/lib/inventory/godown-stock';
import { createQuantityAdjustmentOn } from '@/lib/inventory-adjustment-service';
import { ensureInventoryClassAccounts } from '@/lib/inventory/stock-class';

/**
 * Manufacturing in one godown. A bill of materials (BOM) says what one batch of an item uses
 * and yields. A production entry issues the inputs into Work in progress (1161) at their cost
 * (FIFO or average), takes by-products and scrap out of WIP at their recovery value, and
 * receives the output at what is left, so WIP nets to zero and the finished goods carry the
 * full input cost. Each step is an inventory adjustment, so stock, FIFO lots and the ledger move
 * together; the stock movements point at the production entry.
 */

type Queryable = Pick<PoolClient, 'query'>;
const q3 = (n: unknown) => Math.round((Number(n) || 0) * 1000) / 1000;
const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BomLineInput {
  item_id: string;
  role: 'input' | 'byproduct' | 'scrap';
  qty: number;
  recovery_rate?: number;
}

export async function saveBom(
  client: PoolClient,
  businessId: string,
  input: { id?: string | null; name: string; output_item_id: string; output_qty: number; lines: BomLineInput[]; notes?: string | null; is_active?: boolean },
  userId: string | null
): Promise<string> {
  const name = String(input.name || '').trim();
  if (!name) throw new GodownStockError('Name the bill of materials');
  const outQty = q3(input.output_qty);
  if (outQty <= 0) throw new GodownStockError('Output quantity must be more than zero');
  const lines = (input.lines || []).filter((l) => q3(l.qty) > 0);
  if (!lines.some((l) => l.role === 'input')) throw new GodownStockError('Add at least one input');
  const ids = [input.output_item_id, ...lines.map((l) => l.item_id)];
  const found = await client.query(`SELECT id FROM items WHERE business_id = $1 AND id = ANY($2::uuid[]) AND COALESCE(item_type, 'goods') = 'goods'`, [businessId, ids]);
  if (new Set(found.rows.map((r: any) => r.id)).size !== new Set(ids).size) throw new GodownStockError('Every item must be a goods item of this business', 404);
  if (lines.some((l) => l.item_id === input.output_item_id && l.role === 'input')) throw new GodownStockError('An item cannot be an input to itself');

  let id = input.id || null;
  if (id) {
    const u = await client.query(
      `UPDATE boms SET name = $3, output_item_id = $4, output_qty = $5, notes = $6, is_active = $7, updated_at = NOW()
        WHERE id = $1 AND business_id = $2 RETURNING id`,
      [id, businessId, name, input.output_item_id, outQty, input.notes || null, input.is_active !== false]
    );
    if (!u.rows[0]) throw new GodownStockError('Bill of materials not found', 404);
    await client.query(`DELETE FROM bom_lines WHERE bom_id = $1`, [id]);
  } else {
    id = (
      await client.query(
        `INSERT INTO boms (business_id, name, output_item_id, output_qty, notes, is_active, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [businessId, name, input.output_item_id, outQty, input.notes || null, input.is_active !== false, userId]
      )
    ).rows[0].id;
  }
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const role = l.role === 'byproduct' || l.role === 'scrap' ? l.role : 'input';
    await client.query(
      `INSERT INTO bom_lines (bom_id, item_id, role, qty, recovery_rate, sort_order) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, l.item_id, role, q3(l.qty), role === 'input' ? 0 : Math.max(0, Number(l.recovery_rate) || 0), i]
    );
  }
  return id as string;
}

export async function listBoms(db: Queryable, businessId: string): Promise<any[]> {
  const r = await db.query(
    `SELECT b.*, i.name AS output_item_name, i.unit AS output_unit,
            COALESCE((SELECT json_agg(json_build_object('id', l.id, 'item_id', l.item_id, 'item_name', li.name, 'unit', li.unit,
                        'role', l.role, 'qty', l.qty, 'recovery_rate', l.recovery_rate) ORDER BY l.sort_order)
                        FROM bom_lines l JOIN items li ON li.id = l.item_id WHERE l.bom_id = b.id), '[]') AS lines
       FROM boms b JOIN items i ON i.id = b.output_item_id
      WHERE b.business_id = $1 ORDER BY b.is_active DESC, b.name`,
    [businessId]
  );
  return r.rows;
}

export interface ProductionInput {
  date: string;
  warehouseId?: string | null;
  branchId?: string | null;
  bomId?: string | null;
  /** Batches of the BOM to make; lines scale from it. Ignored when lines are given. */
  batches?: number;
  outputItemId?: string;
  outputQty?: number;
  /** Actual quantities, when they differ from the BOM. */
  lines?: Array<{ item_id: string; role: 'input' | 'byproduct' | 'scrap'; qty: number; recovery_rate?: number }>;
  notes?: string | null;
}

export async function postProduction(client: PoolClient, businessId: string, input: ProductionInput, userId: string | null) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date || '')) throw new GodownStockError('Production date is required');
  const godown = await resolveGodown(client, businessId, { warehouseId: input.warehouseId, branchId: input.branchId });
  await ensureInventoryClassAccounts(client, businessId);

  let outputItemId = input.outputItemId || null;
  let outputQty = q3(input.outputQty);
  let lines = input.lines || [];
  if (input.bomId) {
    const b = (await listBoms(client, businessId)).find((x) => x.id === input.bomId);
    if (!b) throw new GodownStockError('Bill of materials not found', 404);
    const batches = Math.max(0, Number(input.batches) || 1);
    outputItemId = outputItemId || b.output_item_id;
    if (!outputQty) outputQty = q3(Number(b.output_qty) * batches);
    if (!lines.length) {
      lines = b.lines.map((l: any) => ({ item_id: l.item_id, role: l.role, qty: q3(Number(l.qty) * batches), recovery_rate: Number(l.recovery_rate) }));
    }
  }
  if (!outputItemId || outputQty <= 0) throw new GodownStockError('Choose what is produced and how much');
  lines = lines.filter((l) => q3(l.qty) > 0);
  if (!lines.some((l) => l.role === 'input')) throw new GodownStockError('Production needs at least one input');
  const out = await client.query(`SELECT id, name FROM items WHERE id = $1 AND business_id = $2`, [outputItemId, businessId]);
  if (!out.rows[0]) throw new GodownStockError('Output item not found', 404);

  await client.query(`SELECT pg_advisory_xact_lock(hashtext('production:' || $1::text))`, [businessId]);
  const n = await client.query(`SELECT COUNT(*)::int + 1 AS n FROM production_entries WHERE business_id = $1`, [businessId]);
  const number = `PRD-${String(n.rows[0].n).padStart(4, '0')}`;
  const entry = await client.query(
    `INSERT INTO production_entries (business_id, entry_number, entry_date, bom_id, warehouse_id, branch_id, output_item_id, output_qty, notes, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
    [businessId, number, input.date, input.bomId || null, godown.warehouseId, godown.branchId, outputItemId, outputQty, input.notes || null, userId]
  );
  const productionId = entry.rows[0].id as string;
  const common = {
    businessId,
    locationId: godown.warehouseId,
    branchId: godown.branchId,
    adjustmentDate: input.date,
    createdBy: userId ?? undefined,
    movementReference: { type: 'production', id: productionId },
  };
  const valueOf = async (adjustmentId: string) =>
    Math.abs(Number((await client.query(`SELECT value_change FROM inventory_adjustments WHERE id = $1`, [adjustmentId])).rows[0]?.value_change) || 0);
  const record = (itemId: string, role: string, qty: number, value: number, adjustmentId: string) =>
    client.query(`INSERT INTO production_lines (production_id, item_id, role, qty, value, adjustment_id) VALUES ($1,$2,$3,$4,$5,$6)`, [
      productionId, itemId, role, qty, r2(value), adjustmentId,
    ]);

  // 1. Inputs leave stock into work in progress at their cost.
  let inputCost = 0;
  for (const l of lines.filter((x) => x.role === 'input')) {
    const qty = q3(l.qty);
    let adj;
    try {
      adj = await createQuantityAdjustmentOn(client, {
        ...common,
        itemId: l.item_id,
        direction: 'DECREASE',
        quantity: qty,
        reasonCode: 'PRODUCTION_ISSUE',
        reasonNotes: `Issued to production ${number}`,
      });
    } catch (e: any) {
      if (/below zero/i.test(String(e?.message))) {
        const name = (await client.query(`SELECT name FROM items WHERE id = $1`, [l.item_id])).rows[0]?.name || 'An input';
        throw new GodownStockError(`${name}: not enough stock in the godown for this production.`, 409, 'INSUFFICIENT_STOCK');
      }
      throw e;
    }
    const v = await valueOf(adj.adjustmentId);
    inputCost = r2(inputCost + v);
    await record(l.item_id, 'input', qty, v, adj.adjustmentId);
  }

  // 2. By-products and scrap come out of WIP at what they will fetch.
  let recovery = 0;
  for (const l of lines.filter((x) => x.role === 'byproduct' || x.role === 'scrap')) {
    const qty = q3(l.qty);
    const rate = Math.max(0, Number(l.recovery_rate) || 0);
    const adj = await createQuantityAdjustmentOn(client, {
      ...common,
      itemId: l.item_id,
      direction: 'INCREASE',
      quantity: qty,
      reasonCode: 'BY_PRODUCT',
      reasonNotes: `${l.role === 'scrap' ? 'Scrap' : 'By-product'} of production ${number}`,
      unitCostOverride: rate,
    });
    const v = await valueOf(adj.adjustmentId);
    recovery = r2(recovery + v);
    await record(l.item_id, l.role, qty, v, adj.adjustmentId);
  }
  if (recovery > inputCost) throw new GodownStockError('By-products and scrap are valued above the inputs; lower their recovery rate.');

  // 3. The output takes what is left in WIP.
  const outputCost = r2(inputCost - recovery);
  const outAdj = await createQuantityAdjustmentOn(client, {
    ...common,
    itemId: outputItemId,
    direction: 'INCREASE',
    quantity: outputQty,
    reasonCode: 'PRODUCTION_RECEIPT',
    reasonNotes: `Produced in ${number}`,
    unitCostOverride: outputCost / outputQty,
  });
  // Unit cost is rounded to 4 places; book the exact remainder so WIP clears.
  const booked = await valueOf(outAdj.adjustmentId);
  await record(outputItemId, 'output', outputQty, booked, outAdj.adjustmentId);
  await client.query(
    `UPDATE production_entries SET input_cost = $2, recovery_value = $3, output_cost = $4 WHERE id = $1`,
    [productionId, inputCost, recovery, booked]
  );
  return { id: productionId, number, input_cost: inputCost, recovery_value: recovery, output_cost: booked, output_unit_cost: Math.round((booked / outputQty) * 100) / 100 };
}

export async function listProduction(db: Queryable, businessId: string): Promise<any[]> {
  const r = await db.query(
    `SELECT p.*, p.entry_date::text AS entry_date, i.name AS output_item_name, w.name AS warehouse_name,
            COALESCE((SELECT json_agg(json_build_object('item_name', li.name, 'role', l.role, 'qty', l.qty, 'value', l.value))
                        FROM production_lines l JOIN items li ON li.id = l.item_id WHERE l.production_id = p.id), '[]') AS lines
       FROM production_entries p JOIN items i ON i.id = p.output_item_id LEFT JOIN warehouses w ON w.id = p.warehouse_id
      WHERE p.business_id = $1 ORDER BY p.entry_date DESC, p.entry_number DESC LIMIT 200`,
    [businessId]
  );
  return r.rows;
}
