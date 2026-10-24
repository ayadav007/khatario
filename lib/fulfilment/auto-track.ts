import { getPool } from '@/lib/db';
import { loadOrderUpdateSettings } from './hub';
import { ensureFulfilment } from './service';

/**
 * A manual bill that has a shipping address is a delivery: start tracking it straight away so it
 * shows up under "To pack" instead of waiting for someone to press "Start delivery tracking".
 * Opt-out per business (Orders & delivery > Buyer updates). Best effort: never fails the bill.
 */
export async function autoTrackDeliveryBill(businessId: string, invoiceId: string): Promise<string | null> {
  try {
    const settings = await loadOrderUpdateSettings(businessId);
    if (!settings.autoTrackShippedBills) return null;
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      const inv = await client.query<{
        id: string;
        branch_id: string | null;
        customer_id: string | null;
        channel: string | null;
        status: string;
        document_type: string | null;
        shipping_address: string | null;
        sales_order_id: string | null;
        customer_name: string | null;
        customer_phone: string | null;
      }>(
        `SELECT i.id, i.branch_id, i.customer_id, i.channel, i.status, i.document_type, i.shipping_address, i.sales_order_id,
                c.name AS customer_name, c.phone AS customer_phone
           FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
          WHERE i.id = $1 AND i.business_id = $2 AND i.deleted_at IS NULL`,
        [invoiceId, businessId],
      );
      const i = inv.rows[0];
      const eligible =
        i &&
        i.status === 'final' &&
        (i.channel ?? 'manual') === 'manual' &&
        !i.sales_order_id &&
        (i.document_type ?? 'tax_invoice') !== 'proforma_invoice' &&
        (i.shipping_address ?? '').trim().length > 0;
      if (!eligible) {
        await client.query('ROLLBACK');
        return null;
      }
      const { row } = await ensureFulfilment(client, {
        businessId,
        channel: 'manual',
        invoiceId: i.id,
        branchId: i.branch_id,
        customerId: i.customer_id,
        buyerName: i.customer_name,
        buyerPhone: i.customer_phone,
        status: 'confirmed',
        method: null,
        actorType: 'system',
        note: 'Bill has a shipping address: delivery tracking started',
      });
      await client.query(
        `UPDATE order_fulfilments SET ship_address = COALESCE(ship_address, $3) WHERE id = $1 AND business_id = $2`,
        [row.id, businessId, i.shipping_address!.trim().slice(0, 500)],
      );
      await client.query('COMMIT');
      return row.id;
    } catch (e) {
      await client.query('ROLLBACK').catch(() => {});
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('[auto-track bill]', err);
    return null;
  }
}
