import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { requireStrictSession } from '@/lib/auth-helpers';
import { findShopBarcodeMatch } from '@/lib/items/scan-add-lookup';

export const dynamic = 'force-dynamic';

/**
 * GET /api/items/scan-add/barcode?code=...
 * Scan & Add Items: the exact item or variant in this business that already has this barcode.
 * Plan-gated to items_scan_onboarding through the path gate in authorize().
 */
export async function GET(request: NextRequest) {
  try {
    const session = await requireStrictSession(request);
    if (!session.ok) return session.response;

    try {
      await authorize(session.userId, 'items', 'read', { businessId: session.businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const code = (new URL(request.url).searchParams.get('code') ?? '').trim();
    if (!code) return NextResponse.json({ error: 'code is required' }, { status: 400 });
    if (code.length > 100) return NextResponse.json({ error: 'Barcode is too long' }, { status: 400 });

    const match = await findShopBarcodeMatch(getPool(), session.businessId, code);
    return NextResponse.json({ match });
  } catch (error) {
    console.error('[scan-add/barcode]', error);
    return NextResponse.json({ error: 'Could not check the barcode' }, { status: 500 });
  }
}
