/**
 * Stock Summary / Inventory Intelligence — aggregated queries for the dashboard API.
 * Keeps work server-side; callers run sections in parallel for latency.
 */

import * as db from '@/lib/db';

const REORDER_DAYS_THRESHOLD = 7;
const VELOCITY_DAYS = 30;
const REORDER_COVER_DAYS = 14;

export type StockSummaryBase = {
  total_items: number;
  total_stock_qty: number;
  stock_value: number;
  low_stock_count: number;
  out_of_stock_count: number;
};

export type StockHealthCounts = {
  healthy_stock_count: number;
  low_stock_count: number;
  critical_stock_count: number;
  dead_stock_count: number;
};

export type ReorderSuggestionRow = {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  avg_daily_sales: number;
  days_left: number | null;
  suggested_order_qty: number;
};

export type AgingBuckets = {
  bucket_0_30: number;
  bucket_30_60: number;
  bucket_60_plus: number;
};

export type ValueAnalysis = {
  total_purchase_value: number;
  total_selling_value: number;
  potential_profit: number;
};

export type VelocityItem = {
  id: string;
  name: string;
  quantity_sold_30d: number;
};

export type RecentActivityRow = {
  item_name: string;
  type: 'purchase' | 'sale' | 'adjustment';
  quantity: number;
  timestamp: string;
};

export type HighValueItemRow = {
  id: string;
  name: string;
  current_stock: number;
  unit: string;
  purchase_price: number;
  selling_price: number;
  stock_value: number;
};

export type LowStockItemRow = {
  id: string;
  name: string;
  current_stock: number;
  min_stock: number;
  unit: string;
  selling_price: number;
};

/** Core summary + legacy low/high lists (unchanged contract). */
export async function fetchSummaryLegacy(businessId: string): Promise<{
  summary: StockSummaryBase | null;
  lowStockItems: LowStockItemRow[];
  highValueItems: HighValueItemRow[];
}> {
  const summary = await db.queryOne<StockSummaryBase>(
    `
    SELECT 
      COUNT(*)::int AS total_items,
      COALESCE(SUM(current_stock), 0)::float AS total_stock_qty,
      COALESCE(SUM(current_stock * purchase_price), 0)::float AS stock_value,
      COUNT(*) FILTER (WHERE current_stock <= min_stock AND min_stock > 0)::int AS low_stock_count,
      COUNT(*) FILTER (WHERE current_stock = 0)::int AS out_of_stock_count
    FROM items
    WHERE business_id = $1 AND is_active = true
    `,
    [businessId]
  );

  const lowStockItems = await db.queryRows<LowStockItemRow>(
    `
    SELECT id, name, current_stock::float, min_stock::float, unit, selling_price::float
    FROM items
    WHERE business_id = $1 
      AND is_active = true
      AND current_stock <= min_stock 
      AND min_stock > 0
    ORDER BY current_stock ASC
    LIMIT 20
    `,
    [businessId]
  );

  const highValueItems = await db.queryRows<HighValueItemRow>(
    `
    SELECT 
      id, name, current_stock::float, unit, 
      purchase_price::float, selling_price::float,
      (current_stock * purchase_price)::float AS stock_value
    FROM items
    WHERE business_id = $1 AND is_active = true
    ORDER BY (current_stock * purchase_price) DESC NULLS LAST
    LIMIT 10
    `,
    [businessId]
  );

  return { summary, lowStockItems, highValueItems };
}

export async function fetchStockHealth(businessId: string): Promise<StockHealthCounts> {
  const row = await db.queryOne<StockHealthCounts>(
    `
    WITH sold_30d AS (
      SELECT ii.item_id, SUM(ii.quantity)::numeric AS qty
      FROM invoice_items ii
      INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
      WHERE inv.business_id = $1
        AND inv.status = 'final'
        AND inv.invoice_date >= (CURRENT_DATE - $2::int)
        AND ii.item_id IS NOT NULL
      GROUP BY ii.item_id
    )
    SELECT
      COUNT(*) FILTER (
        WHERE i.is_active
          AND (
            (i.min_stock > 0 AND i.current_stock > i.min_stock)
            OR (COALESCE(i.min_stock, 0) = 0 AND i.current_stock > 0)
          )
      )::int AS healthy_stock_count,
      COUNT(*) FILTER (
        WHERE i.is_active
          AND i.min_stock > 0
          AND i.current_stock > 0
          AND i.current_stock <= i.min_stock
          AND i.current_stock > (i.min_stock * 0.5)
      )::int AS low_stock_count,
      COUNT(*) FILTER (
        WHERE i.is_active
          AND i.min_stock > 0
          AND i.current_stock > 0
          AND i.current_stock <= (i.min_stock * 0.5)
      )::int AS critical_stock_count,
      COUNT(*) FILTER (
        WHERE i.is_active
          AND i.current_stock > 0
          AND COALESCE(s.qty, 0) = 0
      )::int AS dead_stock_count
    FROM items i
    LEFT JOIN sold_30d s ON s.item_id = i.id
    WHERE i.business_id = $1
    `,
    [businessId, VELOCITY_DAYS]
  );
  return (
    row ?? {
      healthy_stock_count: 0,
      low_stock_count: 0,
      critical_stock_count: 0,
      dead_stock_count: 0,
    }
  );
}

export async function fetchReorderSuggestions(
  businessId: string,
  limit: number,
  offset: number
): Promise<{ rows: ReorderSuggestionRow[]; totalCount: number }> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const off = Math.max(0, offset);

  const countRow = await db.queryOne<{ c: number }>(
    `
    WITH sold AS (
      SELECT ii.item_id, SUM(ii.quantity)::numeric AS qty_30d
      FROM invoice_items ii
      INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
      WHERE inv.business_id = $1
        AND inv.status = 'final'
        AND inv.invoice_date >= (CURRENT_DATE - $3::int)
        AND ii.item_id IS NOT NULL
      GROUP BY ii.item_id
    ),
    base AS (
      SELECT 
        i.id,
        i.name,
        i.current_stock::numeric AS current_stock,
        i.unit,
        (COALESCE(s.qty_30d, 0) / ($3::numeric)) AS avg_daily_sales
      FROM items i
      LEFT JOIN sold s ON s.item_id = i.id
      WHERE i.business_id = $1 AND i.is_active = true
    ),
    flagged AS (
      SELECT *
      FROM base
      WHERE avg_daily_sales > 0
        AND (current_stock / avg_daily_sales) < $2::numeric
    )
    SELECT COUNT(*)::int AS c FROM flagged
    `,
    [businessId, REORDER_DAYS_THRESHOLD, VELOCITY_DAYS]
  );

  const rows = await db.queryRows<ReorderSuggestionRow>(
    `
    WITH sold AS (
      SELECT ii.item_id, SUM(ii.quantity)::numeric AS qty_30d
      FROM invoice_items ii
      INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
      WHERE inv.business_id = $1
        AND inv.status = 'final'
        AND inv.invoice_date >= (CURRENT_DATE - $4::int)
        AND ii.item_id IS NOT NULL
      GROUP BY ii.item_id
    ),
    base AS (
      SELECT 
        i.id,
        i.name,
        i.current_stock::numeric AS current_stock,
        i.unit,
        (COALESCE(s.qty_30d, 0) / ($4::numeric)) AS avg_daily_sales
      FROM items i
      LEFT JOIN sold s ON s.item_id = i.id
      WHERE i.business_id = $1 AND i.is_active = true
    )
    SELECT 
      id,
      name,
      current_stock::float AS current_stock,
      COALESCE(unit, 'PCS') AS unit,
      avg_daily_sales::float AS avg_daily_sales,
      (current_stock / NULLIF(avg_daily_sales, 0))::float AS days_left,
      GREATEST(0, (avg_daily_sales * $5::numeric) - current_stock)::float AS suggested_order_qty
    FROM base
    WHERE avg_daily_sales > 0
      AND (current_stock / avg_daily_sales) < $2::numeric
    ORDER BY (current_stock / avg_daily_sales) ASC NULLS LAST
    LIMIT $3 OFFSET $6
    `,
    [businessId, REORDER_DAYS_THRESHOLD, capped, VELOCITY_DAYS, REORDER_COVER_DAYS, off]
  );

  return { rows, totalCount: countRow?.c ?? rows.length };
}

export async function fetchAgingBuckets(businessId: string): Promise<AgingBuckets> {
  const row = await db.queryOne<AgingBuckets>(
    `
    WITH last_inflow AS (
      SELECT 
        i.id AS item_id,
        COALESCE(
          lp.max_bill,
          lm.max_mv,
          (i.created_at::date)
        )::date AS ref_day
      FROM items i
      LEFT JOIN LATERAL (
        SELECT MAX(p.bill_date)::date AS max_bill
        FROM purchase_items pi
        INNER JOIN purchases p ON p.id = pi.purchase_id AND p.deleted_at IS NULL
        WHERE pi.item_id = i.id
          AND p.business_id = i.business_id
          AND p.status = 'final'
      ) lp ON true
      LEFT JOIN LATERAL (
        SELECT MAX((sm.created_at AT TIME ZONE 'UTC')::date) AS max_mv
        FROM stock_movements sm
        WHERE sm.item_id = i.id
          AND sm.business_id = i.business_id
          AND sm.type = 'in'
      ) lm ON true
      WHERE i.business_id = $1 AND i.is_active = true AND i.current_stock > 0
    )
    SELECT
      COUNT(*) FILTER (WHERE (CURRENT_DATE - ref_day) <= 30)::int AS bucket_0_30,
      COUNT(*) FILTER (WHERE (CURRENT_DATE - ref_day) > 30 AND (CURRENT_DATE - ref_day) <= 60)::int AS bucket_30_60,
      COUNT(*) FILTER (WHERE (CURRENT_DATE - ref_day) > 60)::int AS bucket_60_plus
    FROM last_inflow
    `,
    [businessId]
  );

  return (
    row ?? {
      bucket_0_30: 0,
      bucket_30_60: 0,
      bucket_60_plus: 0,
    }
  );
}

export async function fetchValueAnalysis(businessId: string): Promise<ValueAnalysis> {
  const row = await db.queryOne<{
    total_purchase_value: number;
    total_selling_value: number;
    potential_profit: number;
  }>(
    `
    SELECT
      COALESCE(SUM(current_stock * COALESCE(purchase_price, 0)), 0)::float AS total_purchase_value,
      COALESCE(SUM(current_stock * COALESCE(selling_price, 0)), 0)::float AS total_selling_value,
      COALESCE(
        SUM(current_stock * (COALESCE(selling_price, 0) - COALESCE(purchase_price, 0))),
        0
      )::float AS potential_profit
    FROM items
    WHERE business_id = $1 AND is_active = true
    `,
    [businessId]
  );

  return {
    total_purchase_value: row?.total_purchase_value ?? 0,
    total_selling_value: row?.total_selling_value ?? 0,
    potential_profit: row?.potential_profit ?? 0,
  };
}

export async function fetchVelocity(businessId: string): Promise<{
  fastMoving: VelocityItem[];
  slowMoving: VelocityItem[];
}> {
  const sold = await db.queryRows<{ item_id: string; name: string; qty: number }>(
    `
    SELECT ii.item_id, MAX(ii.item_name) AS name, SUM(ii.quantity)::float AS qty
    FROM invoice_items ii
    INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
    WHERE inv.business_id = $1
      AND inv.status = 'final'
      AND inv.invoice_date >= (CURRENT_DATE - $2::int)
      AND ii.item_id IS NOT NULL
    GROUP BY ii.item_id
    `,
    [businessId, VELOCITY_DAYS]
  );

  const withId = sold
    .map((r) => ({
      id: r.item_id,
      name: r.name,
      quantity_sold_30d: r.qty,
    }))
    .sort((a, b) => b.quantity_sold_30d - a.quantity_sold_30d);

  const fastMoving = withId.slice(0, 5);
  const positive = withId.filter((x) => x.quantity_sold_30d > 0).sort((a, b) => a.quantity_sold_30d - b.quantity_sold_30d);
  const slowMoving = positive.slice(0, 5);

  return { fastMoving, slowMoving };
}

export async function fetchRecentActivity(businessId: string, limit: number): Promise<RecentActivityRow[]> {
  const capped = Math.min(Math.max(limit, 1), 50);
  const mapRow = (r: { item_name: string; type: string; quantity: number; ts: Date | string }) => ({
    item_name: r.item_name,
    type: r.type as RecentActivityRow['type'],
    quantity: r.quantity,
    timestamp: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
  });
  try {
    const rows = await db.queryRows<{ item_name: string; type: string; quantity: number; ts: Date | string }>(
      `
      SELECT * FROM (
        SELECT i.name AS item_name, 'purchase'::text AS type, pi.quantity::float AS quantity, p.created_at AS ts
        FROM purchase_items pi
        INNER JOIN purchases p ON p.id = pi.purchase_id AND p.deleted_at IS NULL
        INNER JOIN items i ON i.id = pi.item_id
        WHERE p.business_id = $1 AND p.status = 'final' AND pi.item_id IS NOT NULL

        UNION ALL

        SELECT i.name, 'sale'::text, ii.quantity::float, inv.created_at
        FROM invoice_items ii
        INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
        INNER JOIN items i ON i.id = ii.item_id
        WHERE inv.business_id = $1 AND inv.status = 'final' AND ii.item_id IS NOT NULL

        UNION ALL

        SELECT i.name, 'adjustment'::text, ia.quantity_change::float, ia.created_at
        FROM inventory_adjustments ia
        INNER JOIN items i ON i.id = ia.item_id
        WHERE ia.business_id = $1 AND ia.adjustment_type = 'QUANTITY' AND ia.quantity_change IS NOT NULL
      ) u
      ORDER BY ts DESC
      LIMIT $2
      `,
      [businessId, capped]
    );
    return rows.map(mapRow);
  } catch (e) {
    console.warn('[stockSummaryDashboard] recent activity (inventory_adjustments may be missing):', e);
    const rows = await db.queryRows<{ item_name: string; type: string; quantity: number; ts: Date | string }>(
      `
      SELECT * FROM (
        SELECT i.name AS item_name, 'purchase'::text AS type, pi.quantity::float AS quantity, p.created_at AS ts
        FROM purchase_items pi
        INNER JOIN purchases p ON p.id = pi.purchase_id AND p.deleted_at IS NULL
        INNER JOIN items i ON i.id = pi.item_id
        WHERE p.business_id = $1 AND p.status = 'final' AND pi.item_id IS NOT NULL

        UNION ALL

        SELECT i.name, 'sale'::text, ii.quantity::float, inv.created_at
        FROM invoice_items ii
        INNER JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
        INNER JOIN items i ON i.id = ii.item_id
        WHERE inv.business_id = $1 AND inv.status = 'final' AND ii.item_id IS NOT NULL
      ) u
      ORDER BY ts DESC
      LIMIT $2
      `,
      [businessId, capped]
    );
    return rows.map(mapRow);
  }
}
