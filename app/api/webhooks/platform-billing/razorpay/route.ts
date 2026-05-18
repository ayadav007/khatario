import { NextRequest, NextResponse } from 'next/server';
import { processPlatformRazorpayWebhook } from '@/lib/platform-billing';

export const dynamic = 'force-dynamic';

/**
 * POST /api/webhooks/platform-billing/razorpay
 * SaaS subscription payments (platform Razorpay account).
 * Set PLATFORM_RAZORPAY_WEBHOOK_SECRET (and key id/secret for verification).
 * Payment notes must include: business_id, plan_id (optional), billing_cycle (optional).
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  if (!rawBody.length) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  const headers: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  const result = await processPlatformRazorpayWebhook(rawBody, headers);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: result.error?.includes('configured') ? 503 : 401 });
  }
  return NextResponse.json(result);
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: 'platform-billing-razorpay' });
}
