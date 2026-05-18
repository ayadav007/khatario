import { randomUUID } from 'crypto';
import type {
  CreateUpiCollectParams,
  CreateUpiCollectResult,
  CreateVirtualAccountParams,
  CreateVirtualAccountResult,
  PaymentProvider,
  VerifyWebhookParams,
  VerifyWebhookResult,
} from '../types';

/**
 * Deterministic fake PSP for tests and local development.
 * Webhook: set header `x-mock-signature` to `valid` for verified payloads (JSON body).
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly id = 'mock';

  async createUpiCollect(params: CreateUpiCollectParams): Promise<CreateUpiCollectResult> {
    const sessionId = `mock_sess_${randomUUID().slice(0, 8)}`;
    const providerPaymentId = `mock_pay_${randomUUID().slice(0, 8)}`;
    const amountStr = Number(params.amount).toFixed(2);
    const pn = encodeURIComponent(params.customerName || 'Customer');
    const tn = encodeURIComponent(`Order ${params.orderId}`);
    const upiIntent = `upi://pay?pa=merchant.mock@upi&pn=${pn}&am=${amountStr}&cu=${params.currency || 'INR'}&tn=${tn}`;

    return {
      provider: this.id,
      providerPaymentId,
      paymentSessionId: sessionId,
      upiIntent,
      paymentUrl: `https://mock-pay.example/session/${sessionId}`,
      raw: {
        order_id: params.orderId,
        business_id: params.businessId,
        amount: params.amount,
      },
    };
  }

  async createVirtualAccount(params: CreateVirtualAccountParams): Promise<CreateVirtualAccountResult> {
    const suffix = randomUUID().slice(0, 6);
    return {
      provider: this.id,
      virtualAccountNumber: `MOCKVA${suffix}`,
      ifsc: 'MOCK0001234',
      beneficiaryName: params.customerName || 'Mock Beneficiary',
      referenceId: `mock_va_${suffix}`,
      raw: {
        order_id: params.orderId,
        business_id: params.businessId,
      },
    };
  }

  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    const sig = headerFirst(params.headers['x-mock-signature']);
    const raw =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : params.rawBody.toString('utf8');

    if (sig !== 'valid') {
      return {
        verified: false,
        reason: 'Mock provider expects header x-mock-signature: valid',
      };
    }

    try {
      const body = JSON.parse(raw) as Record<string, unknown>;
      const statusRaw = String(body.status ?? body.payment_status ?? '').toLowerCase();
      let status: VerifyWebhookResult['status'] = 'pending';
      if (statusRaw === 'success' || statusRaw === 'paid' || statusRaw === 'captured') {
        status = 'success';
      } else if (statusRaw === 'failed' || statusRaw === 'cancelled') {
        status = 'failed';
      }

      return {
        verified: true,
        eventType: typeof body.event === 'string' ? body.event : 'payment_update',
        providerPaymentId:
          typeof body.provider_payment_id === 'string'
            ? body.provider_payment_id
            : typeof body.payment_id === 'string'
              ? body.payment_id
              : undefined,
        orderReference:
          typeof body.order_id === 'string'
            ? body.order_id
            : typeof body.order_reference === 'string'
              ? body.order_reference
              : undefined,
        providerOrderId:
          typeof body.order_id === 'string'
            ? body.order_id
            : typeof body.order_reference === 'string'
              ? body.order_reference
              : undefined,
        amount:
          typeof body.amount === 'number'
            ? body.amount
            : body.amount != null
              ? Number(body.amount)
              : undefined,
        currency: typeof body.currency === 'string' ? body.currency : undefined,
        status,
        utr: typeof body.utr === 'string' ? body.utr : undefined,
        payerName: typeof body.payer_name === 'string' ? body.payer_name : undefined,
        rawPayload: body,
      };
    } catch {
      return {
        verified: true,
        reason: 'Body is not JSON; returning minimal stub',
        rawPayload: { raw },
      };
    }
  }
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
