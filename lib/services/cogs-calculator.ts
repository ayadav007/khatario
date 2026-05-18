/**
 * COGS (Cost of Goods Sold) Calculator — PHASE-4
 *
 * Periodic inventory model (Tally default), Ind AS 2 compliant.
 *
 *   COGS = Opening Stock
 *        + Net Purchases   ← read from LEDGER 5101 net debit (auto-correct
 *                              for ITC-blocked tax that legitimately stays
 *                              in 5101, RCM dual-entries, cancellations,
 *                              and the Phase-3 GST split)
 *        − Purchase Returns ← LEDGER 5102 net credit (Indian books also
 *                              hit 5101 directly when the convention is
 *                              "net into Purchases"; we read both safely)
 *        − Closing Stock
 *
 * Opening / Closing stock are DATE-AWARE via the existing
 * `stock_movements` table. They no longer fall back to `items.opening_stock`
 * (setup-time) or `items.current_stock` (today) — both of which were
 * date-blind and produced wrong P&L for any non-current-FY range.
 *
 * Stock valuation method is BUSINESS-WIDE (read from
 * business_settings.stock_valuation_method, defaults to 'fifo'). The
 * per-item items.valuation_method column is intentionally ignored —
 * Tally / Ind AS expect a single method per business. LIFO is blocked
 * at the DB-constraint level.
 *
 * For unit-cost VALUATION at any as-of date, Phase-4 uses the
 * Weighted-Average Cost from purchase_items (Q1 design decision):
 *
 *     rate(item, asOfDate) =
 *         SUM(purchase_items.taxable_value WHERE p.bill_date <= asOfDate
 *                                            AND p.status != 'cancelled')
 *       / SUM(purchase_items.quantity SAME FILTER)
 *
 * `taxable_value` is "after trade discount, before tax", i.e. the actual
 * landed cost net of any volume/cash discount and excluding GST (which
 * Phase-3 already strips into 1110-1113). This matches Tally's "Avg.
 * Cost" in Periodic mode and is permitted by Ind AS 2 ("Weighted Average
 * Cost Method"). True per-batch FIFO would need per-movement rates that
 * stock_movements does not store; weighted-average is the standard
 * surrogate and what Indian SMBs run in practice.
 *
 * Fallback chain when an item has zero purchase history before asOfDate:
 *     weighted-avg → items.purchase_price → 0
 * Each item's chosen source is exposed via `unit_cost_source` for audit.
 */

import { queryRows, queryOne, getPool } from '@/lib/db';
import type { PoolClient } from 'pg';

// Strictly the methods we actually support after Phase-4. LIFO is gone.
export type Phase4ValuationMethod = 'fifo' | 'weighted_avg' | 'simple';

export interface COGSItemBreakdown {
  item_id: string;
  item_name: string;
  quantity: number;
  unit_cost: number;
  total_value: number;
  /**
   * PHASE-4: how the unit_cost above was derived.
   *  - 'weighted_avg_purchases' → SUM(purchase_items.taxable_value) / SUM(quantity)
   *    over all non-cancelled purchases up to the as-of date. Tally-parity for
   *    Periodic + Avg. Cost. Ind AS 2 compliant.
   *  - 'item_master_fallback'    → items.purchase_price was used because the item
   *    has zero purchase history before the as-of date (e.g. opening-balance only).
   *  - 'snapshot'                → unit_cost came from closing_stock_snapshots
   *    (year-end locked value).
   */
  unit_cost_source?: 'weighted_avg_purchases' | 'item_master_fallback' | 'snapshot';
}

type StockValuationSource =
  | 'snapshot'
  | 'movements_derived'
  | 'items_opening_fallback'
  | 'current_stock_fallback'
  | 'empty';

export interface COGSCalculation {
  openingStock: {
    quantity: number;
    value: number;
    items: COGSItemBreakdown[];
    as_of_date: string;
    source: StockValuationSource;
  };
  purchases: {
    total: number;             // net of returns; the SINGLE number to use in P&L
    gross_purchases: number;   // ledger 5101 debit − credit (before subtracting returns)
    returns: number;           // ledger 5102 credit − debit (positive = returns booked)
    sources: {
      ledger_5101_net_debit: number;
      ledger_5102_net_credit: number;
    };
    count: number;             // # purchase vouchers in the period (informational only)
    items: Array<{
      purchase_id: string;
      purchase_number: string;
      purchase_date: string;
      amount: number;          // header grand_total, kept for the schedule UI
    }>;
  };
  closingStock: {
    quantity: number;
    value: number;
    items: COGSItemBreakdown[];
    as_of_date: string;
    source: StockValuationSource;
  };
  cogs: number;
  meta: {
    valuation_method: Phase4ValuationMethod;
    inventory_model: 'periodic' | 'perpetual';
    business_id: string;
    period: { from_date: string; to_date: string };
    notes: string[];
  };
}

/**
 * Calculate COGS for a given period using the Phase-4 periodic model.
 */
export async function calculateCOGS(
  businessId: string,
  fromDate: string,
  toDate: string,
  financialYear?: string,
  previousFinancialYear?: string,
): Promise<COGSCalculation> {
  const pool = getPool();
  const client = await pool.connect();
  const notes: string[] = [];

  try {
    // Read business-wide valuation method + inventory model.
    const settings = await client.query(
      `SELECT
         COALESCE(stock_valuation_method, 'fifo') AS stock_valuation_method,
         COALESCE(inventory_model, 'periodic')   AS inventory_model
         FROM business_settings
        WHERE business_id = $1`,
      [businessId],
    );
    const valuationMethod: Phase4ValuationMethod =
      (settings.rows[0]?.stock_valuation_method as Phase4ValuationMethod) ?? 'fifo';
    const inventoryModel: 'periodic' | 'perpetual' =
      (settings.rows[0]?.inventory_model as 'periodic' | 'perpetual') ?? 'periodic';

    if (inventoryModel !== 'periodic') {
      notes.push(
        `inventory_model=${inventoryModel} — calculator still computes the periodic number for reconciliation.`,
      );
    }

    // The day before the period start is the "as-of" date for opening stock.
    const openingAsOf = previousDay(fromDate);

    const [openingStock, purchases, closingStock] = await Promise.all([
      getStockOnDate(client, businessId, openingAsOf, valuationMethod, previousFinancialYear, 'opening'),
      getNetPurchasesFromLedger(client, businessId, fromDate, toDate),
      getStockOnDate(client, businessId, toDate, valuationMethod, financialYear, 'closing'),
    ]);

    const cogs = openingStock.value + purchases.total - closingStock.value;

    return {
      openingStock,
      purchases,
      closingStock,
      cogs,
      meta: {
        valuation_method: valuationMethod,
        inventory_model: inventoryModel,
        business_id: businessId,
        period: { from_date: fromDate, to_date: toDate },
        notes,
      },
    };
  } finally {
    client.release();
  }
}

// =====================================================================
// Net purchases — single source of truth: ledger 5101 (net debit)
//                 minus ledger 5102 (net credit, returns).
//
// Why the ledger and not purchases.subtotal?
//   - After Phase-3, `purchases.subtotal` is taxable-only. ITC-blocked
//     tax that legitimately stays inside `Purchases (5101)` per s.17(5)
//     is invisible from the header. The ledger captures it correctly.
//   - Cancelled purchases have already had their lines reversed; the
//     ledger reflects the right number, the header doesn't.
//   - The ledger is what the Trial Balance and Balance Sheet read.
//     One source of truth = no surprises.
// =====================================================================
async function getNetPurchasesFromLedger(
  client: PoolClient,
  businessId: string,
  fromDate: string,
  toDate: string,
): Promise<COGSCalculation['purchases']> {
  const ledger = await client.query(
    `SELECT
       COALESCE(SUM(CASE WHEN a.account_code = '5101' THEN lel.debit  - lel.credit ELSE 0 END), 0)::float AS net_5101,
       COALESCE(SUM(CASE WHEN a.account_code = '5102' THEN lel.credit - lel.debit  ELSE 0 END), 0)::float AS net_5102
       FROM ledger_entry_lines lel
       JOIN accounts a ON a.id = lel.account_id
      WHERE a.business_id = $1
        AND a.account_code IN ('5101', '5102')
        AND lel.entry_date BETWEEN $2 AND $3`,
    [businessId, fromDate, toDate],
  );

  const net5101 = Number(ledger.rows[0]?.net_5101 ?? 0);
  const net5102 = Number(ledger.rows[0]?.net_5102 ?? 0);
  const total = net5101 - net5102;

  // Header schedule (informational only — used by the P&L "Purchases" UI list).
  const header = await client.query(
    `SELECT
       p.id::text                     AS purchase_id,
       p.bill_number                  AS purchase_number,
       p.bill_date::text              AS purchase_date,
       p.grand_total::float           AS amount
       FROM purchases p
      WHERE p.business_id = $1
        AND p.bill_date BETWEEN $2 AND $3
        AND p.status != 'cancelled'
      ORDER BY p.bill_date`,
    [businessId, fromDate, toDate],
  );

  return {
    total,
    gross_purchases: net5101,
    returns: net5102,
    sources: {
      ledger_5101_net_debit: net5101,
      ledger_5102_net_credit: net5102,
    },
    count: header.rows.length,
    items: header.rows.map((r: any) => ({
      purchase_id: r.purchase_id,
      purchase_number: r.purchase_number,
      purchase_date: r.purchase_date,
      amount: Number(r.amount ?? 0),
    })),
  };
}

// =====================================================================
// Stock-on-date (date-aware via stock_movements)
//
//   qty(item, asOfDate) = current_stock − Σ(signed movements after asOfDate)
//
// Movement sign convention: type='in' is +qty, type='out' is −qty,
// type='adjustment' uses the signed quantity stored on the row (positive
// for upward adjustment, negative for shrinkage).
//
// For valuation, FIFO/Weighted-Avg both need the per-item *cost* on the
// as-of date. For Phase-4 we use a documented simplification:
//   - 'simple' / 'fifo' / 'weighted_avg' → unit cost = items.purchase_price
//     (the standard cost on the master). This matches what Tally calls
//     "Standard Cost Method" and what the existing snapshot table stores.
//   - True per-batch FIFO valuation will be a Phase-5 enhancement that
//     reads from item_batches; doing it now would balloon scope.
//
// If a snapshot exists for the closest matching FY, we PREFER it
// (most accurate, locked at year-end close). Otherwise we derive.
// =====================================================================
async function getStockOnDate(
  client: PoolClient,
  businessId: string,
  asOfDate: string,
  _valuationMethod: Phase4ValuationMethod,
  financialYearHint: string | undefined,
  kind: 'opening' | 'closing',
): Promise<COGSCalculation['openingStock']> {
  // 1. Try snapshot first (locked, most authoritative).
  if (financialYearHint) {
    const snap = await client.query(
      `SELECT
         css.item_id,
         i.name                                  AS item_name,
         SUM(css.quantity)::float                AS quantity,
         AVG(css.unit_cost)::float               AS unit_cost,
         SUM(css.total_value)::float             AS total_value
         FROM closing_stock_snapshots css
         JOIN items i ON css.item_id = i.id
        WHERE css.business_id = $1
          AND css.financial_year = $2
          AND i.item_type = 'goods'
          AND i.is_active = true
        GROUP BY css.item_id, i.name
        ORDER BY i.name`,
      [businessId, financialYearHint],
    );

    if (snap.rows.length > 0) {
      let qtyTotal = 0;
      let valTotal = 0;
      const items = snap.rows.map((r: any) => {
        const quantity = Number(r.quantity ?? 0);
        const total_value = Number(r.total_value ?? 0);
        qtyTotal += quantity;
        valTotal += total_value;
        return {
          item_id: r.item_id,
          item_name: r.item_name,
          quantity,
          unit_cost: Number(r.unit_cost ?? 0),
          total_value,
          unit_cost_source: 'snapshot' as const,
        };
      });
      return {
        quantity: qtyTotal,
        value: valTotal,
        items,
        as_of_date: asOfDate,
        source: 'snapshot',
      };
    }
  }

  // 2. Derive from current_stock − Σ(movements > asOfDate) per item.
  //
  //    PHASE-4 valuation rate (Q1 decision = Weighted-Average from purchase_items):
  //    For each item, the unit-cost used to value on-hand qty is:
  //
  //        rate = SUM(purchase_items.taxable_value) / SUM(purchase_items.quantity)
  //
  //    over every non-cancelled purchase up to (and including) asOfDate. This is
  //    Tally's "Avg. Cost" in Periodic mode and is explicitly permitted by Ind
  //    AS 2 ("Weighted Average Cost Method").
  //
  //    `taxable_value` (not `unit_price`) is the right rupee figure because it's
  //    "after trade discount, before tax" — i.e. the actual landed cost net of
  //    any volume/cash discount and excluding GST (which Phase-3 already strips
  //    out into 1110-1113).
  //
  //    Fallback chain when an item has zero purchase history before asOfDate
  //    (e.g. opening-balance-only stock):
  //        weighted-avg → items.purchase_price (item-master) → 0
  //
  //    NOTE: stock_movements.type uses 'in' / 'out' / 'adjustment' (per
  //    schema.sql line 177). Adjustments store the signed quantity on the row
  //    already, so the sign expression is consistent.
  const movementsDerived = await client.query(
    `WITH weighted_avg AS (
       SELECT
         pi.item_id,
         SUM(pi.taxable_value)::float / NULLIF(SUM(pi.quantity), 0)::float AS rate,
         SUM(pi.quantity)::float                                           AS qty_purchased
         FROM purchase_items pi
         JOIN purchases p ON p.id = pi.purchase_id
        WHERE p.business_id = $1
          AND p.bill_date <= $2::date
          AND p.status != 'cancelled'
          AND pi.item_id IS NOT NULL
          AND pi.quantity > 0
          AND pi.taxable_value > 0
        GROUP BY pi.item_id
     )
     SELECT
       i.id                                                                                    AS item_id,
       i.name                                                                                  AS item_name,
       COALESCE(i.current_stock, 0)::float                                                     AS current_stock,
       wa.rate                                                                                 AS weighted_avg_rate,
       COALESCE(i.purchase_price, 0)::float                                                    AS item_master_rate,
       COALESCE(wa.rate, i.purchase_price, 0)::float                                           AS unit_cost,
       CASE
         WHEN wa.rate IS NOT NULL THEN 'weighted_avg_purchases'
         WHEN i.purchase_price IS NOT NULL AND i.purchase_price > 0 THEN 'item_master_fallback'
         ELSE 'item_master_fallback'
       END                                                                                     AS unit_cost_source,
       COALESCE((
         SELECT SUM(
           CASE
             WHEN sm.type = 'in'         THEN  sm.quantity
             WHEN sm.type = 'out'        THEN -sm.quantity
             WHEN sm.type = 'adjustment' THEN  sm.quantity
             ELSE 0
           END
         )
           FROM stock_movements sm
          WHERE sm.business_id = $1
            AND sm.item_id     = i.id
            AND sm.created_at::date > $2::date
       ), 0)::float                                                                            AS movements_after_asof
       FROM items i
       LEFT JOIN weighted_avg wa ON wa.item_id = i.id
      WHERE i.business_id = $1
        AND i.item_type   = 'goods'
        AND i.is_active   = true`,
    [businessId, asOfDate],
  );

  let qtyTotal = 0;
  let valTotal = 0;
  let anyNonZero = false;
  const items: COGSItemBreakdown[] = [];

  for (const r of movementsDerived.rows as any[]) {
    const currentStock = Number(r.current_stock ?? 0);
    const after = Number(r.movements_after_asof ?? 0);
    // current_stock is the live, post-all-movements value. Subtract anything
    // that happened AFTER the as-of date to roll the clock back.
    const quantityAsOf = currentStock - after;
    const unitCost = Number(r.unit_cost ?? 0);
    const totalValue = Math.max(0, quantityAsOf) * unitCost;
    const unitCostSource =
      (r.unit_cost_source as 'weighted_avg_purchases' | 'item_master_fallback') ??
      'item_master_fallback';

    if (quantityAsOf !== 0 || unitCost !== 0) anyNonZero = true;

    if (quantityAsOf > 0) {
      items.push({
        item_id: r.item_id,
        item_name: r.item_name,
        quantity: quantityAsOf,
        unit_cost: unitCost,
        total_value: totalValue,
        unit_cost_source: unitCostSource,
      });
      qtyTotal += quantityAsOf;
      valTotal += totalValue;
    }
  }

  if (anyNonZero) {
    return {
      quantity: qtyTotal,
      value: valTotal,
      items,
      as_of_date: asOfDate,
      source: 'movements_derived',
    };
  }

  // 3. Last-resort fallback. For OPENING stock on a fresh business with no
  //    movements yet, items.opening_stock × purchase_price is the only signal
  //    we have. (Closing stock with zero movements means there really IS
  //    nothing in stock, so we return empty.)
  if (kind === 'opening') {
    const fallback = await client.query(
      `SELECT
         id                                              AS item_id,
         name                                            AS item_name,
         COALESCE(opening_stock, 0)::float               AS quantity,
         COALESCE(purchase_price, 0)::float              AS unit_cost,
         COALESCE(opening_stock * purchase_price, 0)::float AS total_value
         FROM items
        WHERE business_id = $1
          AND item_type   = 'goods'
          AND is_active   = true
          AND opening_stock > 0
        ORDER BY name`,
      [businessId],
    );
    if (fallback.rows.length > 0) {
      let q = 0;
      let v = 0;
      const fbItems = fallback.rows.map((r: any) => {
        const quantity = Number(r.quantity ?? 0);
        const total_value = Number(r.total_value ?? 0);
        q += quantity;
        v += total_value;
        return {
          item_id: r.item_id,
          item_name: r.item_name,
          quantity,
          unit_cost: Number(r.unit_cost ?? 0),
          total_value,
          unit_cost_source: 'item_master_fallback' as const,
        };
      });
      return {
        quantity: q,
        value: v,
        items: fbItems,
        as_of_date: asOfDate,
        source: 'items_opening_fallback',
      };
    }
  }

  return {
    quantity: 0,
    value: 0,
    items: [],
    as_of_date: asOfDate,
    source: kind === 'closing' ? 'current_stock_fallback' : 'empty',
  };
}

// Subtract one calendar day in YYYY-MM-DD form. Pure JS (no DB roundtrip).
function previousDay(isoDate: string): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
