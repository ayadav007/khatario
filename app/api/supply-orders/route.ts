import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { createSupplyOrder, listSupplyOrders } from '@/lib/supply-orders';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';

export const dynamic = 'force-dynamic';

/**
 * GET /api/supply-orders?role=buyer|vendor&group=action|open|done|all
 * "action" = orders waiting on the caller: as supplier drafts, pending and confirmed orders to
 * bill; as buyer proposed orders to confirm and invoiced orders to receive.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const { searchParams } = new URL(request.url);
    const role = searchParams.get('role') === 'vendor' ? 'vendor' : 'buyer';
    const group = searchParams.get('group') || 'action';
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'read');

    const orders = await listSupplyOrders(auth.businessId, role, group);
    return NextResponse.json({ role, orders });
  } catch (error) {
    return supplyOrderErrorResponse(error, 'Failed to load orders');
  }
}

/**
 * POST /api/supply-orders
 * As buyer:    { supplier_id, lines: [{ buyer_item_id | vendor_item_id, buyer_qty | qty }], need_by?, notes?, from_catalog? }
 * As supplier: { customer_id, lines: [{ vendor_item_id, qty }], need_by?, notes?, send? }
 * supplier_id / customer_id are the caller's own records of the other business.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    const body = await request.json().catch(() => ({}));
    const role: 'buyer' | 'vendor' = body.customer_id ? 'vendor' : 'buyer';
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'create');

    const counterparty =
      role === 'buyer'
        ? (
            await client.query(
              `SELECT linked_business_id AS id FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
              [body.supplier_id, auth.businessId]
            )
          ).rows[0]?.id
        : (
            await client.query(
              `SELECT linked_business_id AS id FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
              [body.customer_id, auth.businessId]
            )
          ).rows[0]?.id;
    if (!counterparty) {
      return NextResponse.json(
        { error: role === 'buyer' ? 'Supplier is not on Khatario' : 'Customer is not on Khatario', code: 'NOT_LINKED' },
        { status: 400 }
      );
    }

    await client.query('BEGIN');
    const created = await createSupplyOrder(
      {
        actorBusinessId: auth.businessId,
        userId: auth.userId,
        role,
        counterpartyBusinessId: counterparty,
        lines: body.lines,
        needBy: body.need_by || null,
        notes: typeof body.notes === 'string' ? body.notes : null,
        send: body.send === true,
        origin: role === 'buyer' && body.from_catalog === true ? 'catalog' : undefined,
      },
      client
    );
    await client.query('COMMIT');
    return NextResponse.json({ order: created }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return supplyOrderErrorResponse(error, 'Failed to create the order');
  } finally {
    client.release();
  }
}
