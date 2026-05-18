/**
 * Instamojo REST API v1.1 — payment requests + webhook MAC (HMAC-SHA1).
 *
 * - `clientId` → API Key (`X-Api-Key`), `clientSecret` → Auth Token (`X-Auth-Token`).
 * - Webhook MAC uses your **Private Salt** from the Developers page; set via
 *   `PaymentProviderConfig.webhookSecret` or `INSTAMOJO_PRIVATE_SALT`, otherwise falls back to the Auth Token.
 */
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

/** Instamojo may reject very small amounts on live accounts; API errors surface clearly. */
const MIN_INR = 1;

function baseUrl(env: 'sandbox' | 'production'): string {
  return env === 'production'
    ? 'https://www.instamojo.com'
    : 'https://test.instamojo.com';
}

function headerFirst(
  h: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const v = h[name.toLowerCase()] ?? h[name];
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function redactForLogs(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (/^(mac|token|secret|key|auth)/i.test(k)) {
      out[k] = '[redacted]';
    }
  }
  return out;
}

/** Flat webhook MAC material — Instamojo expects sorted keys, pipe-separated values (mac excluded). */
function computeInstamojoMac(
  flat: Record<string, string>,
  salt: string
): string {
  const entries = Object.entries(flat).filter(
    ([k]) => k.toLowerCase() !== 'mac'
  );
  entries.sort((a, b) =>
    a[0].localeCompare(b[0], undefined, { sensitivity: 'base' })
  );
  const message = entries.map(([, v]) => v).join('|');
  return createHmac('sha1', salt).update(message, 'utf8').digest('hex');
}

function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(String(a).trim().toLowerCase(), 'utf8');
  const y = Buffer.from(String(b).trim().toLowerCase(), 'utf8');
  if (x.length !== y.length || x.length === 0) return false;
  try {
    return timingSafeEqual(x, y);
  } catch {
    return false;
  }
}

function parseBodyToFlatStringRecord(raw: string): Record<string, string> {
  const t = raw.trim();
  if (t.startsWith('{') || t.startsWith('[')) {
    const o = JSON.parse(t) as Record<string, unknown>;
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) {
      if (v == null) continue;
      if (typeof v === 'object') continue;
      out[k] = String(v);
    }
    return out;
  }
  const sp = new URLSearchParams(t);
  const out: Record<string, string> = {};
  sp.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function mapPaymentStatus(s: string | undefined): VerifyWebhookResult['status'] {
  const x = (s ?? '').trim().toLowerCase();
  if (x === 'credit' || x === 'completed' || x === 'successful') {
    return 'success';
  }
  if (x === 'failed' || x === 'failure') {
    return 'failed';
  }
  if (x === 'pending') {
    return 'pending';
  }
  return 'pending';
}

export class InstamojoPaymentProvider implements PaymentProvider {
  readonly id = 'instamojo';

  private readonly apiKey: string;
  private readonly authToken: string;
  /** Private Salt (Dashboard → Developers); MAC verification falls back to Auth Token if unset. */
  private readonly macSalt: string;
  private readonly environment: 'sandbox' | 'production';

  constructor(config: PaymentProviderConfig = {}) {
    this.apiKey = (config.clientId || config.appId || '').trim();
    this.authToken = (
      config.clientSecret ||
      config.secretKey ||
      ''
    ).trim();
    this.macSalt = (
      config.webhookSecret ||
      this.authToken ||
      ''
    ).trim();
    this.environment =
      config.environment === 'production' ? 'production' : 'sandbox';
  }

  private ensureCredentials(): void {
    if (!this.apiKey || !this.authToken) {
      throw new Error(
        'InstamojoPaymentProvider: configure API Key (client id) and Auth Token (client secret)'
      );
    }
  }

  supportsHostedPaymentLinks(): boolean {
    return Boolean(this.apiKey && this.authToken);
  }

  /**
   * POST `/api/1.1/payment-requests/` — `application/x-www-form-urlencoded`.
   */
  async createHostedPaymentLink(
    params: CreateUpiCollectParams
  ): Promise<CreateUpiCollectResult> {
    this.ensureCredentials();

    const currency = (params.currency || 'INR').toUpperCase();
    if (currency !== 'INR') {
      throw new Error('InstamojoPaymentProvider: only INR is supported');
    }

    const rupees = Number(params.amount);
    if (!Number.isFinite(rupees) || rupees < MIN_INR) {
      throw new Error(
        `InstamojoPaymentProvider: minimum amount is ₹${MIN_INR.toFixed(2)}`
      );
    }

    const redirectUrl =
      typeof params.returnUrl === 'string' && params.returnUrl.startsWith('http')
        ? params.returnUrl
        : undefined;
    const webhookUrl =
      typeof params.notifyUrl === 'string' && params.notifyUrl.startsWith('http')
        ? params.notifyUrl
        : redirectUrl;

    if (!redirectUrl) {
      throw new Error(
        'InstamojoPaymentProvider: returnUrl must be an absolute http(s) URL'
      );
    }
    if (!webhookUrl) {
      throw new Error(
        'InstamojoPaymentProvider: notifyUrl or returnUrl must provide webhook URL'
      );
    }

    const buyerName =
      typeof params.customerName === 'string' && params.customerName.trim()
        ? params.customerName.trim().slice(0, 120)
        : 'Customer';
    const email =
      typeof params.customerEmail === 'string' && params.customerEmail.includes('@')
        ? params.customerEmail.trim()
        : 'test@example.com';

    const body = new URLSearchParams({
      purpose: `Order ${params.orderId}`.slice(0, 512),
      amount: rupees.toFixed(2),
      buyer_name: buyerName,
      email,
      redirect_url: redirectUrl,
      webhook: webhookUrl,
      allow_repeated_payments: 'false',
    });
    if (
      typeof params.customerPhone === 'string' &&
      params.customerPhone.trim()
    ) {
      body.set('phone', params.customerPhone.trim().slice(0, 20));
    }

    const url = `${baseUrl(this.environment)}/api/1.1/payment-requests/`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        'X-Api-Key': this.apiKey,
        'X-Auth-Token': this.authToken,
      },
      body: body.toString(),
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `Instamojo payment-requests failed: ${res.status} ${JSON.stringify(redactForLogs(json))}`
      );
    }

    const pr = json.payment_request as Record<string, unknown> | undefined;
    const requestId =
      typeof pr?.id === 'string'
        ? pr.id
        : typeof json.id === 'string'
          ? json.id
          : undefined;
    const paymentUrl =
      typeof pr?.longurl === 'string'
        ? pr.longurl
        : typeof pr?.longUrl === 'string'
          ? pr.longUrl
          : typeof json.longurl === 'string'
            ? json.longurl
            : undefined;

    if (!paymentUrl || !requestId) {
      throw new Error(
        `Instamojo payment-requests: missing longurl or id ${JSON.stringify(redactForLogs(json))}`
      );
    }

    return {
      provider: this.id,
      providerPaymentId: requestId,
      paymentSessionId: requestId,
      paymentUrl,
      raw: {
        ...json,
        payment_request: pr ?? { id: requestId, longurl: paymentUrl },
      },
    };
  }

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
          'Virtual account creation not implemented for Instamojo in this integration.',
      },
    };
  }

  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    if (!this.macSalt) {
      return { verified: false, reason: 'Missing Instamojo credentials for MAC' };
    }

    const raw =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : Buffer.isBuffer(params.rawBody)
          ? params.rawBody.toString('utf8')
          : String(params.rawBody);

    let flat: Record<string, string>;
    try {
      flat = parseBodyToFlatStringRecord(raw);
    } catch {
      return { verified: false, reason: 'Invalid webhook body' };
    }

    const receivedMac =
      flat.mac ??
      flat.MAC ??
      headerFirst(params.headers, 'x-instamojo-mac') ??
      headerFirst(params.headers, 'X-Instamojo-MAC');

    if (!receivedMac?.trim()) {
      return {
        verified: false,
        reason: 'Missing Instamojo MAC (webhook authenticity)',
      };
    }

    const expected = computeInstamojoMac(flat, this.macSalt);
    if (!safeEqualHex(expected, receivedMac)) {
      return { verified: false, reason: 'Invalid Instamojo MAC' };
    }

    const paymentId =
      flat.payment_id ||
      flat.paymentId ||
      flat['payment[id]'] ||
      '';
    const paymentRequestId =
      flat.payment_request_id ||
      flat.payment_requestId ||
      flat.id ||
      '';

    const statusRaw =
      flat.payment_status ||
      flat.payment_status_string ||
      flat.status ||
      '';

    const amountStr = flat.amount ?? '';

    let amountNum: number | undefined;
    if (amountStr) {
      const n = parseFloat(String(amountStr).replace(/,/g, ''));
      if (Number.isFinite(n)) {
        amountNum = Math.round(n * 100) / 100;
      }
    }

    let rawPayload: Record<string, unknown>;
    try {
      const t = raw.trim();
      rawPayload = t.startsWith('{')
        ? (JSON.parse(t) as Record<string, unknown>)
        : Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, v]));
    } catch {
      rawPayload = Object.fromEntries(Object.entries(flat).map(([k, v]) => [k, v]));
    }

    return {
      verified: true,
      eventType: 'instamojo_webhook',
      providerPaymentId: paymentId || undefined,
      providerOrderId: paymentRequestId || undefined,
      orderReference: undefined,
      amount: amountNum,
      currency: 'INR',
      status: mapPaymentStatus(statusRaw),
      rawPayload,
    };
  }
}
