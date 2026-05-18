import { NextRequest, NextResponse } from 'next/server';
import { handlePaymentWebhookPost } from '../handle-post';

/**
 * POST /api/payments/webhook/[provider]?business_id=<uuid>
 *
 * Server-to-server PSP webhooks. Configure your PSP to call this URL with `business_id`
 * so the correct tenant credentials are used for verification.
 *
 * Flow (all providers, including PayU):
 * - `const rawBody = await request.text()` — single read; do not call `request.json()` first.
 * - `verifyWebhook({ rawBody, headers })` — parsing / HMAC / PayU reverse hash runs inside the provider.
 * - `applyVerifiedPaymentWebhook` only after `verified.verified === true`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { provider: string } }
) {
  try {
    return await handlePaymentWebhookPost(request, params.provider ?? '');
  } catch (error) {
    console.error('[payments/webhook] Unexpected error', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
