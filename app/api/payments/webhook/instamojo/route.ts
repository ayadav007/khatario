import { NextRequest, NextResponse } from 'next/server';
import { handlePaymentWebhookPost } from '../handle-post';

/**
 * POST /api/payments/webhook/instamojo?business_id=<uuid>
 *
 * Raw body once as text → {@link PaymentProvider.verifyWebhook} (Instamojo MAC) →
 * {@link applyVerifiedPaymentWebhook}. Set Instamojo webhook URL to this path with `business_id`.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    return await handlePaymentWebhookPost(request, 'instamojo', {
      verificationFailureStatus: 400,
    });
  } catch (error) {
    console.error('[payments/webhook/instamojo] Unexpected error', error);
    return NextResponse.json(
      { error: 'Webhook processing failed' },
      { status: 500 }
    );
  }
}
