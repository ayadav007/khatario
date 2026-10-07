import type { PoolClient } from 'pg';

/**
 * Server-side stock reservations for sales orders (Vyapar-style).
 * Uses stock_reservations: reserved_for_type = 'sales_order'.
 * On-hand is unchanged until invoice; available = on-hand − active reserved.
 */

export type ReservationLine = {
  item_id: string | null;
  variant_id?: string | null;
  qty: number;
};

async function resolveWarehouseId(
  client: PoolClient,
  businessId: string,
  branchId: string | null,
): Promise<string | null> {
  const { isWarehouseModeEnabled } = await import('@/lib/warehouse-mode');
  if (!(await isWarehouseModeEnabled(businessId))) {
    // Still reserve if the branch has a default warehouse (multi-location stock).
  }
  if (!branchId) return null;
  const { getDefaultWarehouseForBranch } = await import('@/lib/warehouse-access');
  return getDefaultWarehouseForBranch(branchId);
}

/** Replace active reservations for a sales order with the given lines. */
export async function syncSalesOrderReservations(
  client: PoolClient,
  p: {
    businessId: string;
    salesOrderId: string;
    branchId: string | null;
    userId?: string | null;
    lines: ReservationLine[];
    /** Optional TTL (WhatsApp unpaid pay-link holds). */
    expiresAt?: Date | null;
  },
): Promise<{ reserved: number; warehouseId: string | null }> {
  let branchId = p.branchId;
  if (!branchId) {
    try {
      const { resolveBranchId } = await import('@/lib/branch-helpers');
      branchId = await resolveBranchId({ businessId: p.businessId, branchId: null });
    } catch {
      branchId = null;
    }
  }
  const warehouseId = await resolveWarehouseId(client, p.businessId, branchId);
  if (!warehouseId) {
    return { reserved: 0, warehouseId: null };
  }

  await client.query(
    `UPDATE stock_reservations
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3
      WHERE business_id = $1 AND reserved_for_type = 'sales_order' AND reserved_for_id = $2
        AND status = 'active'`,
    [p.businessId, p.salesOrderId, p.userId || null],
  );

  let reserved = 0;
  const expiresAt = p.expiresAt ?? null;
  for (const line of p.lines) {
    if (!line.item_id) continue;
    const qty = Number(line.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    await client.query(
      `INSERT INTO stock_reservations (
         business_id, location_id, item_id, variant_id, quantity,
         reserved_for_type, reserved_for_id, status, created_by, expires_at
       ) VALUES ($1, $2, $3, $4, $5, 'sales_order', $6, 'active', $7, $8)`,
      [
        p.businessId,
        warehouseId,
        line.item_id,
        line.variant_id || null,
        qty,
        p.salesOrderId,
        p.userId || null,
        expiresAt,
      ],
    );
    reserved += 1;
  }
  return { reserved, warehouseId };
}

/** Expire unpaid WhatsApp draft holds past TTL; cancel SO + reservation. */
export async function expireWhatsAppUnpaidReservations(
  client: PoolClient,
): Promise<{ expiredOrders: number; expiredReservations: number }> {
  const expiredRes = await client.query(
    `UPDATE stock_reservations
        SET status = 'expired', cancelled_at = CURRENT_TIMESTAMP
      WHERE status = 'active'
        AND expires_at IS NOT NULL
        AND expires_at < CURRENT_TIMESTAMP
      RETURNING id, business_id, reserved_for_id`,
  );

  const orderIds = new Set<string>();
  for (const row of expiredRes.rows) {
    if (row.reserved_for_id) orderIds.add(String(row.reserved_for_id));
  }

  let expiredOrders = 0;
  for (const orderId of orderIds) {
    const res = await client.query(
      `UPDATE sales_orders
          SET status = 'cancelled',
              updated_at = CURRENT_TIMESTAMP,
              notes = COALESCE(notes, '') || E'\n[cancelled: unpaid reservation expired]'
        WHERE id = $1
          AND status = 'draft'
          AND COALESCE(payment_status, 'unpaid') = 'unpaid'
          AND converted_invoice_id IS NULL
          AND whatsapp_conversation_id IS NOT NULL`,
      [orderId],
    );
    expiredOrders += res.rowCount ?? 0;
  }

  return { expiredOrders, expiredReservations: expiredRes.rowCount ?? 0 };
}

/** Cancel all active reservations for a sales order (cancel / draft revert). */
export async function cancelSalesOrderReservations(
  client: PoolClient,
  p: { businessId: string; salesOrderId: string; userId?: string | null },
): Promise<void> {
  await client.query(
    `UPDATE stock_reservations
        SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = $3
      WHERE business_id = $1 AND reserved_for_type = 'sales_order' AND reserved_for_id = $2
        AND status = 'active'`,
    [p.businessId, p.salesOrderId, p.userId || null],
  );
}

/**
 * After invoicing qty from an SO line, reduce active reservation for that item.
 * Releases fully when remaining reserved would be ≤ 0.
 */
export async function releaseSalesOrderReservationQty(
  client: PoolClient,
  p: {
    businessId: string;
    salesOrderId: string;
    itemId: string | null;
    variantId?: string | null;
    quantity: number;
    userId?: string | null;
  },
): Promise<void> {
  if (!p.itemId) return;
  const qty = Number(p.quantity);
  if (!Number.isFinite(qty) || qty <= 0) return;

  const rows = await client.query<{ id: string; quantity: string }>(
    `SELECT id, quantity::text
       FROM stock_reservations
      WHERE business_id = $1 AND reserved_for_type = 'sales_order' AND reserved_for_id = $2
        AND item_id = $3 AND status = 'active'
        AND variant_id IS NOT DISTINCT FROM $4
      ORDER BY created_at ASC
      FOR UPDATE`,
    [p.businessId, p.salesOrderId, p.itemId, p.variantId || null],
  );

  let left = qty;
  for (const row of rows.rows) {
    if (left <= 0) break;
    const current = Number(row.quantity) || 0;
    if (current <= left + 0.0001) {
      await client.query(
        `UPDATE stock_reservations
            SET status = 'fulfilled', fulfilled_at = CURRENT_TIMESTAMP, quantity = 0
          WHERE id = $1`,
        [row.id],
      );
      left -= current;
    } else {
      await client.query(`UPDATE stock_reservations SET quantity = $2 WHERE id = $1`, [
        row.id,
        current - left,
      ]);
      left = 0;
    }
  }
}

export async function sumActiveReservedQty(
  client: PoolClient,
  p: { businessId: string; itemId: string; locationId?: string | null; variantId?: string | null },
): Promise<number> {
  const res = await client.query<{ q: string }>(
    `SELECT COALESCE(SUM(quantity), 0)::text AS q
       FROM stock_reservations
      WHERE business_id = $1 AND item_id = $2 AND status = 'active'
        AND ($3::uuid IS NULL OR location_id = $3)
        AND variant_id IS NOT DISTINCT FROM $4`,
    [p.businessId, p.itemId, p.locationId || null, p.variantId || null],
  );
  return Number(res.rows[0]?.q) || 0;
}
