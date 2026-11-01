/**
 * The business approves or rejects a khata store order that a rule sent for approval
 * (docs/plan/STORE_KHATA.md, section 3). Approve bills it on the khata; reject cancels the
 * order, releases its stock hold and tells the shopper to order again another way.
 */
import { getPool } from '@/lib/db';
import { transitionStoreOrderInTransaction } from '@/lib/store/order-lifecycle';
import { KhataError, getKhataSettings } from './service';
import { khataPayBy } from './cycle';

type PendingOrder = {
  id: string;
  order_number: string;
  customer_name: string;
  customer_phone: string;
  grand_total: string;
  status: string;
  payment_provider: string | null;
  khata_approval: string | null;
  khata_due_date: Date | string | null;
};

function ymd(v: Date | string | null): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  return String(v).slice(0, 10);
}

async function lockPending(client: import('pg').PoolClient, businessId: string, orderId: string): Promise<PendingOrder> {
  const r = await client.query<PendingOrder>(
    `SELECT id, order_number, customer_name, customer_phone, grand_total::text, status,
            payment_provider, khata_approval, khata_due_date
       FROM store_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
    [orderId, businessId],
  );
  const o = r.rows[0];
  if (!o || o.payment_provider !== 'khata') throw new KhataError('Khata order not found', 404, 'ORDER_NOT_FOUND');
  if (o.khata_approval !== 'pending') {
    throw new KhataError(`This khata order is already ${o.khata_approval ?? 'approved'}`, 409, 'NOT_PENDING');
  }
  if (o.status === 'cancelled') throw new KhataError('This order is cancelled', 409, 'ORDER_CANCELLED');
  return o;
}

export async function approveKhataOrder(input: {
  businessId: string;
  orderId: string;
  actorUserId: string;
}): Promise<{ invoiceId: string | null; invoiceError: string | null }> {
  const client = await getPool().connect();
  let order: PendingOrder;
  try {
    await client.query('BEGIN');
    order = await lockPending(client, input.businessId, input.orderId);
    await client.query(
      `UPDATE store_orders SET khata_approval = 'approved', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2`,
      [input.orderId, input.businessId],
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  let invoiceId: string | null = null;
  let invoiceError: string | null = null;
  try {
    const { createInvoiceForStoreOrder } = await import('@/lib/store/fulfill-paid-order');
    invoiceId = await createInvoiceForStoreOrder(input.orderId, input.businessId, input.actorUserId);
  } catch (err) {
    console.error('[khata approve invoice]', err);
    invoiceError = err instanceof Error ? err.message : 'The bill could not be posted';
  }

  const settings = await getKhataSettings(input.businessId);
  const due = ymd(order.khata_due_date);
  const { notifyCustomerKhataOrder } = await import('./notify');
  void notifyCustomerKhataOrder({
    businessId: input.businessId,
    phone: order.customer_phone,
    customerName: order.customer_name,
    orderNumber: order.order_number,
    total: Number(order.grand_total) || 0,
    payBy: due ? khataPayBy(due, settings.graceDays) : null,
    kind: 'placed',
  });
  return { invoiceId, invoiceError };
}

export async function rejectKhataOrder(input: {
  businessId: string;
  orderId: string;
  actorUserId: string;
  reason?: string | null;
}): Promise<void> {
  const client = await getPool().connect();
  let order: PendingOrder;
  try {
    await client.query('BEGIN');
    order = await lockPending(client, input.businessId, input.orderId);
    await client.query(
      `UPDATE store_orders SET khata_approval = 'rejected', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND business_id = $2`,
      [input.orderId, input.businessId],
    );
    const moved = await transitionStoreOrderInTransaction(client, {
      businessId: input.businessId,
      orderId: input.orderId,
      to: 'cancelled',
      cancelledReason: input.reason?.trim() || 'Khata order not approved',
      actorUserId: input.actorUserId,
    });
    if (!moved.ok) throw new KhataError(moved.error, moved.status, moved.code);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
  const { notifyCustomerKhataOrder } = await import('./notify');
  void notifyCustomerKhataOrder({
    businessId: input.businessId,
    phone: order.customer_phone,
    customerName: order.customer_name,
    orderNumber: order.order_number,
    total: Number(order.grand_total) || 0,
    payBy: null,
    kind: 'rejected',
  });
}
