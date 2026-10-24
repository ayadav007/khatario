import { getPool } from '@/lib/db';
import { syncSalesOrderReservations } from '@/lib/stock/sales-order-reservations';

/** Unpaid WhatsApp pay-link hold length (minutes). */
export const WHATSAPP_RESERVE_TTL_MINUTES = 45;

/**
 * Reserve stock for a WhatsApp prepaid draft after a gateway pay link is created.
 * Auto-expires via expires_at + cron if unpaid.
 */
export async function reserveWhatsAppShopOrder(input: {
  businessId: string;
  orderId: string;
  lines: Array<{ item_id?: string | null; quantity: number }>;
}): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query<{ branch_id: string | null }>(
      `SELECT branch_id FROM sales_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [input.orderId, input.businessId],
    );
    if (order.rows.length === 0) {
      await client.query('ROLLBACK');
      return;
    }
    const expiresAt = new Date(Date.now() + WHATSAPP_RESERVE_TTL_MINUTES * 60 * 1000);
    await syncSalesOrderReservations(client, {
      businessId: input.businessId,
      salesOrderId: input.orderId,
      branchId: order.rows[0]?.branch_id ?? null,
      lines: input.lines.map((l) => ({
        item_id: l.item_id || null,
        qty: Number(l.quantity) || 0,
      })),
      expiresAt,
    });
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    console.error('[whatsapp-shop] reserve failed:', e instanceof Error ? e.message : e);
  } finally {
    client.release();
  }
}
