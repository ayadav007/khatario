import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { createSupplyOrder } from '@/lib/supply-orders';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';

export const dynamic = 'force-dynamic';

const STATUS_GROUPS: Record<string, string[]> = {
  action: [], // filled per role below
  open: ['draft', 'proposed', 'pending', 'confirmed', 'partial', 'invoiced'],
  done: ['received', 'declined', 'cancelled'],
};

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

    const statuses =
      group === 'action'
        ? role === 'vendor'
          ? ['draft', 'pending', 'confirmed', 'partial']
          : ['proposed', 'invoiced']
        : STATUS_GROUPS[group] ?? null;

    const mine = role === 'buyer' ? 'o.buyer_business_id' : 'o.vendor_business_id';
    const theirs = role === 'buyer' ? 'o.vendor_business_id' : 'o.buyer_business_id';
    const args: any[] = [auth.businessId];
    let statusSql = '';
    if (statuses) {
      args.push(statuses);
      statusSql = `AND o.status = ANY($2::text[])`;
    }
    const orders = await db.queryRows(
      `
      SELECT o.id, o.status, o.origin, o.need_by, o.created_at, o.updated_at, o.invoice_id,
             ${theirs} AS other_business_id, ob.name AS other_business_name,
             (SELECT COUNT(*)::int FROM supply_order_lines l WHERE l.order_id = o.id) AS line_count,
             inv.invoice_number
      FROM supply_orders o
      JOIN businesses ob ON ob.id = ${theirs}
      LEFT JOIN invoices inv ON inv.id = o.invoice_id
      WHERE ${mine} = $1
        ${statusSql}
        ${role === 'buyer' ? "AND o.status <> 'draft'" : ''}
      ORDER BY o.updated_at DESC
      LIMIT 200
      `,
      args
    );
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
