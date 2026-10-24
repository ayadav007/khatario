import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { disconnectSupplierLink } from '@/lib/supplier-hub-links';

export const dynamic = 'force-dynamic';

type Pair = { buyerBusinessId: string; vendorBusinessId: string; side: 'buyer' | 'vendor' };

/**
 * Resolve the hub link from the caller's own record:
 *   ?supplier_id=  the caller is the buyer (their supplier row)
 *   ?customer_id=  the caller is the supplier (their customer row linked to a buyer)
 */
async function resolvePair(businessId: string, url: string): Promise<Pair | NextResponse> {
  const { searchParams } = new URL(url);
  const supplierId = searchParams.get('supplier_id');
  const customerId = searchParams.get('customer_id');

  if (supplierId) {
    const row = await db.queryOne<{ linked_business_id: string | null }>(
      `SELECT linked_business_id FROM suppliers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [supplierId, businessId]
    );
    if (!row) return NextResponse.json({ error: 'Supplier not found' }, { status: 404 });
    if (!row.linked_business_id) {
      return NextResponse.json({ error: 'This supplier is not on Khatario', code: 'NOT_LINKED' }, { status: 400 });
    }
    return { buyerBusinessId: businessId, vendorBusinessId: row.linked_business_id, side: 'buyer' };
  }
  if (customerId) {
    const row = await db.queryOne<{ linked_business_id: string | null }>(
      `SELECT linked_business_id FROM customers WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`,
      [customerId, businessId]
    );
    if (!row) return NextResponse.json({ error: 'Customer not found' }, { status: 404 });
    if (!row.linked_business_id) {
      return NextResponse.json({ error: 'This customer is not on Khatario', code: 'NOT_LINKED' }, { status: 400 });
    }
    return { buyerBusinessId: row.linked_business_id, vendorBusinessId: businessId, side: 'vendor' };
  }
  return NextResponse.json({ error: 'supplier_id or customer_id is required' }, { status: 400 });
}

async function authorizeSide(userId: string, businessId: string, side: Pair['side'], action: 'read' | 'update') {
  await authorize(userId, side === 'buyer' ? 'suppliers' : 'customers', action, { businessId });
}

/** GET — link status between the caller and the other business. */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const pair = await resolvePair(auth.businessId, request.url);
    if (pair instanceof NextResponse) return pair;
    await authorizeSide(auth.userId, auth.businessId, pair.side, 'read');

    const link = await db.queryOne<{
      approval_status: string;
      allow_low_stock_access: boolean;
      approved_at: string | null;
      disconnected_at: string | null;
    }>(
      `SELECT approval_status, allow_low_stock_access, approved_at, disconnected_at
         FROM suppliers
        WHERE business_id = $1 AND linked_business_id = $2 AND deleted_at IS NULL
        ORDER BY (approval_status = 'approved') DESC, updated_at DESC NULLS LAST
        LIMIT 1`,
      [pair.buyerBusinessId, pair.vendorBusinessId]
    );
    const other = await db.queryOne<{ name: string }>(`SELECT name FROM businesses WHERE id = $1`, [
      pair.side === 'buyer' ? pair.vendorBusinessId : pair.buyerBusinessId,
    ]);
    return NextResponse.json({
      side: pair.side,
      other_business_id: pair.side === 'buyer' ? pair.vendorBusinessId : pair.buyerBusinessId,
      other_business_name: other?.name ?? null,
      status: link?.approval_status ?? 'none',
      stock_shared: !!link?.allow_low_stock_access && link?.approval_status === 'approved',
      approved_at: link?.approved_at ?? null,
      disconnected_at: link?.disconnected_at ?? null,
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('hub link GET', error);
    return NextResponse.json({ error: 'Failed to load link' }, { status: 500 });
  }
}

/** DELETE — disconnect. Either side may end the link; past documents stay. */
export async function DELETE(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    const pair = await resolvePair(auth.businessId, request.url);
    if (pair instanceof NextResponse) return pair;
    await authorizeSide(auth.userId, auth.businessId, pair.side, 'update');

    const client = await db.getPool().connect();
    try {
      await client.query('BEGIN');
      const ended = await disconnectSupplierLink({
        buyerBusinessId: pair.buyerBusinessId,
        vendorBusinessId: pair.vendorBusinessId,
        actorBusinessId: auth.businessId,
        client,
      });
      await client.query('COMMIT');
      if (!ended) {
        return NextResponse.json({ error: 'There is no active link to disconnect', code: 'NOT_CONNECTED' }, { status: 409 });
      }
      return NextResponse.json({ ok: true });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('hub link DELETE', error);
    return NextResponse.json({ error: 'Failed to disconnect' }, { status: 500 });
  }
}
