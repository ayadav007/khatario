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

/**
 * PayU India hosted checkout (`/_payment`) + server-to-server response verification.
 *
 * Credentials (from encrypted `payment_provider_configs`):
 * - `clientId` → Merchant Key
 * - `clientSecret` → Merchant Salt (never log)
 *
 * Hash formulas follow PayU’s PHP integration samples (SHA-512, lowercase hex).
 */

function sha512LowerHex(input: string): string {
  return createHash('sha512').update(input, 'utf8').digest('hex');
}

/** PayU request hash: key|txnid|amount|productinfo|firstname|email|udf1|…|udf5||||||salt */
function payuRequestHash(params: {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1: string;
  udf2: string;
  udf3: string;
  udf4: string;
  udf5: string;
  salt: string;
}): string {
  const base = [
    params.key,
    params.txnid,
    params.amount,
    params.productinfo,
    params.firstname,
    params.email,
    params.udf1,
    params.udf2,
    params.udf3,
    params.udf4,
    params.udf5,
  ].join('|');
  const hashString = `${base}||||||${params.salt}`;
  return sha512LowerHex(hashString);
}

/**
 * PayU reverse hash (response), matching PHP:
 * salt + '|' + status + '||||||||||' + udf5 + '|' + udf4 + '|' + udf3 + '|' + udf2 + '|' + udf1 + '|' + email + '|' + firstname + '|' + productinfo + '|' + amount + '|' + txnid + '|' + key
 */
function payuReverseHashString(params: {
  salt: string;
  status: string;
  udf5: string;
  udf4: string;
  udf3: string;
  udf2: string;
  udf1: string;
  email: string;
  firstname: string;
  productinfo: string;
  amount: string;
  txnid: string;
  key: string;
}): string {
  const tail = [
    params.udf5,
    params.udf4,
    params.udf3,
    params.udf2,
    params.udf1,
    params.email,
    params.firstname,
    params.productinfo,
    params.amount,
    params.txnid,
    params.key,
  ].join('|');
  return `${params.salt}|${params.status}||||||||||${tail}`;
}

function payuReverseHash(params: Parameters<typeof payuReverseHashString>[0]): string {
  return sha512LowerHex(payuReverseHashString(params));
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

function formatAmountInr2(amount: number): string {
  return Number(amount).toFixed(2);
}

/** PayU txnid max length is commonly 25–40 chars — keep compact. */
function buildPayuTxnId(orderId: string): string {
  const ts = Date.now();
  const short = orderId.replace(/-/g, '').slice(0, 12);
  let txn = `SO-${short}-${ts}`;
  if (txn.length > 40) txn = txn.slice(0, 40);
  return txn;
}

function parsePayuBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) return out;
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(j)) {
        if (v != null) out[k] = String(v);
      }
      return out;
    } catch {
      /* fall through */
    }
  }
  const params = new URLSearchParams(trimmed);
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function headerFirst(v: string | string[] | undefined): string | undefined {
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

/** Strip secrets from objects before throwing / logging. */
function redactForLogs(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (/salt|secret|key|hash|token|password/i.test(k)) {
      out[k] = '[redacted]';
    }
  }
  return out;
}

export class PayuPaymentProvider implements PaymentProvider {
  readonly id = 'payu';

  private readonly merchantKey: string;
  private readonly merchantSalt: string;
  private readonly environment: 'sandbox' | 'production';
  private readonly paymentEndpoint: string;

  constructor(config: PaymentProviderConfig = {}) {
    this.merchantKey = (config.clientId || config.appId || '').trim();
    this.merchantSalt = (
      config.clientSecret ||
      config.secretKey ||
      ''
    ).trim();
    this.environment =
      config.environment === 'production' ? 'production' : 'sandbox';
    this.paymentEndpoint =
      this.environment === 'production'
        ? 'https://secure.payu.in/_payment'
        : 'https://test.payu.in/_payment';
  }

  private ensureCredentials(): void {
    if (!this.merchantKey || !this.merchantSalt) {
      throw new Error(
        'PayuPaymentProvider: configure Merchant Key and Merchant Salt in Payment providers settings (encrypted)'
      );
    }
  }

  supportsHostedPaymentLinks(): boolean {
    return Boolean(this.merchantKey && this.merchantSalt);
  }

  /**
   * Builds a hosted PayU redirect URL (GET with query params).
   * PayU production setups often prefer POST form submit; `raw.post_fields` mirrors all fields for HTML POST fallback.
   */
  async createHostedPaymentLink(
    params: CreateUpiCollectParams
  ): Promise<CreateUpiCollectResult> {
    this.ensureCredentials();

    const currency = (params.currency || 'INR').toUpperCase();
    if (currency !== 'INR') {
      throw new Error('PayU adapter: only INR is supported for hosted checkout');
    }

    const amt = Number(params.amount);
    if (!Number.isFinite(amt) || amt < 1) {
      throw new Error('PayU: minimum amount is ₹1.00');
    }

    const amountStr = formatAmountInr2(amt);
    const txnid = buildPayuTxnId(params.orderId);
    const productinfo =
      typeof params.metadata?.description === 'string'
        ? String(params.metadata.description).slice(0, 100)
        : `Order payment`;
    const firstname = (
      params.customerName ||
      'Customer'
    )
      .trim()
      .slice(0, 60) || 'Customer';
    const email = (
      params.customerEmail ||
      'customer@example.com'
    )
      .trim()
      .slice(0, 120);

    const defaultReturn =
      typeof params.returnUrl === 'string' && params.returnUrl.startsWith('http')
        ? params.returnUrl
        : 'https://payu.in';
    const surl = defaultReturn;
    const furl = defaultReturn;

    const udf1 = params.orderId;
    const udf2 = params.businessId;
    const udf3 = '';
    const udf4 = '';
    const udf5 = '';

    const hash = payuRequestHash({
      key: this.merchantKey,
      txnid,
      amount: amountStr,
      productinfo,
      firstname,
      email,
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
      salt: this.merchantSalt,
    });

    const postFields: Record<string, string> = {
      key: this.merchantKey,
      txnid,
      amount: amountStr,
      productinfo,
      firstname,
      email,
      surl,
      furl,
      hash,
      service_provider: 'payu',
      udf1,
      udf2,
      udf3,
      udf4,
      udf5,
    };
    if (params.customerPhone?.trim()) {
      postFields.phone = normalizePhone(params.customerPhone) || params.customerPhone.trim();
    }

    const url = new URL(this.paymentEndpoint);
    for (const [k, v] of Object.entries(postFields)) {
      url.searchParams.set(k, v);
    }

    return {
      provider: this.id,
      providerPaymentId: txnid,
      paymentSessionId: txnid,
      paymentUrl: url.toString(),
      raw: {
        endpoint: this.paymentEndpoint,
        txnid,
        post_fields: postFields,
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
          'Virtual account creation not implemented for PayU in this integration.',
      },
    };
  }

  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    if (!this.merchantSalt || !this.merchantKey) {
      return { verified: false, reason: 'Missing PayU merchant credentials' };
    }

    const raw =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : Buffer.isBuffer(params.rawBody)
          ? params.rawBody.toString('utf8')
          : String(params.rawBody);

    /** Fields extracted only for reverse-hash verification (same bytes as route `rawBody`). */
    const payload = parsePayuBody(raw);
    const receivedHash =
      payload.hash ||
      payload.HASH ||
      headerFirst(params.headers['hash']) ||
      '';

    const statusRaw =
      payload.status || payload.Status || payload.payment_status || '';
    const statusNorm = String(statusRaw).trim().toLowerCase();

    const txnid = payload.txnid || payload.txnId || '';
    const mihpayid = payload.mihpayid || payload.MIHpayID || '';
    const amountStr = payload.amount ?? payload.amt ?? '';
    const productinfo = payload.productinfo || '';
    const firstname = payload.firstname || '';
    const email = payload.email || '';
    const udf1 = payload.udf1 || '';
    const udf2 = payload.udf2 || '';
    const udf3 = payload.udf3 || '';
    const udf4 = payload.udf4 || '';
    const udf5 = payload.udf5 || '';

    const expectedHash = payuReverseHash({
      salt: this.merchantSalt,
      status: String(statusRaw || ''),
      udf5,
      udf4,
      udf3,
      udf2,
      udf1,
      email,
      firstname,
      productinfo,
      amount: String(amountStr || ''),
      txnid: String(txnid || ''),
      key: this.merchantKey,
    });

    const hashOk = receivedHash
      ? safeEqualHex(expectedHash, receivedHash)
      : false;

    if (!hashOk) {
      return {
        verified: false,
        reason: 'Invalid PayU response hash',
        rawPayload: redactForLogs(payload as Record<string, unknown>) as Record<
          string,
          unknown
        >,
      };
    }

    /* Normalized webhook fields only after hash verification succeeds. */
    const amountNum = Number.parseFloat(String(amountStr).replace(/,/g, ''));
    const amount =
      Number.isFinite(amountNum) && amountNum >= 0 ? amountNum : undefined;

    const normalizedStatus = mapPayuStatusToWebhookStatus(statusNorm);

    return {
      verified: true,
      eventType: 'payu_return',
      providerPaymentId: String(mihpayid || '').trim() || undefined,
      providerOrderId: String(txnid || '').trim() || undefined,
      orderReference: String(udf1 || '').trim() || undefined,
      amount,
      currency: 'INR',
      status: normalizedStatus,
      rawPayload: payload as Record<string, unknown>,
    };
  }
}

function normalizePhone(phone?: string): string | undefined {
  if (!phone || typeof phone !== 'string') return undefined;
  const d = phone.replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : undefined;
}

/** PayU `status` → {@link VerifyWebhookResult} status (only these normalizations). */
function mapPayuStatusToWebhookStatus(
  statusLower: string
): NonNullable<VerifyWebhookResult['status']> {
  switch (statusLower) {
    case 'success':
      return 'success';
    case 'failure':
    case 'failed':
    case 'cancelled':
      return 'failed';
    case 'pending':
      return 'pending';
    default:
      return 'pending';
  }
}
