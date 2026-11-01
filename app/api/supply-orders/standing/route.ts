import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { authorizeOrderRole, supplyOrderErrorResponse } from '@/lib/supply-order-http';
import { createStandingOrder, listStandingOrders, StandingOrderError } from '@/lib/supply-standing-orders';

export const dynamic = 'force-dynamic';

function errorResponse(error: unknown, fallback: string) {
  if (error instanceof StandingOrderError) return NextResponse.json({ error: error.message }, { status: error.status });
  return supplyOrderErrorResponse(error, fallback);
}

/** GET /api/supply-orders/standing?role=buyer|vendor — running and proposed standing orders. */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const role = new URL(request.url).searchParams.get('role') === 'vendor' ? 'vendor' : 'buyer';
    await authorizeOrderRole(auth.userId, auth.businessId, role, 'read');
    return NextResponse.json({ standing: await listStandingOrders(auth.businessId, role) });
  } catch (error) {
    return errorResponse(error, 'Failed to load standing orders');
  }
}

/**
 * POST /api/supply-orders/standing — buyer proposes:
 * { supplier_id, weekdays: [0..6], lines: [{ buyer_item_id, buyer_qty }], notes? }
 */
export async function POST(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  const client = await db.getPool().connect();
  try {
    await authorizeOrderRole(auth.userId, auth.businessId, 'buyer', 'create');
    const body = await request.json().catch(() => ({}));
    const vendor = (
      await client.query(`SELECT linked_business_id AS id FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [
        body.supplier_id,
        auth.businessId,
      ])
    ).rows[0]?.id;
    if (!vendor) return NextResponse.json({ error: 'Supplier is not on Khatario' }, { status: 400 });
    await client.query('BEGIN');
    const created = await createStandingOrder(
      {
        buyerBusinessId: auth.businessId,
        userId: auth.userId,
        vendorBusinessId: vendor,
        weekdays: body.weekdays,
        lines: Array.isArray(body.lines) ? body.lines : [],
        notes: typeof body.notes === 'string' ? body.notes : null,
      },
      client
    );
    await client.query('COMMIT');
    return NextResponse.json({ standing: created }, { status: 201 });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    return errorResponse(error, 'Failed to create the standing order');
  } finally {
    client.release();
  }
}
