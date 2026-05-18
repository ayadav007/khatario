import { NextRequest, NextResponse } from 'next/server';
import { createPaymentProviderForBusiness } from '@/lib/payments';
import { applyVerifiedPaymentWebhook } from '@/lib/services/payment-webhook';

/**
 * Shared POST handler for `/api/payments/webhook/[provider]` (and `/webhook/payu`).
 *
 * - Reads the body once as **text** (`await request.text()`). Never `request.json()` before verify.
 * - Passes that exact string to `PaymentProvider.verifyWebhook({ rawBody })`.
 * - PSP-specific parsing (form fields, JSON, HMAC) happens **inside** `verifyWebhook` only after
 *   trust checks (e.g. Razorpay HMAC, PayU reverse hash).
 *
 * @param verificationFailureStatus — defaults to `401`; PhonePe / Instamojo use `400` per integration contract.
 */
export async function handlePaymentWebhookPost(
  request: NextRequest,
  providerId: string,
  options?: { verificationFailureStatus?: number }
): Promise<NextResponse> {
  const provider = providerId?.toLowerCase();
  if (!provider) {
    return NextResponse.json({ error: 'provider is required' }, { status: 400 });
  }

  const { searchParams } = new URL(request.url);
  const businessId = searchParams.get('business_id');
  if (!businessId?.trim()) {
    return NextResponse.json(
      {
        error:
          'business_id query parameter is required (scoping webhook verification to the tenant)',
      },
      { status: 400 }
    );
  }

  const rawBody = await request.text();

  if (!rawBody.length) {
    return NextResponse.json({ error: 'Empty body' }, { status: 400 });
  }

  const headers: Record<string, string | string[] | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  let psp;
  try {
    psp = await createPaymentProviderForBusiness(businessId, provider);
  } catch (e) {
    console.error('[payments/webhook] createPaymentProviderForBusiness', e);
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'Invalid provider' },
      { status: 400 }
    );
  }

  const verified = await psp.verifyWebhook({
    rawBody,
    headers,
  });

  if (!verified.verified) {
    const verifyStatus = options?.verificationFailureStatus ?? 401;
    return NextResponse.json(
      { error: verified.reason || 'Webhook verification failed' },
      { status: verifyStatus }
    );
  }

  const result = await applyVerifiedPaymentWebhook({
    businessId,
    provider,
    verified,
    rawBody,
  });

  const status = result.httpStatus ?? (result.ok ? 200 : 422);
  return NextResponse.json(result, { status });
}
