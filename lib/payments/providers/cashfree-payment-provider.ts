import { createHmac, timingSafeEqual } from 'crypto';
import type {
  CreateUpiCollectParams,
  CreateUpiCollectResult,
  CreateVirtualAccountParams,
  CreateVirtualAccountResult,
  PaymentProvider,
  PaymentProviderConfig,
  VerifyWebhookParams,
  VerifyWebhookResult,
} from '../types';

/**
 * Cashfree PG-shaped integration (Orders API + webhook verification pattern).
 *
 * Docs (verify against latest Cashfree docs before production):
 * - Orders: https://www.cashfree.com/docs/api-reference/payments/latest/orders/create
 * - Webhooks: verify signature header against raw body + secret
 *
 * Credentials: use `clientId` + `clientSecret` (Cashfree “Client ID / Secret” from dashboard),
 * or map `appId` → client id and `secretKey` → client secret via config normalization below.
 *
 * Virtual accounts for **collections** may use a different Cashfree product (e.g. payouts / VA);
 * this stub returns a clear `raw` message until a concrete VA API is wired.
 */
export class CashfreePaymentProvider implements PaymentProvider {
  readonly id = 'cashfree';

  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;
  /** Cashfree PG API version header */
  private static readonly API_VERSION = '2023-08-01';

  constructor(config: PaymentProviderConfig = {}) {
    this.clientId =
      config.clientId ||
      config.appId ||
      process.env.CASHFREE_CLIENT_ID ||
      process.env.CASHFREE_APP_ID ||
      '';
    this.clientSecret =
      config.clientSecret ||
      config.secretKey ||
      process.env.CASHFREE_CLIENT_SECRET ||
      process.env.CASHFREE_SECRET_KEY ||
      '';
    this.webhookSecret =
      config.webhookSecret ||
      process.env.CASHFREE_WEBHOOK_SECRET ||
      this.clientSecret;

    const env = config.environment || (process.env.CASHFREE_ENV as 'sandbox' | 'production') || 'sandbox';
    if (config.baseUrl) {
      this.baseUrl = config.baseUrl.replace(/\/$/, '');
    } else {
      this.baseUrl =
        env === 'production'
          ? 'https://api.cashfree.com/pg'
          : 'https://sandbox.cashfree.com/pg';
    }
  }

  private ensureCredentials(): void {
    if (!this.clientId || !this.clientSecret) {
      throw new Error(
        'CashfreePaymentProvider: set clientId + clientSecret (or CASHFREE_CLIENT_ID / CASHFREE_CLIENT_SECRET)'
      );
    }
  }

  /**
   * Create a Cashfree order and return payment_session_id for hosted pay / SDK.
   * UPI deep link may appear in full payment response when using order pay APIs;
   * here we expose session id + payment_url if returned.
   */
  async createUpiCollect(params: CreateUpiCollectParams): Promise<CreateUpiCollectResult> {
    this.ensureCredentials();

    const orderId = `${params.orderId}`.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50);
    const body = {
      order_id: orderId,
      order_amount: Number(params.amount),
      order_currency: params.currency || 'INR',
      customer_details: {
        customer_id:
          (params.metadata?.customer_id as string) ||
          params.customerPhone ||
          params.businessId,
        customer_phone: params.customerPhone || '9999999999',
        customer_email: params.customerEmail || 'customer@example.com',
        customer_name: params.customerName || 'Customer',
      },
      order_meta: {
        return_url: params.returnUrl,
        notify_url: params.notifyUrl,
        ...params.metadata,
      },
    };

    const res = await fetch(`${this.baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-version': CashfreePaymentProvider.API_VERSION,
        'x-client-id': this.clientId,
        'x-client-secret': this.clientSecret,
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `Cashfree create order failed: ${res.status} ${JSON.stringify(json)}`
      );
    }

    const paymentSessionId =
      typeof json.payment_session_id === 'string' ? json.payment_session_id : undefined;
    const cfOrderId = typeof json.order_id === 'string' ? json.order_id : orderId;
    const paymentUrl =
      typeof json.payment_url === 'string'
        ? json.payment_url
        : typeof (json as { payment_link?: string }).payment_link === 'string'
          ? (json as { payment_link: string }).payment_link
          : undefined;

    return {
      provider: this.id,
      providerPaymentId: cfOrderId,
      paymentSessionId,
      paymentUrl,
      raw: json,
    };
  }

  /**
   * Placeholder: Cashfree collection VA flows depend on account / product.
   * Override this method or extend when your Cashfree account exposes VA creation APIs.
   */
  async createVirtualAccount(params: CreateVirtualAccountParams): Promise<CreateVirtualAccountResult> {
    this.ensureCredentials();
    return {
      provider: this.id,
      raw: {
        message:
          'Virtual account creation not implemented — use Cashfree dashboard / Payouts & VA APIs per your plan.',
        order_id: params.orderId,
        business_id: params.businessId,
      },
    };
  }

  /**
   * Verifies `x-cashfree-signature` (hex HMAC-SHA256 of raw body) per Cashfree webhook docs.
   * If Cashfree changes header names or algorithm, adjust here only.
   */
  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    const secret = this.webhookSecret || this.clientSecret;
    if (!secret) {
      return { verified: false, reason: 'Missing webhook secret / client secret' };
    }

    const raw =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : Buffer.isBuffer(params.rawBody)
          ? params.rawBody.toString('utf8')
          : String(params.rawBody);

    const signature =
      headerFirst(params.headers['x-cashfree-signature']) ||
      headerFirst(params.headers['x-webhook-signature']);

    if (!signature) {
      return { verified: false, reason: 'Missing x-cashfree-signature header' };
    }

    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const sigStr = String(signature).trim();
    let verifiedSig = false;
    try {
      const sigBuf = Buffer.from(sigStr, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      verifiedSig =
        sigBuf.length === expBuf.length && sigBuf.length > 0 && timingSafeEqual(sigBuf, expBuf);
    } catch {
      verifiedSig = false;
    }
    if (!verifiedSig) {
      return {
        verified: false,
        reason: 'Invalid webhook signature (confirm Cashfree signing algorithm in dashboard docs)',
      };
    }

    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const data = (payload.data as Record<string, unknown>) || payload;
      const order = (data.order as Record<string, unknown>) || data;

      const cfPaymentId =
        (typeof data.payment_id === 'string' && data.payment_id) ||
        (typeof data.cf_payment_id === 'string' && data.cf_payment_id) ||
        undefined;

      const orderRef =
        (typeof order.order_id === 'string' && order.order_id) ||
        (typeof data.order_id === 'string' && data.order_id) ||
        undefined;

      const amt =
        typeof order.order_amount === 'number'
          ? order.order_amount
          : typeof data.payment_amount === 'number'
            ? data.payment_amount
            : data.payment_amount != null
              ? Number(data.payment_amount)
              : undefined;

      const st = String(data.payment_status || order.order_status || '').toLowerCase();
      let status: VerifyWebhookResult['status'] = 'pending';
      if (st.includes('success') || st === 'paid') status = 'success';
      else if (st.includes('fail') || st.includes('cancel')) status = 'failed';

      return {
        verified: true,
        eventType: typeof payload.type === 'string' ? payload.type : 'UNKNOWN',
        providerPaymentId: cfPaymentId,
        orderReference: orderRef,
        providerOrderId: orderRef,
        amount: amt,
        currency:
          typeof order.order_currency === 'string'
            ? order.order_currency
            : typeof data.payment_currency === 'string'
              ? data.payment_currency
              : undefined,
        status,
        utr:
          typeof data.payment_utr === 'string'
            ? data.payment_utr
            : typeof data.utr === 'string'
              ? data.utr
              : undefined,
        rawPayload: payload,
      };
    } catch {
      return {
        verified: true,
        reason: 'Signature OK but JSON parse failed',
        rawPayload: { raw },
      };
    }
  }
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}
