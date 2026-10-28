import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { getSessionScopedBusinessId, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { resolvePrices } from '@/lib/pricing/resolve-price';

export const dynamic = 'force-dynamic';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * POST /api/pricing/resolve
 * Body: { customer_id?: string | null, date?: 'YYYY-MM-DD', lines: { item_id, variant_id?, qty?, unit? }[] } (max 300)
 * → { lines: PriceLineResult[] } in the same order. A line in an alternate unit (unit: 'BOX') is
 * priced per box, with `unitFactor` saying how many base units it holds. Without the party pricing plan, or without a
 * customer, every line gets the item's own price.
 */
export async function POST(request: NextRequest) {
  try {
    const userId = getUserIdFromRequest(request);
    const businessId = getSessionScopedBusinessId(request);
    if (!userId || !businessId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }
    try {
      await authorize(userId, 'items', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const body = await request.json().catch(() => ({}));
    const raw = Array.isArray(body.lines) ? body.lines : null;
    if (!raw) return NextResponse.json({ error: 'lines is required' }, { status: 400 });
    if (raw.length > 300) return NextResponse.json({ error: 'Too many lines (max 300)' }, { status: 400 });

    const lines = [];
    for (const l of raw) {
      const itemId = typeof l?.item_id === 'string' ? l.item_id.trim() : '';
      const variantId = typeof l?.variant_id === 'string' && l.variant_id.trim() ? l.variant_id.trim() : null;
      if (!UUID_RE.test(itemId) || (variantId && !UUID_RE.test(variantId))) {
        return NextResponse.json({ error: 'Each line needs a valid item_id (and variant_id if given)' }, { status: 400 });
      }
      const qty = l.qty == null ? 1 : Number(l.qty);
      if (!Number.isFinite(qty) || qty < 0) return NextResponse.json({ error: 'Invalid qty' }, { status: 400 });
      const unit = typeof l.unit === 'string' && l.unit.trim() ? l.unit.trim().slice(0, 20) : null;
      lines.push({ itemId, variantId, qty, unit });
    }

    let customerId: string | null = typeof body.customer_id === 'string' && body.customer_id.trim() ? body.customer_id.trim() : null;
    if (customerId && !UUID_RE.test(customerId)) {
      return NextResponse.json({ error: 'Invalid customer_id' }, { status: 400 });
    }
    const date = typeof body.date === 'string' && DATE_RE.test(body.date) ? body.date : new Date().toISOString().slice(0, 10);

    if (customerId) {
      try {
        await assertFeatureAccess(businessId, FeatureKeys.PARTY_PRICING);
      } catch (error) {
        if (!(error instanceof FeatureAccessDeniedError)) throw error;
        customerId = null;
      }
    }

    const results = await resolvePrices(getPool(), businessId, customerId, lines, date);
    return NextResponse.json({ lines: results });
  } catch (error) {
    console.error('[POST /api/pricing/resolve]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
