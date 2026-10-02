import { NextRequest, NextResponse } from 'next/server';
import { handleEasebuzzCallback } from '@/lib/payments/easebuzz-callback';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/webhook/easebuzz?business_id=<uuid>
 *
 * Easebuzz dashboard transaction webhook for a merchant account. Covers sales-order payment
 * links (txnid `SO-…`) and store orders (`ST-…`). The tenant is resolved from the stored
 * transaction; `business_id`, when present, must match it.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const rawBody = await request.text();
    if (!rawBody.length) {
      return NextResponse.json({ error: 'Empty body' }, { status: 400 });
    }
    const expectedBusinessId = new URL(request.url).searchParams.get('business_id')?.trim() || null;
    const result = await handleEasebuzzCallback(rawBody, { expectedBusinessId });
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (error) {
    console.error('[payments/webhook/easebuzz] Unexpected error', error);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
