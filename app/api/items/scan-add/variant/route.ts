import { NextRequest, NextResponse } from 'next/server';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { readPaymentIdempotencyKey } from '@/lib/accounting/payment-idempotency';
import { addVariantFromScan, type AddVariantInput } from '@/lib/items/scan-add-variant';

export const dynamic = 'force-dynamic';

/**
 * POST /api/items/scan-add/variant
 * A new pack size for an item whose barcode was scanned again. Turns a plain item into one with
 * sizes when it has no sales, purchases or adjustments yet. Accepts X-Idempotency-Key.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    try {
      await authorize(session.userId, 'items', 'update', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const key = readPaymentIdempotencyKey(request);
    if (!key.ok) return NextResponse.json(key.body, { status: 400 });

    const body = (await request.json().catch(() => null)) as AddVariantInput | null;
    if (!body || typeof body.item_id !== 'string' || !body.item_id) {
      return NextResponse.json({ error: 'item_id is required' }, { status: 400 });
    }

    const result = await addVariantFromScan(session.businessId, session.userId, body, key.key);
    if (!result.ok) return NextResponse.json({ error: result.error, code: result.code }, { status: result.status });
    return NextResponse.json(
      { item_id: result.itemId, variant_id: result.variantId, converted: result.converted, idempotent: result.replayed },
      { status: result.status }
    );
  } catch (error) {
    console.error('[scan-add/variant]', error);
    return NextResponse.json({ error: 'Could not add this size' }, { status: 500 });
  }
}
