import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { loadOrderForParty, transitionSupplyOrder, SupplyOrderInputError } from '@/lib/supply-orders';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supply-orders/[id] — the order for either of its businesses. Each side sees its own
 * item and unit per line; quantities are given in both units.
 */
export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { order, role } = await loadOrderForParty(params.id, auth.businessId);
    if (role === 'buyer' && order.status === 'draft') throw new SupplyOrderInputError('Order not found', 404);
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'read');

    const lines = await db.queryRows(
      `
      SELECT l.id, l.item_name, l.qty, l.confirmed_qty, l.buyer_units_per_vendor_unit AS factor,
             l.buyer_item_id, l.vendor_item_id,
             ${role === 'vendor' ? 'l.buyer_stock_at_suggestion,' : ''}
             bi.name AS buyer_item_name, bi.unit AS buyer_unit,
             ${role === 'buyer' ? 'bi.current_stock AS buyer_current_stock, bi.min_stock AS buyer_min_stock,' : ''}
             vi.name AS vendor_item_name, vi.unit AS vendor_unit,
             ${
               role === 'vendor'
                 ? 'vi.current_stock AS vendor_current_stock, vi.selling_price AS vendor_price, vi.selling_price AS unit_price'
                 : // The buyer sees the supplier's catalog price, or its list price; never one the catalog hides.
                   "CASE WHEN pl.price_display = 'hidden' THEN NULL ELSE COALESCE(pl.price, vi.selling_price) END AS unit_price"
             }
      FROM supply_order_lines l
      LEFT JOIN items bi ON bi.id = l.buyer_item_id
      LEFT JOIN items vi ON vi.id = l.vendor_item_id
      LEFT JOIN supplier_published_listings pl
        ON pl.supplier_business_id = $2 AND pl.item_id = l.vendor_item_id AND pl.is_active = true
      WHERE l.order_id = $1
      ORDER BY l.sort_order
      `,
      [order.id, order.vendor_business_id]
    );
    const names = await db.queryRows<{ id: string; name: string }>(
      `SELECT id, name FROM businesses WHERE id = ANY($1::uuid[])`,
      [[order.buyer_business_id, order.vendor_business_id]]
    );
    const nameOf = (id: string) => names.find((n) => n.id === id)?.name ?? null;
    const invoice = order.invoice_id
      ? await db.queryOne(`SELECT id, invoice_number, invoice_date, grand_total FROM invoices WHERE id = $1`, [order.invoice_id])
      : null;

    return NextResponse.json({
      role,
      order: {
        id: order.id,
        status: order.status,
        origin: order.origin,
        need_by: order.need_by,
        notes: order.notes,
        created_at: order.created_at,
        confirmed_at: order.confirmed_at,
        buyer_name: nameOf(order.buyer_business_id),
        supplier_name: nameOf(order.vendor_business_id),
        invoice,
        purchase_id: role === 'buyer' ? order.purchase_id : null,
      },
      lines: lines.map((l: any) => ({
        ...l,
        qty: Number(l.qty),
        confirmed_qty: l.confirmed_qty == null ? null : Number(l.confirmed_qty),
        factor: Number(l.factor),
        unit_price: l.unit_price == null ? null : Number(l.unit_price),
        buyer_qty: Math.round(Number(l.qty) * Number(l.factor) * 1000) / 1000,
        // The supplier sees the buyer's item only by the line's name.
        buyer_item_id: role === 'buyer' ? l.buyer_item_id : null,
        buyer_item_name: role === 'buyer' ? l.buyer_item_name : null,
        vendor_item_id: role === 'vendor' ? l.vendor_item_id : null,
        vendor_item_name: role === 'vendor' ? l.vendor_item_name : l.vendor_item_name ? 'Matched' : null,
      })),
    });
  } catch (error) {
    return supplyOrderErrorResponse(error, 'Failed to load the order');
  }
}

/**
 * PATCH /api/supply-orders/[id]
 * Body: { action: 'update'|'send'|'confirm'|'respond'|'decline'|'cancel', lines?: [...], note? }
 * See lib/supply-orders transitionSupplyOrder for who may do what.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    const body = await request.json().catch(() => ({}));
    const { role } = await loadOrderForParty(params.id, auth.businessId, client);
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'update');

    await client.query('BEGIN');
    const status = await transitionSupplyOrder(
      {
        orderId: params.id,
        actorBusinessId: auth.businessId,
        userId: auth.userId,
        action: String(body.action || ''),
        lines: Array.isArray(body.lines) ? body.lines : [],
        note: typeof body.note === 'string' ? body.note : null,
      },
      client
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return supplyOrderErrorResponse(error, 'Failed to update the order');
  } finally {
    client.release();
  }
}
