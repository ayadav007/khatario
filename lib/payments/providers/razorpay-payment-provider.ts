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
 * Razorpay Payment Links API — credentials ONLY from {@link PaymentProviderConfig}
 * (per-business DB encryption via `payment_provider_configs`). No global ENV key fallback.
 *
 * - `clientId` → Razorpay Key Id (`rzp_test_*` / `rzp_live_*`)
 * - `clientSecret` → Razorpay Key Secret
 *
 * API: https://razorpay.com/docs/api/payment-links/create-standard-payment-links/
 */
export class RazorpayPaymentProvider implements PaymentProvider {
  readonly id = 'razorpay';

  private readonly keyId: string;
  private readonly keySecret: string;
  private readonly webhookSecret: string;
  private readonly baseUrl: string;

  constructor(config: PaymentProviderConfig = {}) {
    this.keyId = config.clientId || config.appId || '';
    this.keySecret =
      config.clientSecret || config.secretKey || '';
    this.webhookSecret = config.webhookSecret || this.keySecret;

    this.baseUrl = (config.baseUrl || 'https://api.razorpay.com').replace(/\/$/, '');
  }

  private ensureCredentials(): void {
    if (!this.keyId || !this.keySecret) {
      throw new Error(
        'RazorpayPaymentProvider: configure Key Id and Key Secret in Payment providers settings (encrypted)'
      );
    }
  }

  private authHeader(): string {
    const raw = `${this.keyId}:${this.keySecret}`;
    return `Basic ${Buffer.from(raw, 'utf8').toString('base64')}`;
  }

  supportsHostedPaymentLinks(): boolean {
    return Boolean(this.keyId && this.keySecret);
  }

  /**
   * POST /v1/payment_links — returns hosted `short_url` for customer checkout.
   */
  async createHostedPaymentLink(
    params: CreateUpiCollectParams
  ): Promise<CreateUpiCollectResult> {
    this.ensureCredentials();

    const currency = (params.currency || 'INR').toUpperCase();
    let amountMinor: number;
    if (currency === 'INR') {
      amountMinor = Math.round(Number(params.amount) * 100);
    } else {
      amountMinor = Math.round(Number(params.amount) * 100);
    }
    if (!Number.isFinite(amountMinor) || amountMinor < 100) {
      throw new Error(
        'Razorpay payment link: minimum amount is ₹1.00 (100 paise)'
      );
    }

    const referenceId = buildPaymentLinkReferenceId(params.orderId);

    const body: Record<string, unknown> = {
      amount: amountMinor,
      currency,
      accept_partial: false,
      reference_id: referenceId,
      description:
        typeof params.metadata?.description === 'string'
          ? params.metadata.description
          : `Order payment (${params.orderId.slice(0, 8)}…)`,
      notify: {
        sms: Boolean(params.customerPhone),
        email: Boolean(params.customerEmail),
      },
      reminder_enable: true,
      notes: {
        khatario_sales_order_id: params.orderId,
        business_id: params.businessId,
        ...stringifyRazorpayNotes(params.metadata),
      },
    };

    if (params.customerName || params.customerPhone || params.customerEmail) {
      body.customer = {
        name: params.customerName || undefined,
        contact: normalizePhone(params.customerPhone),
        email: params.customerEmail || undefined,
      };
    }

    /**
     * Without `callback_url`, Razorpay’s page can show a generic error after the customer
     * returns from a UPI app even when the payment succeeded. Webhooks still apply, but UX breaks.
     * Domain must be allowlisted under Razorpay Dashboard → Settings → Webhooks / Redirect URLs.
     */
    if (params.returnUrl && typeof params.returnUrl === 'string') {
      const u = params.returnUrl.trim();
      if (u.startsWith('https://') || u.startsWith('http://')) {
        body.callback_url = u;
        body.callback_method = 'get';
      }
    }

    const res = await fetch(`${this.baseUrl}/v1/payment_links`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: this.authHeader(),
      },
      body: JSON.stringify(body),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      const errPayload = redactForLogs(json);
      throw new Error(
        `Razorpay payment_links failed: ${res.status} ${JSON.stringify(errPayload)}`
      );
    }

    const plinkId = typeof json.id === 'string' ? json.id : undefined;
    const shortUrl =
      typeof json.short_url === 'string'
        ? json.short_url
        : typeof json.shortUrl === 'string'
          ? json.shortUrl
          : undefined;

    return {
      provider: this.id,
      providerPaymentId: plinkId,
      paymentSessionId: plinkId,
      paymentUrl: shortUrl,
      raw: json,
    };
  }

  /** Delegates to hosted payment link — Razorpay collections use Payment Links, not separate UPI collect API here. */
  async createUpiCollect(params: CreateUpiCollectParams): Promise<CreateUpiCollectResult> {
    return this.createHostedPaymentLink(params);
  }

  async createVirtualAccount(
    _params: CreateVirtualAccountParams
  ): Promise<CreateVirtualAccountResult> {
    this.ensureCredentials();
    return {
      provider: this.id,
      raw: {
        message:
          'Virtual account creation not implemented for Razorpay in this integration.',
      },
    };
  }

  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    const secret = this.webhookSecret;
    if (!secret) {
      return { verified: false, reason: 'Missing Razorpay webhook secret' };
    }

    const raw =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : Buffer.isBuffer(params.rawBody)
          ? params.rawBody.toString('utf8')
          : String(params.rawBody);

    const signature = headerFirst(params.headers['x-razorpay-signature']);
    if (!signature) {
      return { verified: false, reason: 'Missing X-Razorpay-Signature header' };
    }

    const expected = createHmac('sha256', secret).update(raw).digest('hex');
    const sigStr = String(signature).trim();
    let ok = false;
    try {
      const sigBuf = Buffer.from(sigStr, 'hex');
      const expBuf = Buffer.from(expected, 'hex');
      ok =
        sigBuf.length === expBuf.length &&
        sigBuf.length > 0 &&
        timingSafeEqual(sigBuf, expBuf);
    } catch {
      ok = false;
    }

    if (!ok) {
      return { verified: false, reason: 'Invalid Razorpay webhook signature' };
    }

    try {
      const payload = JSON.parse(raw) as Record<string, unknown>;
      const normalized = normalizeRazorpayWebhookPayload(payload);
      return {
        verified: true,
        ...normalized,
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

/** Razorpay event envelope: `{ event, payload: { payment_link?: { entity }, payment?: { entity } } }` */
function normalizeRazorpayWebhookPayload(
  body: Record<string, unknown>
): Omit<VerifyWebhookResult, 'verified' | 'rawPayload'> {
  const eventName =
    typeof body.event === 'string' ? body.event.trim() : '';

  const outer =
    body.payload && typeof body.payload === 'object' && body.payload !== null
      ? (body.payload as Record<string, unknown>)
      : {};

  const paymentWrap = outer.payment as Record<string, unknown> | undefined;
  const paymentLinkWrap = outer.payment_link as Record<string, unknown> | undefined;

  const paymentEntity =
    paymentWrap?.entity && typeof paymentWrap.entity === 'object'
      ? (paymentWrap.entity as Record<string, unknown>)
      : undefined;

  const paymentLinkEntity =
    paymentLinkWrap?.entity && typeof paymentLinkWrap.entity === 'object'
      ? (paymentLinkWrap.entity as Record<string, unknown>)
      : undefined;

  let status: VerifyWebhookResult['status'] = 'pending';

  if (
    eventName === 'payment_link.paid' ||
    eventName === 'payment.captured'
  ) {
    status = 'success';
  } else if (
    eventName === 'payment.failed' ||
    eventName === 'payment_link.cancelled'
  ) {
    status = 'failed';
  } else {
    status = inferStatusFromLegacyEntityFields(
      eventName,
      paymentEntity,
      paymentLinkEntity
    );
  }

  const amount = extractAmountInr(eventName, paymentEntity, paymentLinkEntity);
  const providerPaymentId = extractProviderPaymentId(
    eventName,
    paymentEntity,
    paymentLinkEntity
  );
  const orderReference = extractOrderReference(
    paymentEntity,
    paymentLinkEntity
  );
  const paymentLinkId =
    typeof paymentLinkEntity?.id === 'string'
      ? paymentLinkEntity.id.trim()
      : undefined;

  const currency =
    (typeof paymentEntity?.currency === 'string' && paymentEntity.currency) ||
    (typeof paymentLinkEntity?.currency === 'string' &&
      paymentLinkEntity.currency) ||
    'INR';

  const utr = extractUtr(paymentEntity);

  return {
    eventType: eventName || 'razorpay_webhook',
    status,
    amount,
    currency,
    providerPaymentId,
    orderReference,
    /** Payment link id (`plink_*`) for matching `raw_payload.provider_order_id` — not the Khatario order id */
    providerOrderId: paymentLinkId,
    utr,
  };
}

function inferStatusFromLegacyEntityFields(
  eventName: string,
  paymentEntity: Record<string, unknown> | undefined,
  paymentLinkEntity: Record<string, unknown> | undefined
): VerifyWebhookResult['status'] {
  const st = String(
    paymentEntity?.status ||
      paymentLinkEntity?.status ||
      eventName ||
      ''
  ).toLowerCase();
  if (
    st.includes('captured') ||
    st.includes('paid') ||
    (eventName.startsWith('payment_link.') && eventName.endsWith('.paid'))
  ) {
    return 'success';
  }
  if (
    st.includes('failed') ||
    st.includes('cancel') ||
    eventName.includes('cancelled')
  ) {
    return 'failed';
  }
  return 'pending';
}

function paiseToInr(paise: unknown): number | undefined {
  if (paise == null || paise === '') return undefined;
  const n = typeof paise === 'number' ? paise : Number(paise);
  if (!Number.isFinite(n)) return undefined;
  return n / 100;
}

function extractAmountInr(
  eventName: string,
  paymentEntity: Record<string, unknown> | undefined,
  paymentLinkEntity: Record<string, unknown> | undefined
): number | undefined {
  if (eventName === 'payment_link.paid' && paymentLinkEntity) {
    const paid = paiseToInr(
      paymentLinkEntity.amount_paid ?? paymentLinkEntity.amount
    );
    if (paid != null) return paid;
  }
  if (eventName === 'payment.captured' && paymentEntity) {
    const cap = paiseToInr(paymentEntity.amount);
    if (cap != null) return cap;
  }
  if (eventName === 'payment.failed' && paymentEntity) {
    const fail = paiseToInr(paymentEntity.amount);
    if (fail != null) return fail;
  }
  if (eventName === 'payment_link.cancelled' && paymentLinkEntity) {
    const can = paiseToInInrCancelled(paymentLinkEntity);
    if (can != null) return can;
  }

  const fallback =
    paiseToInr(paymentEntity?.amount) ??
    paiseToInr(paymentLinkEntity?.amount_paid) ??
    paiseToInr(paymentLinkEntity?.amount);
  return fallback;
}

function paiseToInInrCancelled(
  paymentLinkEntity: Record<string, unknown>
): number | undefined {
  return paiseToInr(
    paymentLinkEntity.amount_paid ??
      paymentLinkEntity.amount ??
      paymentLinkEntity.amount_due
  );
}

function extractProviderPaymentId(
  eventName: string,
  paymentEntity: Record<string, unknown> | undefined,
  paymentLinkEntity: Record<string, unknown> | undefined
): string | undefined {
  const payId =
    typeof paymentEntity?.id === 'string' ? paymentEntity.id : undefined;
  const plinkId =
    typeof paymentLinkEntity?.id === 'string'
      ? paymentLinkEntity.id
      : undefined;

  if (
    eventName === 'payment.captured' ||
    eventName === 'payment.failed'
  ) {
    return payId ?? plinkId;
  }
  if (
    eventName === 'payment_link.paid' ||
    eventName === 'payment_link.cancelled'
  ) {
    return payId ?? plinkId;
  }

  return payId ?? plinkId;
}

function extractOrderReference(
  paymentEntity: Record<string, unknown> | undefined,
  paymentLinkEntity: Record<string, unknown> | undefined
): string | undefined {
  const fromNotes = (ent?: Record<string, unknown>) => {
    const notes = ent?.notes as Record<string, unknown> | undefined;
    if (notes && typeof notes.khatario_sales_order_id === 'string') {
      return notes.khatario_sales_order_id.trim();
    }
    return undefined;
  };

  return (
    fromNotes(paymentEntity) ||
    fromNotes(paymentLinkEntity) ||
    (typeof paymentLinkEntity?.reference_id === 'string'
      ? paymentLinkEntity.reference_id.trim()
      : undefined)
  );
}

function extractUtr(
  paymentEntity: Record<string, unknown> | undefined
): string | undefined {
  if (!paymentEntity) return undefined;
  const acquirer = paymentEntity.acquirer_data as
    | Record<string, unknown>
    | undefined;
  if (acquirer && typeof acquirer.upi_transaction_id === 'string') {
    return acquirer.upi_transaction_id;
  }
  const utr = paymentEntity.utr ?? paymentEntity.bank_transaction_id;
  return typeof utr === 'string' ? utr : undefined;
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/**
 * Razorpay `reference_id` — max 40 chars. Format `SO-{orderIdShort}-{timestamp}` (e.g.
 * `SO-abc123-1723456789`). Timestamp is epoch milliseconds so successive links for the same
 * order stay unique; order segment is truncated to fit.
 */
function buildPaymentLinkReferenceId(orderId: string): string {
  const timestamp = Date.now();
  const tsStr = String(timestamp);
  const orderCompact = orderId.replace(/-/g, '').toLowerCase();
  const maxShort = Math.max(
    1,
    40 - 'SO-'.length - '-'.length - tsStr.length
  );
  const orderIdShort = orderCompact.slice(0, maxShort);
  return `SO-${orderIdShort}-${tsStr}`;
}

function normalizePhone(phone?: string): string | undefined {
  if (!phone || typeof phone !== 'string') return undefined;
  const d = phone.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : undefined;
}

/** Razorpay notes values must be strings (max 255 chars each). */
function stringifyRazorpayNotes(
  metadata?: Record<string, unknown>,
): Record<string, string> {
  if (!metadata) return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (value == null || key === 'description') continue;
    const s = String(value).trim();
    if (s) out[key] = s.slice(0, 255);
  }
  return out;
}

/** Strip nested secrets from API error objects before logging / throwing to clients. */
function redactForLogs(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (/secret|password|token|authorization/i.test(k)) {
      out[k] = '[redacted]';
    }
  }
  return out;
}
