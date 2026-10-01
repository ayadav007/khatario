/**
 * Idempotency key lifecycle for the Payment In form.
 *
 * One key belongs to one logical submission, identified by the material request fields.
 * The key is kept until the server confirms the payment, because a failed or lost response
 * does not prove the server did not commit; retrying with the same key lets the server replay
 * instead of creating a duplicate. Changing the details produces a different fingerprint and
 * therefore a new key. Keys live only in memory.
 */

export const PAYMENT_IDEMPOTENCY_HEADER = 'X-Idempotency-Key';
const IDEMPOTENCY_KEY_REUSED = 'IDEMPOTENCY_KEY_REUSED';

export interface PaymentInRequestBody {
  business_id: string;
  type: 'receivable';
  customer_id: string | null;
  reference_type: 'invoice' | null;
  created_by: string | undefined;
  reference_id: string | null;
  amount: number;
  payment_mode: string;
  payment_date: string;
  notes: string | null;
  tds_amount: number;
  tds_section: string | null;
}

/** Fields that define "the same payment". Identity fields are excluded; the server ignores them. */
export function paymentInFingerprint(body: PaymentInRequestBody): string {
  return JSON.stringify([
    body.type,
    body.customer_id,
    body.reference_type,
    body.reference_id,
    body.amount,
    body.tds_amount,
    body.tds_section,
    body.payment_mode,
    body.payment_date,
    body.notes,
  ]);
}

export function generateIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (c?.randomUUID) return c.randomUUID();
  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * `committed`: server confirmed the payment, so every pending key is spent.
 * `key-rejected`: server says this key belongs to a different request, so this fingerprint gets a fresh key next time.
 * `uncertain`: anything else (HTTP error, network failure, unreadable response); keep the key for a retry.
 */
export type SubmissionResult = 'committed' | 'key-rejected' | 'uncertain';

export interface PaymentSubmissionKeys {
  /** Returns the key to send, or null when a submission is already in flight. */
  begin(fingerprint: string): string | null;
  finish(fingerprint: string, result: SubmissionResult): void;
  /** Forget all pending keys, e.g. when the form is closed or reopened for a new payment. */
  reset(): void;
  readonly inFlight: boolean;
  keyFor(fingerprint: string): string | undefined;
}

export function createPaymentSubmissionKeys(
  generate: () => string = generateIdempotencyKey
): PaymentSubmissionKeys {
  const pending = new Map<string, string>();
  let inFlight = false;

  return {
    begin(fingerprint) {
      if (inFlight) return null;
      inFlight = true;
      let key = pending.get(fingerprint);
      if (!key) {
        key = generate();
        pending.set(fingerprint, key);
      }
      return key;
    },
    finish(fingerprint, result) {
      inFlight = false;
      if (result === 'committed') pending.clear();
      else if (result === 'key-rejected') pending.delete(fingerprint);
    },
    reset() {
      pending.clear();
    },
    get inFlight() {
      return inFlight;
    },
    keyFor(fingerprint) {
      return pending.get(fingerprint);
    },
  };
}

export function buildPaymentInRequest(body: PaymentInRequestBody, idempotencyKey: string): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', [PAYMENT_IDEMPOTENCY_HEADER]: idempotencyKey },
    body: JSON.stringify(body),
  };
}

type ResponseLike = Pick<Response, 'ok' | 'status' | 'json'>;

export type PaymentInAttempt =
  | { kind: 'ignored' }
  | { kind: 'success'; body: unknown }
  | { kind: 'failed'; status: number; body: { error?: string; code?: string } | null }
  | { kind: 'network-error'; error: unknown };

export async function submitPaymentIn(
  keys: PaymentSubmissionKeys,
  body: PaymentInRequestBody,
  send: (init: RequestInit) => Promise<ResponseLike>
): Promise<PaymentInAttempt> {
  const fingerprint = paymentInFingerprint(body);
  const key = keys.begin(fingerprint);
  if (!key) return { kind: 'ignored' };

  let response: ResponseLike;
  try {
    response = await send(buildPaymentInRequest(body, key));
  } catch (error) {
    keys.finish(fingerprint, 'uncertain');
    return { kind: 'network-error', error };
  }

  const parsed = await response.json().catch(() => null);
  if (response.ok) {
    keys.finish(fingerprint, 'committed');
    return { kind: 'success', body: parsed };
  }
  keys.finish(fingerprint, parsed?.code === IDEMPOTENCY_KEY_REUSED ? 'key-rejected' : 'uncertain');
  return { kind: 'failed', status: response.status, body: parsed };
}
