import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { getAuthenticatedUserId, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { listItemUnits } from '@/lib/items/item-units';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/items/units?ids=a,b,c (max 300)
 * → { items: { [itemId]: { unit, selling_price, units: [{ unit, factor_to_base, selling_price }] } } }
 * The units a bill line can be sold in: the item's own unit plus its alternates (BOX = 12 PCS).
 */
export async function GET(request: NextRequest) {
  const userId = getAuthenticatedUserId(request);
  const businessId = getSessionScopedBusinessId(request);
  if (!userId || !businessId) {
    return NextResponse.json({ error: 'Authentication required', code: 'UNAUTHENTICATED' }, { status: 401 });
  }
  try {
    await authorize(userId, 'items', 'read', { businessId });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    throw error;
  }

  const ids = [...new Set((request.nextUrl.searchParams.get('ids') || '').split(',').map((s) => s.trim()).filter(Boolean))];
  if (ids.length > 300) return NextResponse.json({ error: 'Too many items (max 300)' }, { status: 400 });
  if (ids.some((id) => !UUID_RE.test(id))) return NextResponse.json({ error: 'Invalid item id' }, { status: 400 });
  if (ids.length === 0) return NextResponse.json({ items: {} });

  const pool = getPool();
  const own = await pool.query<{ id: string; unit: string | null; selling_price: number | null }>(
    `SELECT id, unit, selling_price::float AS selling_price FROM items WHERE business_id = $1 AND id = ANY($2::uuid[])`,
    [businessId, ids]
  );
  const units = await listItemUnits(pool, businessId, ids);
  const items: Record<
    string,
    { unit: string | null; selling_price: number | null; units: Array<{ unit: string; factor_to_base: number; selling_price: number | null }> }
  > = {};
  for (const r of own.rows) items[r.id] = { unit: r.unit, selling_price: r.selling_price, units: [] };
  for (const u of units) {
    items[u.item_id]?.units.push({ unit: u.unit, factor_to_base: u.factor_to_base, selling_price: u.selling_price });
  }
  return NextResponse.json({ items });
}
