import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';

export const dynamic = 'force-dynamic';

export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const store = await resolveStoreBySubdomain(params.subdomain);
  if (!store) return NextResponse.json({ error: 'Store not found' }, { status: 404 });
  const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
  if (!session || session.businessId !== store.business_id) {
    return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
  }
  const body = await request.json().catch(() => ({}));
  const itemId = String(body.item_id ?? '').trim();
  const rating = Math.round(Number(body.rating));
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
  if (rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating must be 1–5' }, { status: 400 });
  }
  const item = await queryOne(
    `SELECT id FROM items WHERE id = $1 AND business_id = $2 AND show_in_store = true AND deleted_at IS NULL`,
    [itemId, store.business_id],
  );
  if (!item) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
  await query(
    `INSERT INTO store_item_ratings (business_id, customer_id, item_id, rating)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (business_id, customer_id, item_id)
     DO UPDATE SET rating = EXCLUDED.rating, updated_at = CURRENT_TIMESTAMP`,
    [store.business_id, session.customerId, itemId, rating],
  );
  const agg = await queryOne<{ avg: string; count: string }>(
    `SELECT COALESCE(AVG(rating), 0)::text AS avg, COUNT(*)::text AS count
     FROM store_item_ratings WHERE business_id = $1 AND item_id = $2`,
    [store.business_id, itemId],
  );
  return NextResponse.json({
    ok: true,
    rating_avg: parseFloat(agg?.avg ?? '0') || 0,
    rating_count: parseInt(agg?.count ?? '0', 10) || 0,
  });
}
