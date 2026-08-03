import { NextRequest, NextResponse } from 'next/server';
import { queryRows, queryOne, query } from '@/lib/db';
import { requireTenantBusinessId } from '@/lib/auth-helpers';

export const dynamic = 'force-dynamic';

/**
 * GET /api/settings/online-store/orders?business_id=...&status=...&page=1
 * List store orders for admin.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const tenant = requireTenantBusinessId(request, searchParams.get('business_id'));
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const status = searchParams.get('status');
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10));
  const limit = 20;
  const offset = (page - 1) * limit;

  const conditions = ['so.business_id = $1'];
  const params: unknown[] = [businessId];
  let idx = 1;

  if (status) {
    idx++;
    conditions.push(`so.status = $${idx}`);
    params.push(status);
  }

  idx++;
  params.push(limit);
  const limitIdx = idx;
  idx++;
  params.push(offset);
  const offsetIdx = idx;

  const orders = await queryRows<Record<string, unknown>>(
    `SELECT
       so.id, so.order_number, so.customer_name, so.customer_phone,
       so.customer_email, so.customer_address, so.customer_pincode,
       so.delivery_mode, so.status, so.notes,
       so.subtotal::text, so.tax_total::text, so.delivery_charge::text, so.grand_total::text,
       so.cancelled_reason, so.created_at,
       br.name AS branch_name
     FROM store_orders so
     LEFT JOIN branches br ON br.id = so.branch_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY so.created_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params,
  );

  const countRow = await queryOne<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM store_orders so WHERE ${conditions.slice(0, status ? 2 : 1).join(' AND ')}`,
    params.slice(0, status ? 2 : 1),
  );

  return NextResponse.json({
    orders: orders.map((o) => ({
      ...o,
      subtotal: parseFloat(o.subtotal as string) || 0,
      tax_total: parseFloat(o.tax_total as string) || 0,
      delivery_charge: parseFloat(o.delivery_charge as string) || 0,
      grand_total: parseFloat(o.grand_total as string) || 0,
    })),
    total: parseInt(countRow?.count ?? '0', 10),
    page,
    limit,
  });
}

/**
 * PATCH /api/settings/online-store/orders
 * Update order status.
 */
export async function PATCH(request: NextRequest) {
  const body = await request.json();
  const tenant = requireTenantBusinessId(request, body.business_id);
  if (!tenant.ok) return tenant.response;
  const businessId = tenant.businessId;

  const { order_id, status, cancelled_reason } = body;

  if (!order_id) {
    return NextResponse.json({ error: 'order_id is required' }, { status: 400 });
  }

  const validStatuses = ['pending', 'confirmed', 'ready', 'delivered', 'cancelled'];
  if (!validStatuses.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 });
  }

  // If cancelling, restore stock
  if (status === 'cancelled') {
    const items = await queryRows<{
      item_id: string;
      variant_id: string | null;
      quantity: string;
    }>(
      `SELECT soi.item_id, soi.variant_id, soi.quantity::text
       FROM store_order_items soi
       INNER JOIN store_orders so ON so.id = soi.order_id
       WHERE soi.order_id = $1 AND so.business_id = $2 AND so.status != 'cancelled'`,
      [order_id, businessId],
    );

    for (const item of items) {
      const qty = parseFloat(item.quantity);
      if (item.variant_id) {
        await query(
          `UPDATE item_variants SET current_stock = current_stock + $1 WHERE id = $2`,
          [qty, item.variant_id],
        );
      } else {
        await query(
          `UPDATE items SET current_stock = current_stock + $1 WHERE id = $2 AND business_id = $3`,
          [qty, item.item_id, businessId],
        );
      }
    }
  }

  const updated = await queryOne(
    `UPDATE store_orders
     SET status = $1, cancelled_reason = $2, updated_at = CURRENT_TIMESTAMP
     WHERE id = $3 AND business_id = $4
     RETURNING id, status`,
    [status, cancelled_reason ?? null, order_id, businessId],
  );

  if (!updated) {
    return NextResponse.json({ error: 'Order not found' }, { status: 404 });
  }

  return NextResponse.json({ success: true });
}
