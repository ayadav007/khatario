/**
 * Closing Stock — financial-year snapshots with FIFO / weighted average / last purchase,
 * normalized headers + lines, legacy table sync for COGS and existing integrations.
 */

import type { PoolClient } from 'pg';
import { queryRows, queryOne, getPool } from '@/lib/db';
import { hasClosingStockV2Schema } from '@/lib/closing-stock-schema';

export type LegacyValuationMethod = 'fifo' | 'lifo' | 'weighted_avg' | 'simple' | 'last_purchase';
export type ClosingValuationMethod = 'fifo' | 'weighted_avg' | 'last_purchase';

export interface ClosingStockSnapshot {
  item_id: string;
  item_name: string;
  variant_id?: string;
  location_id?: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  valuation_method: LegacyValuationMethod;
  batch_id?: string;
  last_purchase_date?: string | null;
}

export interface ClosingStockSummary {
  financial_year_id: string;
  financial_year: string;
  total_items: number;
  total_quantity: number;
  total_value: number;
  snapshot_date: string;
  is_finalized?: boolean;
  valuation_method?: ClosingValuationMethod | string;
  snapshot_header_id?: string | null;
  is_locked?: boolean;
}

export interface ClosingStockHistoryRow {
  id: string;
  financial_year: string;
  snapshot_date: string;
  total_value: number;
  is_locked: boolean;
  valuation_method: string;
  total_items: number;
  total_quantity: number;
}

export interface ClosingStockComparisonRow {
  item_id: string;
  item_name: string;
  previous_quantity: number;
  current_quantity: number;
  quantity_delta: number;
  previous_value: number;
  current_value: number;
  value_delta: number;
}

/** Quantities as-of date using live stock minus movements after as-of (goods, active). */
async function loadQuantitiesAsOf(
  client: PoolClient,
  businessId: string,
  asOfDate: string
): Promise<Map<string, { name: string; quantity: number }>> {
  const res = await client.query(
    `SELECT
       i.id AS item_id,
       i.name AS item_name,
       COALESCE(i.current_stock, 0)::float AS current_stock,
       COALESCE((
         SELECT SUM(
           CASE
             WHEN sm.type = 'in' THEN sm.quantity
             WHEN sm.type = 'out' THEN -sm.quantity
             WHEN sm.type = 'adjustment' THEN sm.quantity
             ELSE 0
           END
         )
         FROM stock_movements sm
         WHERE sm.business_id = $1
           AND sm.item_id = i.id
           AND sm.created_at::date > $2::date
       ), 0)::float AS movements_after_asof
     FROM items i
     WHERE i.business_id = $1
       AND i.item_type = 'goods'
       AND i.is_active = true`,
    [businessId, asOfDate]
  );

  const m = new Map<string, { name: string; quantity: number }>();
  for (const r of res.rows) {
    const q = Number(r.current_stock ?? 0) - Number(r.movements_after_asof ?? 0);
    if (q > 0) {
      m.set(r.item_id, { name: r.item_name, quantity: q });
    }
  }
  return m;
}

async function lastPurchaseUnit(
  client: PoolClient,
  itemId: string,
  businessId: string,
  asOfDate: string
): Promise<{ unitCost: number; purchaseDate: string | null }> {
  const row = await client.query(
    `SELECT p.bill_date::date AS d,
            CASE
              WHEN pi.quantity::numeric > 0 THEN (pi.taxable_value::numeric / pi.quantity::numeric)
              ELSE COALESCE(pi.unit_price::numeric, 0)
            END AS unit_cost
     FROM purchase_items pi
     INNER JOIN purchases p ON p.id = pi.purchase_id
     WHERE pi.item_id = $1
       AND p.business_id = $2
       AND p.status != 'cancelled'
       AND p.bill_date <= $3::date
       AND pi.item_id IS NOT NULL
     ORDER BY p.bill_date DESC, p.created_at DESC
     LIMIT 1`,
    [itemId, businessId, asOfDate]
  );
  if (!row.rows[0]) {
    const item = await client.query(
      `SELECT purchase_price::float AS pp FROM items WHERE id = $1 AND business_id = $2`,
      [itemId, businessId]
    );
    const pp = parseFloat(item.rows[0]?.pp ?? '0');
    return { unitCost: pp, purchaseDate: null };
  }
  const d = row.rows[0].d;
  return {
    unitCost: parseFloat(row.rows[0].unit_cost ?? '0'),
    purchaseDate: d instanceof Date ? d.toISOString().slice(0, 10) : String(d).slice(0, 10),
  };
}

async function weightedAvgUnit(
  client: PoolClient,
  itemId: string,
  businessId: string,
  asOfDate: string
): Promise<number> {
  const row = await client.query(
    `SELECT
       SUM(pi.taxable_value)::numeric / NULLIF(SUM(pi.quantity), 0)::numeric AS rate
     FROM purchase_items pi
     INNER JOIN purchases p ON p.id = pi.purchase_id
     WHERE pi.item_id = $1
       AND p.business_id = $2
       AND p.status != 'cancelled'
       AND p.bill_date <= $3::date
       AND pi.quantity > 0`,
    [itemId, businessId, asOfDate]
  );
  const rate = row.rows[0]?.rate != null ? parseFloat(row.rows[0].rate) : 0;
  if (rate > 0) return rate;
  const item = await client.query(
    `SELECT purchase_price::float AS pp FROM items WHERE id = $1 AND business_id = $2`,
    [itemId, businessId]
  );
  return parseFloat(item.rows[0]?.pp ?? '0');
}

/** FIFO layers from purchase lines (oldest first), taxable_value / qty as unit cost. */
async function fifoValueForQty(
  client: PoolClient,
  itemId: string,
  businessId: string,
  asOfDate: string,
  qtyNeeded: number
): Promise<{ totalCost: number; unitCost: number; lastPurchaseDate: string | null }> {
  const rows = await client.query(
    `SELECT pi.quantity::numeric AS q,
            pi.taxable_value::numeric AS tv,
            p.bill_date::date AS bd
     FROM purchase_items pi
     INNER JOIN purchases p ON p.id = pi.purchase_id
     WHERE pi.item_id = $1
       AND p.business_id = $2
       AND p.status != 'cancelled'
       AND p.bill_date <= $3::date
       AND pi.quantity > 0
     ORDER BY p.bill_date ASC, p.created_at ASC`,
    [itemId, businessId, asOfDate]
  );

  let remaining = qtyNeeded;
  let totalCost = 0;
  let lastDate: string | null = null;

  for (const r of rows.rows) {
    if (remaining <= 0) break;
    const lineQty = parseFloat(r.q);
    const tv = parseFloat(r.tv);
    const unit = lineQty > 0 ? tv / lineQty : 0;
    const take = Math.min(remaining, lineQty);
    totalCost += take * unit;
    remaining -= take;
    const bd = r.bd;
    lastDate = bd instanceof Date ? bd.toISOString().slice(0, 10) : String(bd).slice(0, 10);
  }

  if (remaining > 0) {
    const item = await client.query(
      `SELECT purchase_price::float AS pp FROM items WHERE id = $1 AND business_id = $2`,
      [itemId, businessId]
    );
    const pp = parseFloat(item.rows[0]?.pp ?? '0');
    totalCost += remaining * pp;
  }

  const unitCost = qtyNeeded > 0 ? totalCost / qtyNeeded : 0;
  return { totalCost, unitCost, lastPurchaseDate: lastDate };
}

function mapMethodToLegacy(m: ClosingValuationMethod): LegacyValuationMethod {
  return m === 'last_purchase' ? 'last_purchase' : m;
}

/** Legacy UI + pagination when migration 174 is not applied. */
async function getLegacyClosingStockView(
  businessId: string,
  financialYear: string,
  page: number,
  limit: number,
  search: string,
  sort: string
): Promise<{
  summary: ClosingStockSummary | null;
  snapshots: ClosingStockSnapshot[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}> {
  const summary = await queryOne<ClosingStockSummary & { valuation_method_used?: string; snapshot_header_id?: string }>(
    `SELECT * FROM closing_stock_summary
     WHERE business_id = $1 AND financial_year = $2`,
    [businessId, financialYear]
  );

  const snaps = await queryRows<ClosingStockSnapshot & { last_purchase_date?: null }>(
    `SELECT css.item_id, i.name as item_name, css.variant_id, css.location_id,
            css.quantity, css.unit_cost, css.total_value, css.valuation_method, css.batch_id
     FROM closing_stock_snapshots css
     JOIN items i ON css.item_id = i.id
     WHERE css.business_id = $1 AND css.financial_year = $2`,
    [businessId, financialYear]
  );

  let rows = snaps.map((s) => ({
    item_id: s.item_id,
    item_name: s.item_name,
    variant_id: s.variant_id,
    location_id: s.location_id,
    quantity: parseFloat(s.quantity?.toString() || '0'),
    unit_cost: parseFloat(s.unit_cost?.toString() || '0'),
    total_value: parseFloat(s.total_value?.toString() || '0'),
    valuation_method: s.valuation_method as LegacyValuationMethod,
    batch_id: s.batch_id,
    last_purchase_date: null as string | null,
  }));

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter((r) => (r.item_name || '').toLowerCase().includes(q));
  }

  rows.sort((a, b) => {
    if (sort === 'value') return b.total_value - a.total_value;
    if (sort === 'qty') return b.quantity - a.quantity;
    return (a.item_name || '').localeCompare(b.item_name || '');
  });

  const total = rows.length;
  const start = (page - 1) * limit;
  const pageRows = rows.slice(start, start + limit);

  return {
    summary: summary
      ? {
          ...summary,
          total_quantity: parseFloat(summary.total_quantity?.toString() || '0'),
          total_value: parseFloat(summary.total_value?.toString() || '0'),
          is_finalized: summary.is_finalized,
          valuation_method: summary.valuation_method_used,
          snapshot_header_id: summary.snapshot_header_id ?? null,
          is_locked: false,
        }
      : null,
    snapshots: pageRows,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

/**
 * Create closing stock snapshot (new headers + items + legacy sync).
 */
export async function createClosingStockSnapshot(
  businessId: string,
  financialYearId: string,
  financialYear: string,
  snapshotDate: string,
  valuationMethod: ClosingValuationMethod,
  userId: string | null,
  locationId?: string,
  branchId?: string | null
): Promise<ClosingStockSummary> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    let itemLines: Array<{
      itemId: string;
      name: string;
      quantity: number;
      unitCost: number;
      totalValue: number;
      lastPurchaseDate: string | null;
    }> = [];

    if (locationId || branchId) {
      let itemsQuery = '';
      const itemsParams: unknown[] = [businessId];
      if (locationId) {
        itemsQuery = `
          SELECT i.id, i.name, ls.current_stock_qty AS current_stock
          FROM items i
          JOIN location_stock ls ON i.id = ls.item_id
          WHERE i.business_id = $1 AND ls.location_id = $2
            AND i.item_type = 'goods' AND i.is_active = true
            AND ls.current_stock_qty > 0`;
        itemsParams.push(locationId);
      } else {
        itemsQuery = `
          SELECT i.id, i.name, COALESCE(bis.quantity, 0) AS current_stock
          FROM items i
          INNER JOIN branch_item_stock bis
            ON bis.item_id = i.id AND bis.business_id = i.business_id AND bis.branch_id = $2::uuid
          WHERE i.business_id = $1
            AND i.item_type = 'goods' AND i.is_active = true AND bis.quantity > 0`;
        itemsParams.push(branchId);
      }
      const items = await client.query(itemsQuery, itemsParams);
      for (const item of items.rows) {
        const quantity = parseFloat(item.current_stock || 0);
        if (quantity <= 0) continue;
        let unitCost = 0;
        let totalValue = 0;
        let lastPurchaseDate: string | null = null;

        if (valuationMethod === 'last_purchase') {
          const lp = await lastPurchaseUnit(client, item.id, businessId, snapshotDate);
          unitCost = lp.unitCost;
          lastPurchaseDate = lp.purchaseDate;
          totalValue = quantity * unitCost;
        } else if (valuationMethod === 'weighted_avg') {
          unitCost = await weightedAvgUnit(client, item.id, businessId, snapshotDate);
          totalValue = quantity * unitCost;
          const lp = await lastPurchaseUnit(client, item.id, businessId, snapshotDate);
          lastPurchaseDate = lp.purchaseDate;
        } else {
          const fv = await fifoValueForQty(client, item.id, businessId, snapshotDate, quantity);
          unitCost = fv.unitCost;
          totalValue = fv.totalCost;
          lastPurchaseDate = fv.lastPurchaseDate;
        }

        itemLines.push({
          itemId: item.id,
          name: item.name,
          quantity,
          unitCost,
          totalValue,
          lastPurchaseDate,
        });
      }
    } else {
      const qtyMap = await loadQuantitiesAsOf(client, businessId, snapshotDate);
      for (const [itemId, { name, quantity }] of qtyMap) {
        let unitCost = 0;
        let totalValue = 0;
        let lastPurchaseDate: string | null = null;

        if (valuationMethod === 'last_purchase') {
          const lp = await lastPurchaseUnit(client, itemId, businessId, snapshotDate);
          unitCost = lp.unitCost;
          lastPurchaseDate = lp.purchaseDate;
          totalValue = quantity * unitCost;
        } else if (valuationMethod === 'weighted_avg') {
          unitCost = await weightedAvgUnit(client, itemId, businessId, snapshotDate);
          totalValue = quantity * unitCost;
          const lp = await lastPurchaseUnit(client, itemId, businessId, snapshotDate);
          lastPurchaseDate = lp.purchaseDate;
        } else {
          const fv = await fifoValueForQty(client, itemId, businessId, snapshotDate, quantity);
          unitCost = fv.unitCost;
          totalValue = fv.totalCost;
          lastPurchaseDate = fv.lastPurchaseDate;
        }

        itemLines.push({
          itemId,
          name,
          quantity,
          unitCost,
          totalValue,
          lastPurchaseDate,
        });
      }
    }

    let totalItems = 0;
    let totalQuantity = 0;
    let totalValue = 0;
    for (const line of itemLines) {
      totalItems++;
      totalQuantity += line.quantity;
      totalValue += line.totalValue;
    }

    if (!(await hasClosingStockV2Schema())) {
      const legacyMethod = mapMethodToLegacy(valuationMethod);
      await client.query(
        `DELETE FROM closing_stock_snapshots
         WHERE business_id = $1 AND financial_year = $2`,
        [businessId, financialYear]
      );
      for (const line of itemLines) {
        await client.query(
          `INSERT INTO closing_stock_snapshots (
            business_id, financial_year_id, financial_year, snapshot_date,
            item_id, location_id, quantity, unit_cost, total_value, valuation_method, created_by
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            businessId,
            financialYearId,
            financialYear,
            snapshotDate,
            line.itemId,
            locationId || null,
            line.quantity,
            line.unitCost,
            line.totalValue,
            legacyMethod,
            userId,
          ]
        );
      }
      await client.query(
        `INSERT INTO closing_stock_summary (
          business_id, financial_year_id, financial_year, total_items, total_quantity,
          total_value, snapshot_date, valuation_method_used, is_finalized
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false)
        ON CONFLICT (business_id, financial_year_id)
        DO UPDATE SET
          total_items = EXCLUDED.total_items,
          total_quantity = EXCLUDED.total_quantity,
          total_value = EXCLUDED.total_value,
          snapshot_date = EXCLUDED.snapshot_date,
          valuation_method_used = EXCLUDED.valuation_method_used,
          is_finalized = false`,
        [
          businessId,
          financialYearId,
          financialYear,
          totalItems,
          totalQuantity,
          totalValue,
          snapshotDate,
          valuationMethod,
        ]
      );
      await client.query('COMMIT');
      return {
        financial_year_id: financialYearId,
        financial_year: financialYear,
        total_items: totalItems,
        total_quantity: totalQuantity,
        total_value: totalValue,
        snapshot_date: snapshotDate,
        is_finalized: false,
        valuation_method: valuationMethod,
        snapshot_header_id: null,
        is_locked: false,
      };
    }

    const headerRes = await client.query(
      `INSERT INTO closing_stock_snapshot_headers (
        business_id, financial_year_id, financial_year, snapshot_date,
        valuation_method, total_value, total_items, total_quantity, is_locked, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true, $9)
      RETURNING id`,
      [
        businessId,
        financialYearId,
        financialYear,
        snapshotDate,
        valuationMethod,
        totalValue,
        totalItems,
        totalQuantity,
        userId,
      ]
    );
    const snapshotHeaderId = headerRes.rows[0].id as string;

    for (const line of itemLines) {
      await client.query(
        `INSERT INTO closing_stock_snapshot_items (
          snapshot_id, item_id, quantity, valuation_price, total_value, last_purchase_date
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          snapshotHeaderId,
          line.itemId,
          line.quantity,
          line.unitCost,
          line.totalValue,
          line.lastPurchaseDate,
        ]
      );
    }

    const legacyMethod = mapMethodToLegacy(valuationMethod);
    await client.query(
      `DELETE FROM closing_stock_snapshots
       WHERE business_id = $1 AND financial_year = $2`,
      [businessId, financialYear]
    );

    for (const line of itemLines) {
      await client.query(
        `INSERT INTO closing_stock_snapshots (
          business_id, financial_year_id, financial_year, snapshot_date,
          item_id, location_id, quantity, unit_cost, total_value, valuation_method, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          businessId,
          financialYearId,
          financialYear,
          snapshotDate,
          line.itemId,
          locationId || null,
          line.quantity,
          line.unitCost,
          line.totalValue,
          legacyMethod,
          userId,
        ]
      );
    }

    await client.query(
      `INSERT INTO closing_stock_summary (
        business_id, financial_year_id, financial_year, total_items, total_quantity,
        total_value, snapshot_date, valuation_method_used, is_finalized, snapshot_header_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
      ON CONFLICT (business_id, financial_year_id)
      DO UPDATE SET
        total_items = EXCLUDED.total_items,
        total_quantity = EXCLUDED.total_quantity,
        total_value = EXCLUDED.total_value,
        snapshot_date = EXCLUDED.snapshot_date,
        valuation_method_used = EXCLUDED.valuation_method_used,
        snapshot_header_id = EXCLUDED.snapshot_header_id,
        is_finalized = false`,
      [
        businessId,
        financialYearId,
        financialYear,
        totalItems,
        totalQuantity,
        totalValue,
        snapshotDate,
        valuationMethod,
        snapshotHeaderId,
      ]
    );

    await client.query('COMMIT');

    return {
      financial_year_id: financialYearId,
      financial_year: financialYear,
      total_items: totalItems,
      total_quantity: totalQuantity,
      total_value: totalValue,
      snapshot_date: snapshotDate,
      is_finalized: false,
      valuation_method: valuationMethod,
      snapshot_header_id: snapshotHeaderId,
      is_locked: true,
    };
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

export async function listClosingStockHistory(businessId: string): Promise<ClosingStockHistoryRow[]> {
  if (await hasClosingStockV2Schema()) {
    return queryRows<ClosingStockHistoryRow>(
      `SELECT id, financial_year, snapshot_date::text, total_value::float AS total_value,
              is_locked, valuation_method, total_items, total_quantity::float AS total_quantity
       FROM closing_stock_snapshot_headers
       WHERE business_id = $1
       ORDER BY snapshot_date DESC, created_at DESC`,
      [businessId]
    );
  }

  return queryRows<ClosingStockHistoryRow>(
    `SELECT
        ('legacy-' || s.id::text) AS id,
        s.financial_year,
        COALESCE(
          (SELECT MAX(c.snapshot_date)::text
           FROM closing_stock_snapshots c
           WHERE c.business_id = s.business_id AND c.financial_year = s.financial_year),
          s.snapshot_date::text
        ) AS snapshot_date,
        s.total_value::float AS total_value,
        COALESCE(s.is_finalized, false) AS is_locked,
        COALESCE(s.valuation_method_used, '') AS valuation_method,
        s.total_items,
        s.total_quantity::float AS total_quantity
     FROM closing_stock_summary s
     WHERE s.business_id = $1
     ORDER BY s.financial_year DESC`,
    [businessId]
  );
}

export async function getClosingComparison(snapshotId: string, businessId: string): Promise<{
  previousHeaderId: string | null;
  rows: ClosingStockComparisonRow[];
}> {
  if (!(await hasClosingStockV2Schema())) {
    return { previousHeaderId: null, rows: [] };
  }
  const prevRow = await queryOne<{ prev_id: string | null }>(
    `WITH ordered AS (
       SELECT id,
              LAG(id) OVER (ORDER BY snapshot_date ASC, created_at ASC) AS prev_id
       FROM closing_stock_snapshot_headers
       WHERE business_id = $1
     )
     SELECT prev_id FROM ordered WHERE id = $2`,
    [businessId, snapshotId]
  );
  const prevId = prevRow?.prev_id ?? null;
  if (!prevId) {
    return { previousHeaderId: null, rows: [] };
  }

  const rows = await queryRows<ClosingStockComparisonRow>(
    `SELECT u.item_id,
            i.name AS item_name,
            COALESCE(p.quantity, 0)::float AS previous_quantity,
            COALESCE(c.quantity, 0)::float AS current_quantity,
            (COALESCE(c.quantity, 0) - COALESCE(p.quantity, 0))::float AS quantity_delta,
            COALESCE(p.total_value, 0)::float AS previous_value,
            COALESCE(c.total_value, 0)::float AS current_value,
            (COALESCE(c.total_value, 0) - COALESCE(p.total_value, 0))::float AS value_delta
     FROM (
       SELECT item_id FROM closing_stock_snapshot_items WHERE snapshot_id = $1
       UNION
       SELECT item_id FROM closing_stock_snapshot_items WHERE snapshot_id = $2
     ) u
     LEFT JOIN closing_stock_snapshot_items c ON c.item_id = u.item_id AND c.snapshot_id = $1
     LEFT JOIN closing_stock_snapshot_items p ON p.item_id = u.item_id AND p.snapshot_id = $2
     LEFT JOIN items i ON i.id = u.item_id`,
    [snapshotId, prevId]
  );

  return { previousHeaderId: prevId, rows };
}

/**
 * Fetch snapshot for UI: prefers normalized headers; falls back to legacy tables.
 */
export async function getClosingStockSnapshot(
  businessId: string,
  financialYear: string,
  options?: {
    snapshotId?: string;
    page?: number;
    limit?: number;
    search?: string;
    sort?: string;
    /** When true, allow up to 100k rows (e.g. CSV export). */
    forExport?: boolean;
  }
): Promise<{
  summary: ClosingStockSummary | null;
  snapshots: ClosingStockSnapshot[];
  pagination?: { page: number; limit: number; total: number; totalPages: number };
  comparison?: { previousHeaderId: string | null; rows: ClosingStockComparisonRow[] };
}> {
  const page = Math.max(1, options?.page ?? 1);
  const maxCap = options?.forExport ? 100_000 : 200;
  const limit = Math.min(Math.max(options?.limit ?? 50, 1), maxCap);
  const offset = (page - 1) * limit;
  const search = (options?.search || '').trim();
  const sort = options?.sort || 'name';

  if (!(await hasClosingStockV2Schema())) {
    const leg = await getLegacyClosingStockView(businessId, financialYear, page, limit, search, sort);
    return { ...leg, comparison: undefined };
  }

  const header = options?.snapshotId
    ? await queryOne<{
        id: string;
        financial_year_id: string | null;
        financial_year: string;
        snapshot_date: Date;
        total_items: number;
        total_quantity: number;
        total_value: number;
        valuation_method: string;
        is_locked: boolean;
      }>(
        `SELECT id, financial_year_id, financial_year, snapshot_date, total_items,
                total_quantity, total_value, valuation_method, is_locked
         FROM closing_stock_snapshot_headers
         WHERE id = $1 AND business_id = $2`,
        [options.snapshotId, businessId]
      )
    : await queryOne<{
        id: string;
        financial_year_id: string | null;
        financial_year: string;
        snapshot_date: Date;
        total_items: number;
        total_quantity: number;
        total_value: number;
        valuation_method: string;
        is_locked: boolean;
      }>(
        `SELECT id, financial_year_id, financial_year, snapshot_date, total_items,
                total_quantity, total_value, valuation_method, is_locked
         FROM closing_stock_snapshot_headers
         WHERE business_id = $1 AND financial_year = $2
         ORDER BY snapshot_date DESC, created_at DESC
         LIMIT 1`,
        [businessId, financialYear]
      );

  if (header) {
    const summaryRow = await queryOne<{ is_finalized: boolean; financial_year_id: string }>(
      `SELECT is_finalized, financial_year_id FROM closing_stock_summary
       WHERE business_id = $1 AND financial_year = $2`,
      [businessId, financialYear]
    );

    const countParams: unknown[] = [header.id];
    let countSql = `
      SELECT COUNT(*)::int AS c
      FROM closing_stock_snapshot_items si
      JOIN items i ON i.id = si.item_id
      WHERE si.snapshot_id = $1`;
    if (search) {
      countSql += ` AND i.name ILIKE $2`;
      countParams.push(`%${search}%`);
    }
    const total = (await queryOne<{ c: number }>(countSql, countParams))?.c ?? 0;

    const orderBy =
      sort === 'value'
        ? 'si.total_value DESC NULLS LAST'
        : sort === 'qty'
          ? 'si.quantity DESC NULLS LAST'
          : 'i.name ASC';

    const listParams: unknown[] = [header.id, limit, offset];
    let listSql = `
      SELECT si.item_id, i.name AS item_name, si.quantity,
             si.valuation_price AS unit_cost, si.total_value,
             h.valuation_method, si.last_purchase_date
      FROM closing_stock_snapshot_items si
      JOIN items i ON i.id = si.item_id
      JOIN closing_stock_snapshot_headers h ON h.id = si.snapshot_id
      WHERE si.snapshot_id = $1`;
    if (search) {
      listSql += ` AND i.name ILIKE $4`;
      listParams.push(`%${search}%`);
    }
    listSql += ` ORDER BY ${orderBy} LIMIT $2 OFFSET $3`;

    const rawSnaps = await queryRows<{
      item_id: string;
      item_name: string;
      quantity: unknown;
      unit_cost: unknown;
      total_value: unknown;
      valuation_method: string;
      last_purchase_date: Date | string | null;
    }>(listSql, listParams);

    const comparison = await getClosingComparison(header.id, businessId);

    return {
      summary: {
        financial_year_id: summaryRow?.financial_year_id || header.financial_year_id || '',
        financial_year: header.financial_year,
        total_items: header.total_items,
        total_quantity: parseFloat(header.total_quantity?.toString() || '0'),
        total_value: parseFloat(header.total_value?.toString() || '0'),
        snapshot_date:
          header.snapshot_date instanceof Date
            ? header.snapshot_date.toISOString().slice(0, 10)
            : String(header.snapshot_date).slice(0, 10),
        is_finalized: summaryRow?.is_finalized ?? false,
        valuation_method: header.valuation_method,
        snapshot_header_id: header.id,
        is_locked: header.is_locked,
      },
      snapshots: rawSnaps.map((s) => ({
        item_id: s.item_id,
        item_name: s.item_name,
        quantity: parseFloat(s.quantity?.toString() || '0'),
        unit_cost: parseFloat(s.unit_cost?.toString() || '0'),
        total_value: parseFloat(s.total_value?.toString() || '0'),
        valuation_method: s.valuation_method as LegacyValuationMethod,
        last_purchase_date:
          s.last_purchase_date instanceof Date
            ? s.last_purchase_date.toISOString().slice(0, 10)
            : s.last_purchase_date
              ? String(s.last_purchase_date).slice(0, 10)
              : null,
      })),
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
      comparison,
    };
  }

  const leg = await getLegacyClosingStockView(businessId, financialYear, page, limit, search, sort);
  return { ...leg, comparison: undefined };
}

export async function getClosingStockValue(businessId: string, financialYear: string): Promise<number> {
  const summary = await queryOne<{ total_value: number }>(
    `SELECT total_value FROM closing_stock_summary
     WHERE business_id = $1 AND financial_year = $2`,
    [businessId, financialYear]
  );

  return parseFloat(summary?.total_value?.toString() || '0');
}

export async function finalizeClosingStock(
  businessId: string,
  financialYearId: string,
  userId: string
): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();

  try {
    await client.query(
      `UPDATE closing_stock_summary
       SET is_finalized = true,
           finalized_at = CURRENT_TIMESTAMP,
           finalized_by = $1
       WHERE business_id = $2 AND financial_year_id = $3`,
      [userId, businessId, financialYearId]
    );

    if (await hasClosingStockV2Schema()) {
      await client.query(
        `UPDATE closing_stock_snapshot_headers h
         SET is_locked = true
         FROM closing_stock_summary s
         WHERE s.snapshot_header_id = h.id
           AND s.business_id = $1
           AND s.financial_year_id = $2`,
        [businessId, financialYearId]
      );
    }
  } finally {
    client.release();
  }
}

export async function isClosingStockFinalized(businessId: string, financialYear: string): Promise<boolean> {
  const result = await queryOne<{ is_finalized: boolean }>(
    `SELECT is_finalized FROM closing_stock_summary
     WHERE business_id = $1 AND financial_year = $2`,
    [businessId, financialYear]
  );

  return result?.is_finalized || false;
}

export interface StockAuditEntryRow {
  id: string;
  item_id: string;
  item_name: string;
  system_qty: number;
  physical_qty: number;
  difference: number;
}

/** All valued lines for CSV export (no pagination). */
export async function fetchSnapshotLinesForExport(
  snapshotId: string,
  businessId: string
): Promise<ClosingStockSnapshot[]> {
  if (!(await hasClosingStockV2Schema())) {
    return [];
  }
  const h = await queryOne<{ id: string }>(
    `SELECT id FROM closing_stock_snapshot_headers WHERE id = $1 AND business_id = $2`,
    [snapshotId, businessId]
  );
  if (!h) return [];

  const rows = await queryRows<{
    item_id: string;
    item_name: string;
    quantity: unknown;
    unit_cost: unknown;
    total_value: unknown;
    valuation_method: string;
    last_purchase_date: Date | string | null;
  }>(
    `SELECT si.item_id, i.name AS item_name, si.quantity,
            si.valuation_price AS unit_cost, si.total_value,
            h.valuation_method, si.last_purchase_date
     FROM closing_stock_snapshot_items si
     JOIN items i ON i.id = si.item_id
     JOIN closing_stock_snapshot_headers h ON h.id = si.snapshot_id
     WHERE si.snapshot_id = $1
     ORDER BY i.name ASC`,
    [snapshotId]
  );

  return rows.map((s) => ({
    item_id: s.item_id,
    item_name: s.item_name,
    quantity: parseFloat(s.quantity?.toString() || '0'),
    unit_cost: parseFloat(s.unit_cost?.toString() || '0'),
    total_value: parseFloat(s.total_value?.toString() || '0'),
    valuation_method: s.valuation_method as LegacyValuationMethod,
    last_purchase_date:
      s.last_purchase_date instanceof Date
        ? s.last_purchase_date.toISOString().slice(0, 10)
        : s.last_purchase_date
          ? String(s.last_purchase_date).slice(0, 10)
          : null,
  }));
}

export async function listStockAuditEntries(
  snapshotId: string,
  businessId: string
): Promise<StockAuditEntryRow[]> {
  if (!(await hasClosingStockV2Schema())) {
    return [];
  }
  const ok = await queryOne(
    `SELECT 1 FROM closing_stock_snapshot_headers WHERE id = $1 AND business_id = $2`,
    [snapshotId, businessId]
  );
  if (!ok) return [];

  return queryRows<StockAuditEntryRow>(
    `SELECT a.id, a.item_id, i.name AS item_name,
            a.system_qty::float, a.physical_qty::float, a.difference::float
     FROM stock_audit_entries a
     JOIN items i ON i.id = a.item_id
     WHERE a.snapshot_id = $1
     ORDER BY i.name`,
    [snapshotId]
  );
}

/**
 * Writes audit rows for every line on the snapshot. Physical qty defaults to system qty
 * when not present in overrides (partial UI pages still get a full audit trail).
 */
export async function applyStockAuditOverrides(
  businessId: string,
  snapshotId: string,
  overrides: Record<string, number>
): Promise<void> {
  if (!(await hasClosingStockV2Schema())) {
    throw new Error(
      'Physical stock audit requires migration 174. Run: npm run db:migrate:174-closing-stock (or node scripts/run-migration.js database/migrations/174_closing_stock_management.sql)'
    );
  }
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const hdr = await client.query(
      `SELECT id FROM closing_stock_snapshot_headers WHERE id = $1 AND business_id = $2`,
      [snapshotId, businessId]
    );
    if (!hdr.rows[0]) {
      throw new Error('Snapshot not found');
    }

    const lines = await client.query(
      `SELECT item_id, quantity FROM closing_stock_snapshot_items WHERE snapshot_id = $1`,
      [snapshotId]
    );

    for (const row of lines.rows) {
      const itemId = row.item_id as string;
      const systemQty = parseFloat(row.quantity ?? '0');
      const physical =
        overrides[itemId] !== undefined && !Number.isNaN(Number(overrides[itemId]))
          ? Number(overrides[itemId])
          : systemQty;
      await client.query(
        `INSERT INTO stock_audit_entries (snapshot_id, item_id, system_qty, physical_qty, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP)
         ON CONFLICT (snapshot_id, item_id)
         DO UPDATE SET
           physical_qty = EXCLUDED.physical_qty,
           system_qty = EXCLUDED.system_qty,
           updated_at = CURRENT_TIMESTAMP`,
        [snapshotId, itemId, systemQty, physical]
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
