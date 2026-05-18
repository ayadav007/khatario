import { createHash, timingSafeEqual } from 'crypto';
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

const PAY_API_PATH = '/pg/v1/pay';

/** Sandbox vs production PG hosts (PhonePe Standard Checkout PG v1). */
function payEndpointBase(env: 'sandbox' | 'production'): string {
  return env === 'production'
    ? 'https://api.phonepe.com/apis/hermes'
    : 'https://api-preprod.phonepe.com/apis/pg-sandbox';
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
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

function sha256HexUtf8(s: string): string {
  return createHash('sha256').update(s, 'utf8').digest('hex');
}

/**
 * PhonePe X-VERIFY: `SHA256(base64Payload + "/pg/v1/pay" + saltKey)` hex + `###` + salt index.
 */
function buildXVerify(base64Payload: string, saltKey: string, saltIndex: string): string {
  const checksum = sha256HexUtf8(base64Payload + PAY_API_PATH + saltKey);
  return `${checksum}###${saltIndex}`;
}

function redactForLogs(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (/salt|secret|key|token|authorization|checksum|verify/i.test(k)) {
      out[k] = '[redacted]';
    }
  }
  return out;
}

/** Compact merchant transaction id (PhonePe limits apply). */
function buildMerchantTransactionId(orderId: string): string {
  const ts = Date.now();
  const short = orderId.replace(/-/g, '').slice(0, 12);
  let id = `SO-${short}-${ts}`;
  if (id.length > 38) id = id.slice(0, 38);
  return id;
}

function paiseToInr(paise: unknown): number | undefined {
  if (paise == null) return undefined;
  const n = typeof paise === 'number' ? paise : Number(paise);
  if (!Number.isFinite(n)) return undefined;
  return Math.round((n / 100) * 100) / 100;
}

/**
 * Verify webhook `X-VERIFY` against common PhonePe concatenation orders (response base64 + salt).
 */
function verifyWebhookXVerify(params: {
  rawBody: string;
  responseB64: string | undefined;
  saltKey: string;
  receivedXVerify: string | undefined;
}): boolean {
  const recv = params.receivedXVerify?.trim();
  if (!recv) return false;
  const parts = recv.split('###');
  const recvHex = parts[0]?.trim().toLowerCase();
  if (!recvHex) return false;

  const candidates: string[] = [];
  const sk = params.saltKey;
  const rb = params.responseB64;

  if (rb) {
    candidates.push(rb + PAY_API_PATH + sk);
    candidates.push(rb + sk + PAY_API_PATH);
    candidates.push(sk + rb + PAY_API_PATH);
    candidates.push(sk + PAY_API_PATH + rb);
    candidates.push(rb + sk);
    candidates.push(sk + rb);
  }
  candidates.push(params.rawBody + sk);
  candidates.push(sk + params.rawBody);

  for (const s of candidates) {
    const hex = sha256HexUtf8(s);
    if (safeEqualHex(hex, recvHex)) return true;
  }
  return false;
}

function mapPhonePeCodeToStatus(input: {
  code?: string;
  state?: string;
  responseCode?: string;
}): VerifyWebhookResult['status'] {
  const rc = (input.responseCode ?? '').trim().toUpperCase();
  if (rc === 'SUCCESS') return 'success';
  if (rc === 'FAILED') return 'failed';
  if (rc === 'PENDING') return 'pending';

  const c = `${input.code ?? ''} ${input.state ?? ''} ${input.responseCode ?? ''}`
    .toUpperCase()
    .trim();
  if (
    c.includes('SUCCESS') ||
    c.includes('COMPLETED') ||
    c.includes('PAYMENT_SUCCESS')
  ) {
    return 'success';
  }
  if (
    c.includes('FAILED') ||
    c.includes('FAILURE') ||
    c.includes('ERROR') ||
    c.includes('DECLINED')
  ) {
    return 'failed';
  }
  if (c.includes('PENDING') || c.includes('INITIATED')) {
    return 'pending';
  }
  return 'pending';
}

export class PhonePePaymentProvider implements PaymentProvider {
  readonly id = 'phonepe';

  private readonly merchantId: string;
  private readonly saltKey: string;
  private readonly saltIndex: string;
  private readonly environment: 'sandbox' | 'production';

  constructor(config: PaymentProviderConfig = {}) {
    this.merchantId = (config.clientId || config.appId || '').trim();
    this.saltKey = (
      config.clientSecret ||
      config.secretKey ||
      ''
    ).trim();
    const idxEnv =
      typeof process.env.PHONEPE_SALT_INDEX === 'string'
        ? process.env.PHONEPE_SALT_INDEX.trim()
        : '';
    this.saltIndex = /^\d+$/.test(idxEnv) ? idxEnv : '1';
    this.environment =
      config.environment === 'production' ? 'production' : 'sandbox';
  }

  private ensureCredentials(): void {
    if (!this.merchantId || !this.saltKey) {
      throw new Error(
        'PhonePePaymentProvider: configure Merchant Id (client id) and Salt Key (client secret) in Payment providers settings'
      );
    }
  }

  supportsHostedPaymentLinks(): boolean {
    return Boolean(this.merchantId && this.saltKey);
  }

  async createHostedPaymentLink(
    params: CreateUpiCollectParams
  ): Promise<CreateUpiCollectResult> {
    this.ensureCredentials();

    const currency = (params.currency || 'INR').toUpperCase();
    if (currency !== 'INR') {
      throw new Error('PhonePePaymentProvider: only INR is supported');
    }

    const rupees = Number(params.amount);
    if (!Number.isFinite(rupees) || rupees < 1) {
      throw new Error('PhonePePaymentProvider: minimum amount is ₹1.00');
    }

    const amountPaise = Math.round(rupees * 100);
    const merchantTransactionId = buildMerchantTransactionId(params.orderId);

    const redirectUrl =
      typeof params.returnUrl === 'string' && params.returnUrl.startsWith('http')
        ? params.returnUrl
        : undefined;
    const callbackUrl =
      typeof params.notifyUrl === 'string' && params.notifyUrl.startsWith('http')
        ? params.notifyUrl
        : redirectUrl;

    if (!redirectUrl) {
      throw new Error(
        'PhonePePaymentProvider: returnUrl must be an absolute http(s) URL for redirectUrl'
      );
    }
    if (!callbackUrl) {
      throw new Error(
        'PhonePePaymentProvider: notifyUrl or returnUrl must provide callbackUrl for PhonePe webhooks'
      );
    }

    const innerPayload = {
      merchantId: this.merchantId,
      merchantTransactionId,
      merchantUserId: params.businessId,
      amount: amountPaise,
      redirectUrl,
      redirectMode: 'POST',
      callbackUrl,
      paymentInstrument: {
        type: 'PAY_PAGE',
      },
    };

    const jsonStr = JSON.stringify(innerPayload);
    const base64Payload = Buffer.from(jsonStr, 'utf8').toString('base64');
    const xVerify = buildXVerify(base64Payload, this.saltKey, this.saltIndex);

    const url = `${payEndpointBase(this.environment)}${PAY_API_PATH}`;
    const requestBody = JSON.stringify({ request: base64Payload });

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-VERIFY': xVerify,
        'X-MERCHANT-ID': this.merchantId,
      },
      body: requestBody,
    });

    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      throw new Error(
        `PhonePe pg/v1/pay failed: ${res.status} ${JSON.stringify(redactForLogs(json))}`
      );
    }

    if (json.success === false) {
      throw new Error(
        `PhonePe pg/v1/pay rejected: ${JSON.stringify(redactForLogs(json))}`
      );
    }

    const paymentUrl = extractPayPageRedirectUrl(json);

    if (!paymentUrl) {
      throw new Error(
        `PhonePe pg/v1/pay: missing redirect URL in response ${JSON.stringify(redactForLogs(json))}`
      );
    }

    return {
      provider: this.id,
      providerPaymentId: merchantTransactionId,
      paymentSessionId: merchantTransactionId,
      paymentUrl,
      raw: {
        ...json,
        merchantTransactionId,
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
          'Virtual account creation not implemented for PhonePe in this integration.',
      },
    };
  }

  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    if (!this.merchantId || !this.saltKey) {
      return { verified: false, reason: 'Missing PhonePe merchant credentials' };
    }

    const raw =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : Buffer.isBuffer(params.rawBody)
          ? params.rawBody.toString('utf8')
          : String(params.rawBody);

    let outer: Record<string, unknown>;
    try {
      outer = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return { verified: false, reason: 'Invalid JSON webhook body' };
    }

    const responseB64 =
      typeof outer.response === 'string'
        ? outer.response
        : typeof outer.payload === 'string'
          ? outer.payload
          : undefined;

    const xVerifyHeader =
      headerFirst(params.headers['x-verify']) ||
      headerFirst(params.headers['X-VERIFY']);

    const ok = verifyWebhookXVerify({
      rawBody: raw,
      responseB64,
      saltKey: this.saltKey,
      receivedXVerify: xVerifyHeader,
    });

    if (!ok) {
      return {
        verified: false,
        reason: 'Invalid PhonePe webhook checksum',
        rawPayload: redactForLogs(outer),
      };
    }

    let inner: Record<string, unknown> = {};
    if (responseB64) {
      try {
        const decoded = Buffer.from(responseB64, 'base64').toString('utf8');
        inner = JSON.parse(decoded) as Record<string, unknown>;
      } catch {
        inner = {};
      }
    }
    const data = (inner.data as Record<string, unknown>) || inner;
    const nestedData =
      data && typeof data === 'object'
        ? (data as Record<string, unknown>)
        : {};

    const merchantTransactionId =
      pickString(nestedData, [
        'merchantTransactionId',
        'merchant_transaction_id',
      ]) ||
      pickString(inner, ['merchantTransactionId']) ||
      '';

    const transactionId =
      pickString(nestedData, ['transactionId', 'providerReferenceId']) ||
      pickString(inner, ['transactionId']) ||
      '';

    const amountPaise =
      nestedData.amount ?? inner.amount ?? nestedData.transactionAmount;

    const amountInr = paiseToInr(amountPaise);

    const status = mapPhonePeCodeToStatus({
      code:
        pickString(inner, ['code']) ||
        pickString(nestedData, ['responseCode', 'code']),
      state: pickString(nestedData, ['state']),
      responseCode: pickString(nestedData, ['responseCode']),
    });

    return {
      verified: true,
      eventType: 'phonepe_webhook',
      providerPaymentId: transactionId || undefined,
      providerOrderId: merchantTransactionId || undefined,
      orderReference: undefined,
      amount: amountInr,
      currency: 'INR',
      status,
      rawPayload: outer,
    };
  }
}

function pickString(
  obj: Record<string, unknown>,
  keys: string[]
): string | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function extractPayPageRedirectUrl(json: Record<string, unknown>): string | undefined {
  const data = json.data as Record<string, unknown> | undefined;
  const ir = data?.instrumentResponse as Record<string, unknown> | undefined;
  const ri = ir?.redirectInfo as Record<string, unknown> | undefined;
  const url =
    typeof ri?.url === 'string'
      ? ri.url
      : typeof ir?.redirectUrl === 'string'
        ? ir.redirectUrl
        : undefined;
  if (url && /^https?:\/\//i.test(url)) return url;

  const alt =
    typeof json.redirectUrl === 'string'
      ? json.redirectUrl
      : typeof data?.redirectUrl === 'string'
        ? (data.redirectUrl as string)
        : undefined;
  return alt && /^https?:\/\//i.test(alt) ? alt : undefined;
}
