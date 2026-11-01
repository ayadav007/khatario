import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import {
  cancelInviteOrder,
  createInviteOrder,
  inviteOrderMessage,
  inviteOrderPath,
  InviteOrderError,
  listInviteOrders,
} from '@/lib/supplier-invites';
import { appBaseUrl } from '@/lib/insights/format';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof InviteOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
  if (error instanceof AuthorizationError) return error.toNextResponse();
  console.error(fallback, error);
  return NextResponse.json({ error: fallback }, { status: 500 });
}

/** GET /api/suppliers/hub/invite-orders?supplier_id= — orders sent as links to this supplier. */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'read', { businessId: auth.businessId });
    const supplierId = new URL(request.url).searchParams.get('supplier_id') || '';
    return NextResponse.json({ orders: await listInviteOrders(auth.businessId, supplierId) });
  } catch (error) {
    return errorResponse(error, 'Failed to load orders');
  }
}

/**
 * POST /api/suppliers/hub/invite-orders
 * { supplier_id, lines: [{ buyer_item_id | item_name, qty }], notes?, need_by? }
 * Returns the private link and a WhatsApp message to send it with.
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    await authorize(auth.userId, 'purchases', 'create', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    await client.query('BEGIN');
    const created = await createInviteOrder(
      {
        buyerBusinessId: auth.businessId,
        userId: auth.userId,
        supplierId: String(body.supplier_id || ''),
        lines: Array.isArray(body.lines) ? body.lines : [],
        notes: typeof body.notes === 'string' ? body.notes : null,
        needBy: body.need_by || null,
      },
      client
    );
    await client.query('COMMIT');
    const link = `${appBaseUrl() || 'https://khatario.com'}${inviteOrderPath(created.order.token)}`;
    return NextResponse.json(
      {
        order: created.order,
        link,
        supplier_phone: created.supplier.phone,
        message: inviteOrderMessage({
          buyerName: created.buyer_name,
          supplierName: created.supplier.name,
          lines: created.message_lines,
          link,
        }),
      },
      { status: 201 }
    );
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return errorResponse(error, 'Failed to create the order');
  } finally {
    client.release();
  }
}

/** DELETE /api/suppliers/hub/invite-orders?order_id= — withdraw an order not yet answered. */
export async function DELETE(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'purchases', 'update', { businessId: auth.businessId });
    await cancelInviteOrder(auth.businessId, new URL(request.url).searchParams.get('order_id') || '');
    return NextResponse.json({ ok: true });
  } catch (error) {
    return errorResponse(error, 'Failed to withdraw the order');
  }
}
