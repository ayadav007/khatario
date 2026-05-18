/**
 * Payment Service Provider (PSP) abstraction — UPI collect, virtual account, webhooks.
 * Implementations live under `lib/payments/providers/`.
 */

export type WebhookPaymentStatus = 'success' | 'failed' | 'pending';

export type CreateUpiCollectParams = {
  businessId: string;
  /** sales_orders.id or your internal order ref */
  orderId: string;
  amount: number;
  currency?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  returnUrl?: string;
  notifyUrl?: string;
  /** idempotency / extra routing */
  metadata?: Record<string, unknown>;
};

export type CreateUpiCollectResult = {
  provider: string;
  /** Provider-side order / payment id */
  providerPaymentId?: string;
  /** Session or intent id for hosted pay / JS SDK */
  paymentSessionId?: string;
  /** UPI deep link or app intent, if the PSP returns one */
  upiIntent?: string;
  /** Raw UPI payload for QR, if any */
  qrData?: string;
  /** Customer-facing pay URL (hosted) */
  paymentUrl?: string;
  expiresAt?: Date;
  raw?: Record<string, unknown>;
};

export type CreateVirtualAccountParams = {
  businessId: string;
  orderId: string;
  customerName?: string;
  customerReference?: string;
  metadata?: Record<string, unknown>;
};

export type CreateVirtualAccountResult = {
  provider: string;
  virtualAccountNumber?: string;
  ifsc?: string;
  beneficiaryName?: string;
  bankName?: string;
  /** Some PSPs return a session or VA id */
  referenceId?: string;
  expiresAt?: Date;
  raw?: Record<string, unknown>;
};

export type VerifyWebhookParams = {
  /** Raw request body (string for signature verification) */
  rawBody: string | Buffer;
  /** Normalized lower-case keys optional — providers compare case-insensitively as needed */
  headers: Record<string, string | string[] | undefined>;
  /** Webhook secret (or client secret) for HMAC / compare */
  webhookSecret?: string;
};

export type VerifyWebhookResult = {
  verified: boolean;
  eventType?: string;
  providerPaymentId?: string;
  /** Your order / reference id as echoed by the PSP (e.g. Khatario sales order id from notes) */
  orderReference?: string;
  /** PSP session / payment-link id (e.g. Razorpay `plink_*`) — matches stored `raw_payload.provider_order_id` */
  providerOrderId?: string;
  amount?: number;
  currency?: string;
  status?: WebhookPaymentStatus;
  utr?: string;
  payerName?: string;
  /** Normalized payload for `payment_transactions.raw_payload` */
  rawPayload?: Record<string, unknown>;
  reason?: string;
};

/**
 * Pluggable PSP contract. One instance per (provider + credentials) when stateful.
 */
export interface PaymentProvider {
  /** Stable id, e.g. `mock`, `cashfree`, `payu` */
  readonly id: string;

  createUpiCollect(params: CreateUpiCollectParams): Promise<CreateUpiCollectResult>;

  createVirtualAccount(params: CreateVirtualAccountParams): Promise<CreateVirtualAccountResult>;

  /**
   * Verify authenticity of an incoming webhook and parse normalized fields.
   * Implementations must not trust unverified bodies.
   */
  verifyWebhook(params: VerifyWebhookParams): Promise<VerifyWebhookResult>;

  /**
   * When true and {@link createHostedPaymentLink} is implemented, `/api/payments/upi-collect`
   * prefers hosted checkout (e.g. Razorpay Payment Links) instead of native UPI collect.
   */
  supportsHostedPaymentLinks?(): boolean;

  /** Hosted payment page / payment link (Razorpay `payment_links`, etc.). */
  createHostedPaymentLink?(params: CreateUpiCollectParams): Promise<CreateUpiCollectResult>;
}

export type PaymentProviderConfig = {
  appId?: string;
  clientId?: string;
  clientSecret?: string;
  secretKey?: string;
  webhookSecret?: string;
  environment?: 'sandbox' | 'production';
  /** Optional base URL override for private / proxy endpoints */
  baseUrl?: string;
};
