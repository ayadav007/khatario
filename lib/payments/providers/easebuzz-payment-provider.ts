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
 * Easebuzz hosted checkout (Initiate Payment API) + response / webhook verification.
 *
 * Credentials (from encrypted `payment_provider_configs`, or platform env for Khatario billing):
 * - `clientId` → Merchant Key
 * - `clientSecret` → Salt (never log)
 *
 * Hash formulas (SHA-512, lowercase hex) per docs.easebuzz.in:
 * - request:  key|txnid|amount|productinfo|firstname|email|udf1|…|udf10|salt
 * - response: salt|status|udf10|…|udf1|email|firstname|productinfo|amount|txnid|key
 * - refund:   key|merchant_refund_id|easebuzz_id|refund_amount|salt
 * - retrieve: key|txnid|salt
 */

/** Which Khatario flow a txnid belongs to. Encoded as the txnid prefix. */
export type EasebuzzTxnContext = 'SO' | 'ST' | 'PB';

const EASEBUZZ_TXN_PREFIXES: readonly EasebuzzTxnContext[] = ['SO', 'ST', 'PB'];

export function sha512LowerHex(input: string): string {
  return createHash('sha512').update(input, 'utf8').digest('hex');
}

export type EasebuzzHashFields = {
  key: string;
  txnid: string;
  amount: string;
  productinfo: string;
  firstname: string;
  email: string;
  udf1?: string;
  udf2?: string;
  udf3?: string;
  udf4?: string;
  udf5?: string;
  udf6?: string;
  udf7?: string;
};

function udfList(f: EasebuzzHashFields): string[] {
  return [f.udf1, f.udf2, f.udf3, f.udf4, f.udf5, f.udf6, f.udf7, '', '', ''].map((v) => v ?? '');
}

export function easebuzzRequestHash(fields: EasebuzzHashFields, salt: string): string {
  return sha512LowerHex(
    [
      fields.key,
      fields.txnid,
      fields.amount,
      fields.productinfo,
      fields.firstname,
      fields.email,
      ...udfList(fields),
      salt,
    ].join('|'),
  );
}

export function easebuzzResponseHash(
  fields: EasebuzzHashFields & { status: string },
  salt: string,
): string {
  return sha512LowerHex(
    [
      salt,
      fields.status,
      ...udfList(fields).reverse(),
      fields.email,
      fields.firstname,
      fields.productinfo,
      fields.amount,
      fields.txnid,
      fields.key,
    ].join('|'),
  );
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

/** Easebuzz rejects most punctuation in these fields with a generic "invalid" error. */
function cleanText(value: string, max: number, fallback: string): string {
  const out = value.replace(/[^A-Za-z0-9 .,_-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return out || fallback;
}

function cleanName(value: string | undefined): string {
  const out = String(value ?? '').replace(/[^A-Za-z0-9 .]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60);
  return out || 'Customer';
}

function cleanEmail(value: string | undefined): string {
  const v = String(value ?? '').trim().slice(0, 120);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v) ? v : 'customer@example.com';
}

function cleanPhone(value: string | undefined): string {
  const d = String(value ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '9999999999';
}

export function buildEasebuzzTxnId(context: EasebuzzTxnContext, reference: string, now = Date.now()): string {
  const short = reference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  return `${context}-${short}-${now}`.slice(0, 40);
}

export function easebuzzMerchantRefundId(key: string): string {
  return key.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40);
}

export function easebuzzTxnContext(txnid: string): EasebuzzTxnContext | null {
  const prefix = txnid.slice(0, 3);
  for (const p of EASEBUZZ_TXN_PREFIXES) {
    if (prefix === `${p}-`) return p;
  }
  return null;
}

export function parseEasebuzzBody(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  const trimmed = raw.trim();
  if (!trimmed) return out;
  if (trimmed.startsWith('{')) {
    try {
      const j = JSON.parse(trimmed) as Record<string, unknown>;
      for (const [k, v] of Object.entries(j)) {
        if (v != null && typeof v !== 'object') out[k] = String(v);
      }
      return out;
    } catch {
      /* fall through to form parsing */
    }
  }
  new URLSearchParams(trimmed).forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function redactEasebuzzForLogs(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...obj };
  for (const k of Object.keys(out)) {
    if (/salt|secret|key|hash|token|password/i.test(k)) out[k] = '[redacted]';
  }
  return out;
}

export function mapEasebuzzStatus(statusLower: string): NonNullable<VerifyWebhookResult['status']> {
  switch (statusLower) {
    case 'success':
      return 'success';
    case 'failure':
    case 'failed':
    case 'usercancelled':
    case 'dropped':
    case 'bounced':
      return 'failed';
    default:
      return 'pending';
  }
}

/** Absolute URL Easebuzz posts the browser back to (both surl and furl). */
export function getEasebuzzReturnUrl(): string | undefined {
  const base =
    process.env.PUBLIC_PAYMENT_CALLBACK_URL?.trim() || process.env.NEXT_PUBLIC_APP_URL?.trim() || '';
  if (!base) return undefined;
  return `${base.replace(/\/$/, '')}/api/payments/return/easebuzz`;
}

export type EasebuzzRefundResult = { providerRefundId: string; status: 'processed' | 'pending' };

export type EasebuzzTransactionRecord = {
  status: NonNullable<VerifyWebhookResult['status']>;
  rawStatus: string;
  easepayid?: string;
  amount?: number;
};

export class EasebuzzPaymentProvider implements PaymentProvider {
  readonly id = 'easebuzz';

  private readonly merchantKey: string;
  private readonly merchantSalt: string;
  readonly environment: 'sandbox' | 'production';
  private readonly payBase: string;
  private readonly dashboardBase: string;

  constructor(config: PaymentProviderConfig = {}) {
    this.merchantKey = (config.clientId || config.appId || '').trim();
    this.merchantSalt = (config.clientSecret || config.secretKey || '').trim();
    this.environment = config.environment === 'production' ? 'production' : 'sandbox';
    const prod = this.environment === 'production';
    this.payBase = (config.baseUrl || (prod ? 'https://pay.easebuzz.in' : 'https://testpay.easebuzz.in')).replace(/\/$/, '');
    this.dashboardBase = prod ? 'https://dashboard.easebuzz.in' : 'https://testdashboard.easebuzz.in';
  }

  private ensureCredentials(): void {
    if (!this.merchantKey || !this.merchantSalt) {
      throw new Error(
        'EasebuzzPaymentProvider: configure Merchant Key and Salt in Payment providers settings (encrypted)',
      );
    }
  }

  supportsHostedPaymentLinks(): boolean {
    return Boolean(this.merchantKey && this.merchantSalt);
  }

  /**
   * Calls Initiate Payment and returns the hosted page URL (`/pay/<access_key>`).
   * `metadata.easebuzz_context` picks the txnid prefix (default `SO`, sales orders).
   */
  async createHostedPaymentLink(params: CreateUpiCollectParams): Promise<CreateUpiCollectResult> {
    this.ensureCredentials();

    if ((params.currency || 'INR').toUpperCase() !== 'INR') {
      throw new Error('Easebuzz: only INR is supported');
    }
    const amt = Number(params.amount);
    if (!Number.isFinite(amt) || amt < 1) {
      throw new Error('Easebuzz: minimum amount is ₹1.00');
    }

    const returnUrl = getEasebuzzReturnUrl();
    if (!returnUrl) {
      throw new Error('Easebuzz: set NEXT_PUBLIC_APP_URL so Easebuzz can return the customer');
    }

    const ctxRaw = params.metadata?.easebuzz_context;
    const context: EasebuzzTxnContext =
      ctxRaw === 'ST' || ctxRaw === 'PB' ? ctxRaw : 'SO';

    const fields: EasebuzzHashFields = {
      key: this.merchantKey,
      txnid: buildEasebuzzTxnId(context, params.orderId),
      amount: amt.toFixed(2),
      productinfo: cleanText(
        typeof params.metadata?.description === 'string' ? params.metadata.description : '',
        100,
        'Order payment',
      ),
      firstname: cleanName(params.customerName),
      email: cleanEmail(params.customerEmail),
      udf1: params.orderId,
      udf2: params.businessId,
    };
    const hash = easebuzzRequestHash(fields, this.merchantSalt);

    const form = new URLSearchParams();
    for (const [k, v] of Object.entries(fields)) form.set(k, v ?? '');
    form.set('phone', cleanPhone(params.customerPhone));
    form.set('surl', returnUrl);
    form.set('furl', returnUrl);
    form.set('hash', hash);

    const res = await fetch(`${this.payBase}/payment/initiateLink`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const accessKey = Number(json.status) === 1 && typeof json.data === 'string' ? json.data : '';
    if (!res.ok || !accessKey) {
      const reason =
        (typeof json.error_desc === 'string' && json.error_desc) ||
        (typeof json.data === 'string' && json.data) ||
        `HTTP ${res.status}`;
      throw new Error(`Easebuzz initiate payment failed: ${reason}`);
    }

    return {
      provider: this.id,
      providerPaymentId: fields.txnid,
      paymentSessionId: accessKey,
      paymentUrl: `${this.payBase}/pay/${accessKey}`,
      raw: { txnid: fields.txnid, order_id: fields.txnid, environment: this.environment },
    };
  }

  async createUpiCollect(params: CreateUpiCollectParams): Promise<CreateUpiCollectResult> {
    return this.createHostedPaymentLink(params);
  }

  async createVirtualAccount(_params: CreateVirtualAccountParams): Promise<CreateVirtualAccountResult> {
    this.ensureCredentials();
    return {
      provider: this.id,
      raw: { message: 'Virtual account creation is not implemented for Easebuzz.' },
    };
  }

  async verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult> {
    if (!this.merchantKey || !this.merchantSalt) {
      return { verified: false, reason: 'Missing Easebuzz merchant credentials' };
    }
    const raw =
      typeof params.rawBody === 'string'
        ? params.rawBody
        : Buffer.isBuffer(params.rawBody)
          ? params.rawBody.toString('utf8')
          : String(params.rawBody);

    const p = parseEasebuzzBody(raw);
    const receivedHash = p.hash || '';
    if (!receivedHash) {
      return { verified: false, reason: 'Missing Easebuzz hash' };
    }
    if ((p.key || '').trim() !== this.merchantKey) {
      return { verified: false, reason: 'Easebuzz key does not match this account' };
    }

    const statusRaw = p.status || '';
    const expected = easebuzzResponseHash(
      {
        status: statusRaw,
        key: this.merchantKey,
        txnid: p.txnid || '',
        amount: p.amount || '',
        productinfo: p.productinfo || '',
        firstname: p.firstname || '',
        email: p.email || '',
        udf1: p.udf1,
        udf2: p.udf2,
        udf3: p.udf3,
        udf4: p.udf4,
        udf5: p.udf5,
        udf6: p.udf6,
        udf7: p.udf7,
      },
      this.merchantSalt,
    );
    if (!safeEqualHex(expected, receivedHash)) {
      return {
        verified: false,
        reason: 'Invalid Easebuzz response hash',
        rawPayload: redactEasebuzzForLogs(p),
      };
    }

    const amountNum = Number.parseFloat(String(p.amount || '').replace(/,/g, ''));
    return {
      verified: true,
      eventType: 'easebuzz_transaction',
      providerPaymentId: (p.easepayid || '').trim() || undefined,
      providerOrderId: (p.txnid || '').trim() || undefined,
      orderReference: (p.udf1 || '').trim() || undefined,
      amount: Number.isFinite(amountNum) && amountNum >= 0 ? amountNum : undefined,
      currency: 'INR',
      status: mapEasebuzzStatus(statusRaw.trim().toLowerCase()),
      utr: (p.bank_ref_num || '').trim() || undefined,
      payerName: (p.firstname || '').trim() || undefined,
      rawPayload: redactEasebuzzForLogs(p),
    };
  }

  /**
   * Refund API v2. Easebuzz settles refunds later, so an accepted request is `pending`.
   * The returned `providerRefundId` is our merchant_refund_id, which Refund Status echoes too.
   */
  async refundPayment(args: {
    easebuzzId: string;
    amountPaise: number;
    merchantRefundId: string;
  }): Promise<EasebuzzRefundResult> {
    this.ensureCredentials();
    const refundAmount = (args.amountPaise / 100).toFixed(2);
    const merchantRefundId = easebuzzMerchantRefundId(args.merchantRefundId);
    const hash = sha512LowerHex(
      [this.merchantKey, merchantRefundId, args.easebuzzId, refundAmount, this.merchantSalt].join('|'),
    );
    const res = await fetch(`${this.dashboardBase}/transaction/v2/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        key: this.merchantKey,
        merchant_refund_id: merchantRefundId,
        easebuzz_id: args.easebuzzId,
        refund_amount: refundAmount,
        hash,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !(json.status === true || json.status === 1 || json.status === 'true')) {
      const reason =
        (typeof json.reason === 'string' && json.reason) ||
        (typeof json.error === 'string' && json.error) ||
        `HTTP ${res.status}`;
      throw new Error(`Easebuzz refund failed: ${reason}`);
    }
    return { providerRefundId: merchantRefundId, status: 'pending' };
  }

  /** Refund Status API, filtered to one merchant_refund_id. Null when Easebuzz has no such refund. */
  async fetchRefundStatus(
    easebuzzId: string,
    merchantRefundIdRaw: string,
  ): Promise<{ providerRefundId: string; status: 'processed' | 'pending' | 'failed'; amount?: number } | null> {
    this.ensureCredentials();
    const merchantRefundId = easebuzzMerchantRefundId(merchantRefundIdRaw);
    const hash = sha512LowerHex([this.merchantKey, easebuzzId, this.merchantSalt].join('|'));
    const res = await fetch(`${this.dashboardBase}/refund/v1/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        key: this.merchantKey,
        easebuzz_id: easebuzzId,
        merchant_refund_id: merchantRefundId,
        hash,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok || !(json.status === true || json.status === 1)) return null;
    const refunds = Array.isArray(json.refunds) ? (json.refunds as Record<string, unknown>[]) : [];
    const match = refunds.find((r) => r.merchant_refund_id === merchantRefundId);
    if (!match) return null;
    const s = String(match.refund_status ?? '').toLowerCase();
    const amount = Number.parseFloat(String(match.refund_amount ?? ''));
    return {
      providerRefundId: merchantRefundId,
      status: s === 'refunded' ? 'processed' : s === 'failed' || s === 'cancelled' ? 'failed' : 'pending',
      amount: Number.isFinite(amount) ? amount : undefined,
    };
  }

  /** Transaction API v2.1, for reconciling payments the customer abandoned mid-redirect. */
  async fetchTransaction(txnid: string): Promise<EasebuzzTransactionRecord | null> {
    this.ensureCredentials();
    const hash = sha512LowerHex([this.merchantKey, txnid, this.merchantSalt].join('|'));
    const res = await fetch(`${this.dashboardBase}/transaction/v2.1/retrieve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ key: this.merchantKey, txnid, hash }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const list = Array.isArray(json.msg) ? (json.msg as Record<string, unknown>[]) : [];
    const rec = list[0];
    if (!res.ok || !rec) return null;
    const rawStatus = String(rec.status ?? '').toLowerCase();
    const amount = Number.parseFloat(String(rec.amount ?? ''));
    return {
      status: mapEasebuzzStatus(rawStatus),
      rawStatus,
      easepayid: typeof rec.easepayid === 'string' ? rec.easepayid : undefined,
      amount: Number.isFinite(amount) ? amount : undefined,
    };
  }
}
