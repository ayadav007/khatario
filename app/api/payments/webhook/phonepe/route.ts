import { NextRequest, NextResponse } from 'next/server';
import { handlePaymentWebhookPost } from '../handle-post';

/**
 * POST /api/payments/webhook/phonepe?business_id=<uuid>
 *
 * Raw body is read once as text → {@link PaymentProvider.verifyWebhook} (checksum via X-VERIFY) →
 * {@link applyVerifiedPaymentWebhook}. Configure PhonePe callback URL to include `business_id`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePaymentWebhookPost(request, 'phonepe', {
      verificationFailureStatus: 400,
    });
  } catch (error) {
    console.error('[payments/webhook/phonepe] Unexpected error', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
