import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { lastPurchaseRates } from '@/lib/pricing/resolve-price';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/pricing/supplier-rates
 * Body: { supplier_id, item_ids: string[] } (max 300)
 * → { rates: { [item_id]: LastRate } }: the last pre-GST price paid to this supplier per item.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const businessId = getSessionScopedBusinessId(request);
    if (!userId || !businessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    try {
      await authorize(userId, 'purchases', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json().catch(() => ({}));
    const supplierId = typeof body.supplier_id === 'string' ? body.supplier_id.trim() : '';
    const itemIds: string[] = Array.isArray(body.item_ids) ? body.item_ids.filter((x: unknown) => typeof x === 'string') : [];
    if (!UUID_RE.test(supplierId)) return NextResponse.json({ error: 'Invalid supplier_id' }, { status: 400 });
    if (itemIds.length > 300) return NextResponse.json({ error: 'Too many items (max 300)' }, { status: 400 });
    if (itemIds.some((id) => !UUID_RE.test(id))) return NextResponse.json({ error: 'Invalid item_ids' }, { status: 400 });

    const rates = await lastPurchaseRates(getPool(), businessId, supplierId, itemIds);
    return NextResponse.json({ rates: Object.fromEntries(rates) });
  } catch (error) {
    console.error('[POST /api/pricing/supplier-rates]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
