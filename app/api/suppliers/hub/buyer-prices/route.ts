import { NextRequest, NextResponse } from 'next/server';
import * as db from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireAuthenticatedTenant } from '@/lib/stock-request-security';
import { inTransaction, logPriceChange } from '@/lib/pricing/rate-input';

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
         LEFT JOIN party_item_prices bp
           ON bp.business_id = i.business_id AND bp.party_id = $2 AND bp.item_id = i.id AND bp.variant_id IS NULL
        WHERE i.business_id = $1 AND i.deleted_at IS NULL AND COALESCE(i.is_active, true) = true
          AND COALESCE(i.item_type, 'goods') <> 'service'
          AND ($3::text = '' OR i.name ILIKE '%' || $3 || '%' OR COALESCE(i.code, '') ILIKE '%' || $3 || '%')
        ORDER BY (bp.price IS NULL), i.name
        LIMIT 200`,
      [auth.businessId, params.get('customer_id'), q]
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
    // The buyer's price is this customer's whole-item price, the same one billing uses.
    const customerId = String(body.customer_id);
    const remove = body.price === null || body.price === '';
    const price = remove ? null : Math.round(Number(body.price) * 100) / 100;
    if (!remove && !(Number(body.price) >= 0)) return NextResponse.json({ error: 'Price must be zero or more' }, { status: 400 });
    await inTransaction(db.getPool(), async (client) => {
      const old =
        (
          await client.query(
            `SELECT price::float AS price, discount_percent::float AS discount_percent FROM party_item_prices
              WHERE business_id = $1 AND party_id = $2 AND item_id = $3 AND variant_id IS NULL FOR UPDATE`,
            [auth.businessId, customerId, body.item_id]
          )
        ).rows[0] ?? null;
      if (remove && old?.discount_percent == null) {
        await client.query(
          `DELETE FROM party_item_prices WHERE business_id = $1 AND party_id = $2 AND item_id = $3 AND variant_id IS NULL`,
          [auth.businessId, customerId, body.item_id]
        );
      } else {
        await client.query(
          `INSERT INTO party_item_prices (business_id, party_id, item_id, price)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (business_id, party_id, item_id) WHERE variant_id IS NULL
           DO UPDATE SET price = EXCLUDED.price, updated_at = CURRENT_TIMESTAMP`,
          [auth.businessId, customerId, body.item_id, price]
        );
      }
      await logPriceChange(client, {
        businessId: auth.businessId,
        scope: 'party_item',
        partyId: customerId,
        itemId: String(body.item_id),
        old,
        next: remove && old?.discount_percent == null
          ? null
          : { price, discount_percent: old?.discount_percent ?? null, valid_from: null, valid_to: null },
        changedBy: auth.userId,
      });
    });
    if (remove) return NextResponse.json({ ok: true, price: null });
    return NextResponse.json({ ok: true, price });
  } catch (error) {
    const d = denied(error);
    if (d) return d;
    console.error('buyer prices PUT', error);
    return NextResponse.json({ error: 'Failed to save the price' }, { status: 500 });
  }
}
