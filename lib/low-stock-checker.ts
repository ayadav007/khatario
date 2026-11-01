/**
 * Low Stock Checker (Supplier Hub)
 *
 * The reorder level belongs to the buyer: an item is low when its stock is at or below the
 * buyer's own `min_stock`. The alert goes to the business linked as that item's default
 * supplier, only while the link is approved and the buyer shares low stock with it.
 * Supplier-set thresholds (supplier_item_thresholds) are retired and no longer drive alerts.
 */

import { query, queryRows } from './db';
import { getBusinessSubscription, isSubscriptionOperationalStatus } from './subscription';

type LowStockCandidate = {
  item_id: string;
  item_name: string;
  current_stock: string | number;
  min_stock: string | number;
  customer_business_id: string;
  customer_name: string;
  customer_city: string | null;
  supplier_business_id: string;
};

/**
 * SQL: an item's stock. In warehouse mode stock is kept per location (location_stock) and
 * items.current_stock is not updated, so the sum over locations is used. Needs `i` (items); the
 * setting is read through to_jsonb so a database without the warehouse column still works.
 */
export const ITEM_STOCK_SQL = `(CASE WHEN COALESCE((SELECT (to_jsonb(bs) ->> 'warehouses_enabled')::boolean
      FROM business_settings bs WHERE bs.business_id = i.business_id LIMIT 1), false)
    THEN COALESCE((SELECT SUM(ls.current_stock_qty) FROM location_stock ls WHERE ls.item_id = i.id), 0)
    ELSE COALESCE(i.current_stock, 0) END)`;

/** Buyer items at or below their reorder level whose default supplier may see them. */
const CANDIDATES_SQL = `
  SELECT
    i.id AS item_id,
    i.name AS item_name,
    ${ITEM_STOCK_SQL} AS current_stock,
    i.min_stock,
    i.business_id AS customer_business_id,
    cb.name AS customer_name,
    cb.city AS customer_city,
    s.linked_business_id AS supplier_business_id
  FROM items i
  JOIN suppliers s
    ON s.id = i.default_supplier_id
   AND s.business_id = i.business_id
   AND s.linked_business_id IS NOT NULL
   AND s.approval_status = 'approved'
   AND s.allow_low_stock_access = true
   AND s.deleted_at IS NULL
  JOIN businesses cb ON cb.id = i.business_id
  WHERE i.deleted_at IS NULL
    AND COALESCE(i.is_active, true) = true
    AND COALESCE(i.item_type, 'goods') <> 'service'
    AND COALESCE(i.min_stock, 0) > 0
    AND ${ITEM_STOCK_SQL} <= i.min_stock
`;

async function supplierIsOperational(supplierBusinessId: string, cache: Map<string, boolean>) {
  if (cache.has(supplierBusinessId)) return cache.get(supplierBusinessId)!;
  let ok = false;
  try {
    const subscription = await getBusinessSubscription(supplierBusinessId, false, 'billing');
    ok = !!subscription && isSubscriptionOperationalStatus(subscription.status);
    if (ok && subscription?.end_date) {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      ok = new Date(subscription.end_date) >= today;
    }
  } catch {
    ok = false;
  }
  cache.set(supplierBusinessId, ok);
  return ok;
}

/** Open one active alert per supplier/buyer/item and notify the supplier. Returns alerts created. */
async function raiseAlerts(candidates: LowStockCandidate[]): Promise<number> {
  const subscriptionCache = new Map<string, boolean>();
  let created = 0;

  for (const c of candidates) {
    if (!(await supplierIsOperational(c.supplier_business_id, subscriptionCache))) continue;

    const inserted = await query(
      `
      INSERT INTO low_stock_alerts (
        supplier_business_id, customer_business_id, item_id, threshold_id,
        current_stock, threshold, alert_status, first_alerted_at
      )
      SELECT $1, $2, $3, NULL, $4, $5, 'active', CURRENT_TIMESTAMP
      WHERE NOT EXISTS (
        SELECT 1 FROM low_stock_alerts
        WHERE supplier_business_id = $1 AND customer_business_id = $2
          AND item_id = $3 AND alert_status = 'active'
      )
      `,
      [c.supplier_business_id, c.customer_business_id, c.item_id, c.current_stock, c.min_stock]
    );
    if (!inserted.rowCount) continue;
    created++;

    await query(
      `
      INSERT INTO notifications (
        business_id, type, title, message, reference_type, reference_id, created_at
      )
      VALUES ($1, 'low_stock_alert', $2, $3, 'item', $4, CURRENT_TIMESTAMP)
      `,
      [
        c.supplier_business_id,
        `Low stock at ${c.customer_name}: ${c.item_name}`,
        `${c.customer_name}${c.customer_city ? ` (${c.customer_city})` : ''} has ${Number(c.current_stock)} of ${c.item_name} left, at or below their reorder level of ${Number(c.min_stock)}.`,
        c.item_id,
      ]
    );
  }
  return created;
}

/**
 * Resolve active alerts that no longer apply: stock is back above the reorder level, or the
 * item's default supplier / sharing changed. Optionally limited to one buyer item.
 */
async function resolveStaleAlerts(scope?: { itemId: string; businessId: string }): Promise<number> {
  const params: any[] = [];
  let scopeSql = '';
  if (scope) {
    params.push(scope.itemId, scope.businessId);
    scopeSql = 'AND a.item_id = $1 AND a.customer_business_id = $2';
  }
  const res = await query(
    `
    UPDATE low_stock_alerts a
    SET alert_status = 'resolved', resolved_at = CURRENT_TIMESTAMP
    WHERE a.alert_status = 'active'
      ${scopeSql}
      AND NOT EXISTS (
        SELECT 1
        FROM items i
        JOIN suppliers s
          ON s.id = i.default_supplier_id
         AND s.business_id = i.business_id
         AND s.linked_business_id = a.supplier_business_id
         AND s.approval_status = 'approved'
         AND s.allow_low_stock_access = true
         AND s.deleted_at IS NULL
        WHERE i.id = a.item_id
          AND i.business_id = a.customer_business_id
          AND i.deleted_at IS NULL
          AND COALESCE(i.min_stock, 0) > 0
          AND ${ITEM_STOCK_SQL} <= i.min_stock
      )
    `,
    params
  );
  return res.rowCount || 0;
}

export async function checkLowStockForItem(itemId: string, businessId: string) {
  try {
    const candidates = await queryRows<LowStockCandidate>(
      `${CANDIDATES_SQL} AND i.id = $1 AND i.business_id = $2`,
      [itemId, businessId]
    );
    await raiseAlerts(candidates);
    await resolveStaleAlerts({ itemId, businessId });
  } catch (error) {
    // Never break the stock movement that triggered the check
    console.error('Error checking low stock for item:', error);
  }
}

export async function checkLowStockForMultipleItems(items: Array<{ item_id: string; business_id: string }>) {
  for (const item of items) {
    await checkLowStockForItem(item.item_id, item.business_id);
  }
}

/**
 * Stock changes run inside a transaction, so a check made there reads the old quantity.
 * Shared stock helpers queue the item here instead; the queue is checked a few seconds later,
 * once the caller has committed. The cron sweep catches anything still uncommitted by then.
 */
const QUEUE_DELAY_MS = 3000;
const queued = new Map<string, { item_id: string; business_id: string }>();
let queueTimer: ReturnType<typeof setTimeout> | null = null;

export function queueLowStockCheck(businessId: string, itemId: string) {
  if (!businessId || !itemId) return;
  queued.set(`${businessId}|${itemId}`, { item_id: itemId, business_id: businessId });
  if (queueTimer) return;
  queueTimer = setTimeout(() => {
    queueTimer = null;
    const batch = Array.from(queued.values());
    queued.clear();
    checkLowStockForMultipleItems(batch).catch((error) =>
      console.error('Error checking queued low stock:', error)
    );
  }, QUEUE_DELAY_MS);
  queueTimer.unref?.();
}

/** Full sweep used by the cron job. */
export async function checkLowStockForAllBusinesses() {
  const candidates = await queryRows<LowStockCandidate>(CANDIDATES_SQL);
  const alertsCreated = await raiseAlerts(candidates);
  const alertsResolved = await resolveStaleAlerts();
  return { items_checked: candidates.length, alerts_created: alertsCreated, alerts_resolved: alertsResolved };
}
