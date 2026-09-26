import { NextRequest, NextResponse } from 'next/server';
import { query, queryRows } from '@/lib/db';
import { resolveStoreBySubdomain } from '@/lib/store/resolve-store';
import { readStoreCustomer, STORE_CUSTOMER_COOKIE } from '@/lib/store/customer-session';

export const dynamic = 'force-dynamic';

async function sessionFor(
  request: NextRequest,
  subdomain: string,
) {
  const store = await resolveStoreBySubdomain(subdomain);
  if (!store) return { error: NextResponse.json({ error: 'Store not found' }, { status: 404 }) };
  const session = readStoreCustomer(request.cookies.get(STORE_CUSTOMER_COOKIE)?.value);
  if (!session || session.businessId !== store.business_id) {
    return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };
  }
  return { store, session };
}

export async function GET(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const scoped = await sessionFor(request, params.subdomain);
  if ('error' in scoped) return scoped.error;
  const rows = await queryRows<{ item_id: string }>(
    `SELECT item_id FROM store_item_favorites WHERE business_id = $1 AND customer_id = $2`,
    [scoped.store.business_id, scoped.session.customerId],
  );
  return NextResponse.json({ item_ids: rows.map((r) => r.item_id) });
}

export async function POST(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const scoped = await sessionFor(request, params.subdomain);
  if ('error' in scoped) return scoped.error;
  const body = await request.json().catch(() => ({}));
  const itemId = String(body.item_id ?? '').trim();
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
  await query(
    `INSERT INTO store_item_favorites (business_id, customer_id, item_id)
     SELECT $1, $2, i.id FROM items i
     WHERE i.id = $3 AND i.business_id = $1 AND i.show_in_store = true AND i.deleted_at IS NULL
     ON CONFLICT DO NOTHING`,
    [scoped.store.business_id, scoped.session.customerId, itemId],
  );
  return NextResponse.json({ ok: true, saved: true });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { subdomain: string } },
) {
  const scoped = await sessionFor(request, params.subdomain);
  if ('error' in scoped) return scoped.error;
  const itemId = request.nextUrl.searchParams.get('item_id')?.trim() || '';
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 });
  await query(
    `DELETE FROM store_item_favorites WHERE business_id = $1 AND customer_id = $2 AND item_id = $3`,
    [scoped.store.business_id, scoped.session.customerId, itemId],
  );
  return NextResponse.json({ ok: true, saved: false });
}
