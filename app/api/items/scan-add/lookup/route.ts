import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { normalizeBarcode } from '@/lib/barcode-validator';
import { lookupExternalProduct } from '@/lib/product-lookup/service';

export const dynamic = 'force-dynamic';

/**
 * GET /api/items/scan-add/lookup?code=...
 * Suggestions from outside product databases for a barcode the shop does not have yet.
 * Server-side only: the browser never calls the providers, and they never see who is asking.
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    try {
      await authorize(session.userId, 'items', 'create', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const code = normalizeBarcode(new URL(request.url).searchParams.get('code') ?? '');
    if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 });
    if (code.length > 100 || !/^[A-Za-z0-9\-.]+$/.test(code)) {
      return NextResponse.json({ error: 'This does not look like a barcode' }, { status: 400 });
    }

    const result = await lookupExternalProduct(getPool(), session.businessId, code);
    return NextResponse.json(result);
  } catch (error) {
    console.error('[scan-add/lookup]', error);
    return NextResponse.json({ error: 'Could not look the barcode up' }, { status: 500 });
  }
}
