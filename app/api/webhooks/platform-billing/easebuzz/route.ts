import { NextRequest, NextResponse } from 'next/server';
import { handleEasebuzzCallback } from '@/lib/payments/easebuzz-callback';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/platform-billing/easebuzz
 * Khatario subscription and add-on payments on the platform Easebuzz account
 * (PLATFORM_EASEBUZZ_KEY / PLATFORM_EASEBUZZ_SALT).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!rawBody.length) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }
  try {
    const result = await handleEasebuzzCallback(rawBody, { only: 'PB' });
    return NextResponse.json(result.body, { status: result.httpStatus });
  } catch (err) {
    console.error('[platform-billing easebuzz webhook]', err);
    return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'platform-billing-easebuzz' });
}
