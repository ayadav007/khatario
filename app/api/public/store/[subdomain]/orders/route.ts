import { NextRequest, NextResponse } from 'next/server';
import { queryOne, queryRows, query, getPool } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';

export const dynamic = 'force-dynamic';

interface OrderItem {
  item_id: string;
  variant_id?: string;
  item_name: string;
  variant_name?: string;
  quantity: number;
  unit: string;
  unit_price: number;
  tax_rate: number;
}

/**
 * POST /api/public/store/{subdomain}/orders
 * Place a guest order.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const pool = getPool();
  const client = await pool.connect();

  try {
    const store = await resolveStoreBySubdomain(params.subdomain);
    if (!store) {
      return NextResponse.json({ error: 'Store not found' }, { status: 404 });
    }

    const body = await request.json();
    const {
      branch_id,
      customer_name,
      customer_phone,
      customer_email,
      customer_address,
      customer_pincode,
      delivery_mode,
      notes,
      items,
    } = body as {
      branch_id?: string;
      customer_name: string;
      customer_phone: string;
      customer_email?: string;
      customer_address?: string;
      customer_pincode?: string;
      delivery_mode: 'delivery' | 'pickup';
      notes?: string;
      items: OrderItem[];
    };

    if (!customer_name?.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    if (!customer_phone?.trim()) {
      return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
    }
    if (!items?.length) {
      return NextResponse.json({ error: 'Cart is empty' }, { status: 400 });
    }
    if (delivery_mode === 'delivery' && !customer_address?.trim()) {
      return NextResponse.json(
        { error: 'Delivery address is required' },
        { status: 400 },
      );
    }

    // Generate order number
    const countRow = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM store_orders WHERE business_id = $1`,
      [store.business_id],
    );
    const orderNum = `SO-${(parseInt(countRow?.count ?? '0', 10) + 1)
      .toString()
      .padStart(4, '0')}`;

    // Calculate totals
    let subtotal = 0;
    let taxTotal = 0;
    const orderItems: Array<OrderItem & { line_total: number }> = [];

    for (const item of items) {
      const lineTotal = item.unit_price * item.quantity;
      const lineTax = lineTotal * (item.tax_rate / (100 + item.tax_rate));
      subtotal += lineTotal;
      taxTotal += lineTax;
      orderItems.push({ ...item, line_total: lineTotal });
    }

    // TODO: Calculate delivery charge based on branch zone + distance
    const deliveryCharge = 0;
    const grandTotal = subtotal + deliveryCharge;

    // Min order check
    if (store.store_min_order_amount && subtotal < store.store_min_order_amount) {
      return NextResponse.json(
        {
          error: `Minimum order amount is ₹${store.store_min_order_amount}`,
        },
        { status: 400 },
      );
    }

    await client.query('BEGIN');

    // Verify stock and atomically decrement
    for (const item of orderItems) {
      if (item.variant_id) {
        const stock = await client.query(
          `UPDATE item_variants SET current_stock = current_stock - $1
           WHERE id = $2 AND current_stock >= $1
           RETURNING current_stock`,
          [item.quantity, item.variant_id],
        );
        if (stock.rowCount === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: `"${item.item_name} (${item.variant_name})" is out of stock` },
            { status: 409 },
          );
        }
      } else {
        const stock = await client.query(
          `UPDATE items SET current_stock = current_stock - $1
           WHERE id = $2 AND business_id = $3 AND current_stock >= $1
           RETURNING current_stock`,
          [item.quantity, item.item_id, store.business_id],
        );
        if (stock.rowCount === 0) {
          await client.query('ROLLBACK');
          return NextResponse.json(
            { error: `"${item.item_name}" is out of stock` },
            { status: 409 },
          );
        }
      }
    }

    // Create order
    const order = await client.query(
      `INSERT INTO store_orders
         (business_id, branch_id, order_number,
          customer_name, customer_phone, customer_email,
          customer_address, customer_pincode,
          delivery_mode, notes,
          subtotal, tax_total, delivery_charge, grand_total)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, order_number`,
      [
        store.business_id,
        branch_id ?? null,
        orderNum,
        customer_name.trim(),
        customer_phone.trim(),
        customer_email?.trim() ?? null,
        customer_address?.trim() ?? null,
        customer_pincode?.trim() ?? null,
        delivery_mode ?? 'delivery',
        notes?.trim() ?? null,
        subtotal,
        taxTotal,
        deliveryCharge,
        grandTotal,
      ],
    );

    const orderId = order.rows[0].id;

    // Insert order items
    for (const item of orderItems) {
      await client.query(
        `INSERT INTO store_order_items
           (order_id, item_id, variant_id, item_name, variant_name,
            quantity, unit, unit_price, tax_rate, line_total)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          orderId,
          item.item_id,
          item.variant_id ?? null,
          item.item_name,
          item.variant_name ?? null,
          item.quantity,
          item.unit,
          item.unit_price,
          item.tax_rate,
          item.line_total,
        ],
      );
    }

    await client.query('COMMIT');

    return NextResponse.json({
      order_id: orderId,
      order_number: orderNum,
      grand_total: grandTotal,
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('[store order]', error);
    return NextResponse.json(
      { error: 'Failed to place order' },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}
