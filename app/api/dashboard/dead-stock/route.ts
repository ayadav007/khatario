import { NextRequest, NextResponse } from 'next/server';
import { queryRows } from '@/lib/db';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  assertFeatureAccess,
  FeatureAccessDeniedError,
} from '@/lib/subscription/feature-access';
import { isWarehouseModeEnabled } from '@/lib/warehouse-mode';
import { getUserAccessibleBranchIds } from '@/lib/branch-access';
import { getUserWarehouses } from '@/lib/warehouse-access';

/**
 * GET /api/dashboard/dead-stock
 *
 * Lists stagnant inventory (positive stock, no qualifying invoice sale within
 * `stale_days`) scoped to the calling user's accessible branches.
 *
 * "Sale" = finalized, non-proforma invoices (matches top-products semantics).
 * On-hand stock is resolved from `branch_item_stock` when `warehouses_enabled`
 * is false, otherwise aggregated from `location_stock` joined to `warehouses`
 * for per-branch/warehouse drill-down.
 */

const DEFAULT_STALE_DAYS = 90;
const MAX_STALE_DAYS = 730;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    try {
      await authorize(userId, 'dashboard', 'read');
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    try {
      await assertFeatureAccess(businessId, 'dead_stock_widget');
    } catch (err) {
      if (err instanceof FeatureAccessDeniedError) {
        return NextResponse.json(err.toResponse(), { status: 403 });
      }
      throw err;
    }

    const staleDaysRaw = parseInt(
      searchParams.get('stale_days') || `${DEFAULT_STALE_DAYS}`,
      10
    );
    const staleDays = Number.isFinite(staleDaysRaw)
      ? Math.min(Math.max(staleDaysRaw, 1), MAX_STALE_DAYS)
      : DEFAULT_STALE_DAYS;

    const limitRaw = parseInt(searchParams.get('limit') || `${DEFAULT_LIMIT}`, 10);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(limitRaw, 1), MAX_LIMIT)
      : DEFAULT_LIMIT;

    const minQtyRaw = parseFloat(searchParams.get('min_qty') || '0');
    const minQty = Number.isFinite(minQtyRaw) && minQtyRaw >= 0 ? minQtyRaw : 0;

    // Default: include items that never had a qualifying sale (they count as dead).
    const neverSoldParam = searchParams.get('never_sold');
    const includeNeverSold =
      neverSoldParam === null
        ? true
        : !['false', '0', 'no'].includes(neverSoldParam.toLowerCase());

    const branchIdFilter = searchParams.get('branch_id');
    const warehouseIdFilter = searchParams.get('warehouse_id');

    const accessibleBranchIds = await getUserAccessibleBranchIds(userId);

    const emptyResponse = (stockMode: 'branch' | 'warehouse') => ({
      stock_mode: stockMode,
      value_basis: 'purchase_price' as const,
      stale_days: staleDays,
      rows: [],
      totals: { sku_count: 0, total_qty: 0, total_value: 0 },
      branches: [] as Array<{ id: string; name: string }>,
      warehouses: [] as Array<{ id: string; name: string; branch_id: string | null }>,
    });

    const warehouseModeEnabled = await isWarehouseModeEnabled(businessId);

    if (accessibleBranchIds.length === 0) {
      return NextResponse.json(
        emptyResponse(warehouseModeEnabled ? 'warehouse' : 'branch')
      );
    }

    let scopedBranchIds = accessibleBranchIds;
    if (branchIdFilter) {
      if (!accessibleBranchIds.includes(branchIdFilter)) {
        return NextResponse.json(
          { error: 'Branch not accessible' },
          { status: 403 }
        );
      }
      scopedBranchIds = [branchIdFilter];
    }

    // Branches the widget is allowed to render in its filter dropdown.
    const branches = await queryRows<{ id: string; name: string }>(
      `SELECT id, name
       FROM branches
       WHERE business_id = $1
         AND is_active = true
         AND id = ANY($2::uuid[])
       ORDER BY COALESCE(is_primary, false) DESC, name ASC`,
      [businessId, accessibleBranchIds]
    );

    if (!warehouseModeEnabled) {
      const rows = await queryRows<DeadStockRow>(
        buildBranchModeSql(),
        [businessId, scopedBranchIds, staleDays, minQty, includeNeverSold, limit]
      );

      return NextResponse.json({
        stock_mode: 'branch',
        value_basis: 'purchase_price',
        stale_days: staleDays,
        rows: rows.map(mapRow),
        totals: summarize(rows),
        branches,
        warehouses: [],
      });
    }

    // Warehouse mode: resolve accessible warehouses, optionally narrow via query.
    const userWarehouses = await getUserWarehouses(userId);
    const accessibleWarehouseIds = userWarehouses
      .filter((w) => w.can_view)
      .map((w) => w.warehouse_id);

    if (accessibleWarehouseIds.length === 0) {
      return NextResponse.json(emptyResponse('warehouse'));
    }

    let scopedWarehouseIds = accessibleWarehouseIds;
    if (warehouseIdFilter) {
      if (!accessibleWarehouseIds.includes(warehouseIdFilter)) {
        return NextResponse.json(
          { error: 'Warehouse not accessible' },
          { status: 403 }
        );
      }
      scopedWarehouseIds = [warehouseIdFilter];
    }

    const warehouses = await queryRows<{
      id: string;
      name: string;
      branch_id: string | null;
    }>(
      `SELECT w.id, w.name, w.branch_id
       FROM warehouses w
       WHERE w.business_id = $1
         AND w.is_active = true
         AND w.id = ANY($2::uuid[])
         AND (w.branch_id IS NULL OR w.branch_id = ANY($3::uuid[]))
       ORDER BY w.name ASC`,
      [businessId, accessibleWarehouseIds, scopedBranchIds]
    );

    const rows = await queryRows<DeadStockRow>(
      buildWarehouseModeSql(),
      [
        businessId,
        scopedBranchIds,
        scopedWarehouseIds,
        staleDays,
        minQty,
        includeNeverSold,
        limit,
      ]
    );

    return NextResponse.json({
      stock_mode: 'warehouse',
      value_basis: 'purchase_price',
      stale_days: staleDays,
      rows: rows.map(mapRow),
      totals: summarize(rows),
      branches,
      warehouses,
    });
  } catch (error: any) {
    console.error('[dead-stock] error:', error);
    return NextResponse.json(
      { error: error?.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

interface DeadStockRow {
  branch_id: string;
  branch_name: string;
  warehouse_id: string | null;
  warehouse_name: string | null;
  item_id: string;
  item_name: string;
  item_code: string | null;
  unit: string | null;
  quantity: string | number;
  purchase_price: string | number | null;
  last_sale_date: string | null;
  days_without_sale: number | null;
}

function mapRow(r: DeadStockRow) {
  const qty = Number(r.quantity ?? 0);
  const cost = Number(r.purchase_price ?? 0);
  return {
    branch_id: r.branch_id,
    branch_name: r.branch_name,
    warehouse_id: r.warehouse_id,
    warehouse_name: r.warehouse_name,
    item_id: r.item_id,
    item_name: r.item_name,
    item_code: r.item_code,
    unit: r.unit || 'PCS',
    quantity: qty,
    purchase_price: cost,
    last_sale_date: r.last_sale_date,
    days_without_sale: r.days_without_sale,
    inventory_value: Number((qty * cost).toFixed(2)),
  };
}

function summarize(rows: DeadStockRow[]) {
  let totalQty = 0;
  let totalValue = 0;
  for (const r of rows) {
    const qty = Number(r.quantity ?? 0);
    const cost = Number(r.purchase_price ?? 0);
    totalQty += qty;
    totalValue += qty * cost;
  }
  return {
    sku_count: rows.length,
    total_qty: Number(totalQty.toFixed(3)),
    total_value: Number(totalValue.toFixed(2)),
  };
}

/**
 * Branch-mode dead stock query.
 *
 * Params:
 *   $1 business_id
 *   $2 branch_ids (uuid[])
 *   $3 stale_days (int)
 *   $4 min_qty (numeric)
 *   $5 include_never_sold (boolean)
 *   $6 limit (int)
 */
function buildBranchModeSql(): string {
  return `
    WITH last_sales AS (
      SELECT
        inv.branch_id,
        ii.item_id,
        MAX(inv.invoice_date) AS last_sale_date
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
      WHERE inv.business_id = $1
        AND inv.branch_id = ANY($2::uuid[])
        AND inv.status = 'final'
        AND (inv.document_type IS NULL OR inv.document_type != 'proforma_invoice')
        AND ii.item_id IS NOT NULL
      GROUP BY inv.branch_id, ii.item_id
    )
    SELECT
      bis.branch_id,
      b.name AS branch_name,
      NULL::uuid AS warehouse_id,
      NULL::text AS warehouse_name,
      it.id AS item_id,
      it.name AS item_name,
      it.code AS item_code,
      it.unit,
      bis.quantity,
      it.purchase_price,
      ls.last_sale_date,
      CASE
        WHEN ls.last_sale_date IS NULL THEN NULL
        ELSE (CURRENT_DATE - ls.last_sale_date)::int
      END AS days_without_sale
    FROM branch_item_stock bis
    JOIN items it ON it.id = bis.item_id
    JOIN branches b ON b.id = bis.branch_id
    LEFT JOIN last_sales ls
      ON ls.branch_id = bis.branch_id
     AND ls.item_id = bis.item_id
    WHERE bis.business_id = $1
      AND bis.branch_id = ANY($2::uuid[])
      AND COALESCE(it.is_active, true) = true
      AND bis.quantity > $4
      AND (
        (ls.last_sale_date IS NULL AND $5 = true)
        OR ls.last_sale_date < (CURRENT_DATE - ($3 || ' days')::interval)
      )
    ORDER BY
      (bis.quantity * COALESCE(it.purchase_price, 0)) DESC,
      ls.last_sale_date ASC NULLS FIRST
    LIMIT $6
  `;
}

/**
 * Warehouse-mode dead stock query.
 *
 * Params:
 *   $1 business_id
 *   $2 branch_ids (uuid[])
 *   $3 warehouse_ids (uuid[])
 *   $4 stale_days (int)
 *   $5 min_qty (numeric)
 *   $6 include_never_sold (boolean)
 *   $7 limit (int)
 */
function buildWarehouseModeSql(): string {
  return `
    WITH last_sales AS (
      SELECT
        inv.branch_id,
        ii.item_id,
        MAX(inv.invoice_date) AS last_sale_date
      FROM invoice_items ii
      JOIN invoices inv ON inv.id = ii.invoice_id AND inv.deleted_at IS NULL
      WHERE inv.business_id = $1
        AND inv.branch_id = ANY($2::uuid[])
        AND inv.status = 'final'
        AND (inv.document_type IS NULL OR inv.document_type != 'proforma_invoice')
        AND ii.item_id IS NOT NULL
      GROUP BY inv.branch_id, ii.item_id
    )
    SELECT
      w.branch_id,
      b.name AS branch_name,
      w.id AS warehouse_id,
      w.name AS warehouse_name,
      it.id AS item_id,
      it.name AS item_name,
      it.code AS item_code,
      it.unit,
      ls_row.current_stock_qty AS quantity,
      it.purchase_price,
      ls.last_sale_date,
      CASE
        WHEN ls.last_sale_date IS NULL THEN NULL
        ELSE (CURRENT_DATE - ls.last_sale_date)::int
      END AS days_without_sale
    FROM location_stock ls_row
    JOIN warehouses w ON w.id = ls_row.location_id
    JOIN items it ON it.id = ls_row.item_id
    LEFT JOIN branches b ON b.id = w.branch_id
    LEFT JOIN last_sales ls
      ON ls.branch_id = w.branch_id
     AND ls.item_id = ls_row.item_id
    WHERE it.business_id = $1
      AND w.business_id = $1
      AND w.is_active = true
      AND w.id = ANY($3::uuid[])
      AND (w.branch_id IS NULL OR w.branch_id = ANY($2::uuid[]))
      AND COALESCE(it.is_active, true) = true
      AND ls_row.current_stock_qty > $5
      AND (
        (ls.last_sale_date IS NULL AND $6 = true)
        OR ls.last_sale_date < (CURRENT_DATE - ($4 || ' days')::interval)
      )
    ORDER BY
      (ls_row.current_stock_qty * COALESCE(it.purchase_price, 0)) DESC,
      ls.last_sale_date ASC NULLS FIRST
    LIMIT $7
  `;
}
