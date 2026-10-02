import { NextRequest, NextResponse } from 'next/server';
import { handleEasebuzzCallback } from '@/lib/payments/easebuzz-callback';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/store/easebuzz — Easebuzz notices for store orders.
 * Same handler as /api/payments/webhook/easebuzz; the order is the one whose
 * stored `payment_ref` equals the txnid, and the hash is checked with its business's salt.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!rawBody.length) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }
  try {
    const result = await handleEasebuzzCallback(rawBody);
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (err) {
    console.error('[store easebuzz webhook]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}
