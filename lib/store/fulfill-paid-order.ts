import { getPool, queryRows } from '@/lib/db';

export async function fulfillStoreOrderPayment(orderId: string, businessId: string): Promise<void> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query<{
      id: string;
      payment_status: string;
      status: string;
      coupon_code: string | null;
      customer_phone: string;
      order_number: string;
      grand_total: string;
    }>(
      `SELECT id, payment_status, status, coupon_code, customer_phone, order_number, grand_total::text
       FROM store_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId],
    );
    const row = order.rows[0];
    if (!row) {
      await client.query('ROLLBACK');
      return;
    }
    if (row.payment_status === 'paid') {
      await client.query('COMMIT');
      return;
    }

    const items = await queryRows<{
      item_id: string;
      variant_id: string | null;
      item_name: string;
      quantity: string;
    }>(
      `SELECT item_id, variant_id, item_name, quantity::text FROM store_order_items WHERE order_id = $1`,
      [orderId],
    );

    if (row.payment_status === 'unpaid') {
      for (const item of items) {
        const qty = parseFloat(item.quantity);
        if (item.variant_id) {
          const stock = await client.query(
            `UPDATE item_variants SET current_stock = current_stock - $1
             WHERE id = $2 AND current_stock >= $1 RETURNING id`,
            [qty, item.variant_id],
          );
          if (stock.rowCount === 0) {
            await client.query('ROLLBACK');
            throw new Error(`"${item.item_name}" is out of stock`);
          }
        } else {
          const stock = await client.query(
            `UPDATE items SET current_stock = current_stock - $1
             WHERE id = $2 AND business_id = $3 AND current_stock >= $1 RETURNING id`,
            [qty, item.item_id, businessId],
          );
          if (stock.rowCount === 0) {
            await client.query('ROLLBACK');
            throw new Error(`"${item.item_name}" is out of stock`);
          }
        }
      }
    }

    await client.query(
      `UPDATE store_orders
       SET payment_status = 'paid', status = CASE WHEN status = 'pending' THEN 'confirmed' ELSE status END,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $1`,
      [orderId],
    );
    await client.query('COMMIT');

    const { incrementStoreCouponUse } = await import('@/lib/store/coupons');
    await incrementStoreCouponUse(businessId, row.coupon_code);
    const { notifyStoreCustomerWhatsApp } = await import('@/lib/store/notify-whatsapp');
    void notifyStoreCustomerWhatsApp({
      businessId,
      phone: row.customer_phone,
      text: `Order ${row.order_number} is paid. Total ₹${(parseFloat(row.grand_total) || 0).toLocaleString('en-IN')}. Thank you.`,
    });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  await createInvoiceForStoreOrder(orderId, businessId).catch((err) => {
    console.error('[store invoice]', err);
  });
}

export async function createInvoiceForStoreOrder(
  orderId: string,
  businessId: string,
): Promise<string | null> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const order = await client.query(
      `SELECT * FROM store_orders WHERE id = $1 AND business_id = $2 FOR UPDATE`,
      [orderId, businessId],
    );
    const o = order.rows[0] as
      | {
          invoice_id: string | null;
          branch_id: string | null;
          grand_total: string;
          subtotal: string;
          order_number: string;
          payment_status: string;
        }
      | undefined;
    if (!o) {
      await client.query('ROLLBACK');
      return null;
    }
    if (o.invoice_id) {
      await client.query('COMMIT');
      return o.invoice_id;
    }

    const biz = await client.query(
      `SELECT next_invoice_number FROM businesses WHERE id = $1 FOR UPDATE`,
      [businessId],
    );
    const nextNum = Number(biz.rows[0]?.next_invoice_number ?? 1);
    const invoiceNumber = `INV-${String(nextNum).padStart(4, '0')}`;
    const today = new Date().toISOString().slice(0, 10);
    const paid = o.payment_status === 'paid' || o.payment_status === 'cod';
    const grand = parseFloat(String(o.grand_total)) || 0;
    const sub = parseFloat(String(o.subtotal)) || 0;

    const inv = await client.query(
        `INSERT INTO invoices (
        business_id, branch_id, invoice_number, invoice_date, due_date,
        status, payment_status, subtotal, grand_total, paid_amount, balance_amount,
        document_type, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id`,
      [
        businessId,
        o.branch_id,
        invoiceNumber,
        today,
        today,
        'final',
        paid ? 'paid' : 'unpaid',
        sub,
        grand,
        paid ? grand : 0,
        paid ? 0 : grand,
        'tax_invoice',
      ],
    );
    const invoiceId = inv.rows[0].id as string;

    const items = await client.query(
      `SELECT item_id, item_name, quantity, unit_price, line_total, tax_rate
       FROM store_order_items WHERE order_id = $1`,
      [orderId],
    );
    for (const item of items.rows) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, item_id, item_name, quantity, unit_price, line_total, tax_rate
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          invoiceId,
          item.item_id,
          item.item_name,
          item.quantity,
          item.unit_price,
          item.line_total,
          item.tax_rate,
        ],
      );
    }

    await client.query(
      `UPDATE store_orders SET invoice_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
      [invoiceId, orderId],
    );
    await client.query(
      `UPDATE businesses SET next_invoice_number = next_invoice_number + 1 WHERE id = $1`,
      [businessId],
    );
    await client.query('COMMIT');
    return invoiceId;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
