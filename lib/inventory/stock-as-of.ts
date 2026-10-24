import { queryRows } from '@/lib/db';

/**
 * Effective (document) date of each stock movement, so backdated bills and invoices fall in the
 * right period. Cancellations use the day they were recorded.
 */
const MOVEMENT_DATE_SQL = `
  COALESCE(
    CASE sm.reference_type
      WHEN 'invoice' THEN (SELECT inv.invoice_date FROM invoices inv WHERE inv.id = sm.reference_id)
      WHEN 'purchase' THEN (SELECT pu.bill_date FROM purchases pu WHERE pu.id = sm.reference_id)
      WHEN 'purchase_return' THEN (SELECT pr.return_date FROM purchase_returns pr WHERE pr.id = sm.reference_id)
      WHEN 'credit_note' THEN (SELECT cn.credit_note_date FROM credit_notes cn WHERE cn.id = sm.reference_id)
      WHEN 'adjustment' THEN (SELECT ia.adjustment_date FROM inventory_adjustments ia WHERE ia.id = sm.reference_id)
      WHEN 'transfer' THEN (SELECT st.transfer_date::date FROM stock_transfers st WHERE st.id = sm.reference_id)
      WHEN 'stock_transfer' THEN (SELECT st.transfer_date::date FROM stock_transfers st WHERE st.id = sm.reference_id)
    END,
    sm.created_at::date
  )`;

export const SIGNED_MOVEMENT_QTY_SQL = `
  CASE sm.type
    WHEN 'in' THEN ABS(sm.quantity)
    WHEN 'out' THEN -ABS(sm.quantity)
    ELSE sm.quantity
  END`;

/**
 * Net stock movement per item recorded after `asOfDate` (document date). Subtract it from the
 * current quantity to get the quantity held at the end of `asOfDate`.
 */
export async function movementsAfter(
  businessId: string,
  asOfDate: string,
  opts: { locationId?: string | null } = {}
): Promise<Map<string, number>> {
  const params: unknown[] = [businessId, asOfDate];
  let locationFilter = '';
  if (opts.locationId) {
    params.push(opts.locationId);
    locationFilter = ` AND sm.location_id = $3`;
  }
  const rows = await queryRows<{ item_id: string; qty: string }>(
    `SELECT sm.item_id, SUM(${SIGNED_MOVEMENT_QTY_SQL}) AS qty
       FROM stock_movements sm
      WHERE sm.business_id = $1 ${locationFilter}
        AND ${MOVEMENT_DATE_SQL} > $2::date
      GROUP BY sm.item_id`,
    params
  );
  return new Map(rows.map((r) => [r.item_id, Number(r.qty) || 0]));
}

export function quantityAsOf(current: number, after: Map<string, number>, itemId: string): number {
  return Math.round(((Number(current) || 0) - (after.get(itemId) || 0)) * 1000) / 1000;
}
