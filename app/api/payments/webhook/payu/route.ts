import { NextRequest, NextResponse } from 'next/server';
import { handlePaymentWebhookPost } from '../handle-post';

/**
 * POST /api/payments/webhook/payu?business_id=&lt;uuid&gt;
 *
 * Same behavior as `/api/payments/webhook/[provider]` with `provider=payu`:
 * raw body → `verifyWebhook` (no route-level JSON parse) → apply verified webhook.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePaymentWebhookPost(request, 'payu');
  } catch (error) {
    console.error('[payments/webhook/payu] Unexpected error', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
