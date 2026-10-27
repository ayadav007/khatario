import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';

export const dynamic = 'force-dynamic';

/** The connected buyer behind one of the supplier's customers, or null. */
async function buyerOf(customerId: string, supplierBusinessId: string): Promise<{ id: string; name: string } | null> {
  return db.queryOne<{ id: string; name: string }>(
    `SELECT b.id, b.name
       FROM customers c
       JOIN businesses b ON b.id = c.linked_business_id
       JOIN suppliers s ON s.business_id = b.id AND s.linked_business_id = c.business_id
                       AND s.approval_status = 'approved' AND s.deleted_at IS NULL
      WHERE c.id = $1 AND c.business_id = $2 AND c.deleted_at IS NULL
      LIMIT 1`,
    [customerId, supplierBusinessId]
  );
}

function denied(error: unknown) {
  if (error instanceof AuthorizationError) return error.toNextResponse();
  return null;
}

/**
 * GET /api/suppliers/hub/buyer-prices?customer_id=&q=
 * For the supplier: its goods with the list price and the price set for this connected buyer.
 * Items with a buyer price come first.
 */
export async function GET(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'invoices', 'read', { businessId: auth.businessId });
    const params = new URL(request.url).searchParams;
    const buyer = await buyerOf(params.get('customer_id') || '', auth.businessId);
    if (!buyer) return NextResponse.json({ error: 'Not a connected buyer of yours' }, { status: 404 });
    const q = (params.get('q') || '').trim();
    const items = await db.queryRows(
      `SELECT i.id, i.name, i.unit, i.selling_price, bp.price AS buyer_price
         FROM items i
         LEFT JOIN supplier_buyer_prices bp
           ON bp.item_id = i.id AND bp.vendor_business_id = i.business_id AND bp.buyer_business_id = $2
        WHERE i.business_id = $1 AND i.deleted_at IS NULL AND COALESCE(i.is_active, true) = true
          AND COALESCE(i.item_type, 'goods') <> 'service'
          AND ($3::text = '' OR i.name ILIKE '%' || $3 || '%' OR COALESCE(i.code, '') ILIKE '%' || $3 || '%')
        ORDER BY (bp.price IS NULL), i.name
        LIMIT 200`,
      [auth.businessId, buyer.id, q]
    );
    return NextResponse.json({ buyer, items });
  } catch (error) {
    const d = denied(error);
    if (d) return d;
    console.error('buyer prices GET', error);
    return NextResponse.json({ error: 'Failed to load prices' }, { status: 500 });
  }
}

/** PUT — { customer_id, item_id, price } sets this buyer's price; price null removes it. */
export async function PUT(request: NextRequest) {
  const auth = requireAuthenticatedTenant(request);
  if (auth instanceof NextResponse) return auth;
  try {
    await authorize(auth.userId, 'invoices', 'update', { businessId: auth.businessId });
    const body = await request.json().catch(() => ({}));
    const buyer = await buyerOf(String(body.customer_id || ''), auth.businessId);
    if (!buyer) return NextResponse.json({ error: 'Not a connected buyer of yours' }, { status: 404 });
    const item = await db.queryOne(`SELECT id FROM items WHERE id = $1 AND business_id = $2 AND deleted_at IS NULL`, [
      body.item_id,
      auth.businessId,
    ]);
    if (!item) return NextResponse.json({ error: 'Item not found' }, { status: 404 });
    if (body.price === null || body.price === '') {
      await db.query(
        `DELETE FROM supplier_buyer_prices WHERE vendor_business_id = $1 AND buyer_business_id = $2 AND item_id = $3`,
        [auth.businessId, buyer.id, body.item_id]
      );
      return NextResponse.json({ ok: true, price: null });
    }
    const price = Number(body.price);
    if (!(price >= 0)) return NextResponse.json({ error: 'Price must be zero or more' }, { status: 400 });
    await db.query(
      `INSERT INTO supplier_buyer_prices (vendor_business_id, buyer_business_id, item_id, price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (vendor_business_id, buyer_business_id, item_id)
       DO UPDATE SET price = EXCLUDED.price, updated_at = CURRENT_TIMESTAMP`,
      [auth.businessId, buyer.id, body.item_id, Math.round(price * 100) / 100]
    );
    return NextResponse.json({ ok: true, price: Math.round(price * 100) / 100 });
  } catch (error) {
    const d = denied(error);
    if (d) return d;
    console.error('buyer prices PUT', error);
    return NextResponse.json({ error: 'Failed to save the price' }, { status: 500 });
  }
}
