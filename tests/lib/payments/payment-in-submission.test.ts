import {
  PAYMENT_IDEMPOTENCY_HEADER,
  createPaymentSubmissionKeys,
  generateIdempotencyKey,
  paymentInFingerprint,
  submitPaymentIn,
  type PaymentInRequestBody,
} from '@/lib/payments/payment-in-submission';

function body(overrides: Partial<PaymentInRequestBody> = {}): PaymentInRequestBody {
  return {
    business_id: 'biz-1',
    type: 'receivable',
    customer_id: 'cust-1',
    reference_type: 'invoice',
    created_by: 'user-1',
    reference_id: 'inv-1',
    amount: 500,
    payment_mode: 'cash',
    payment_date: '2026-09-20',
    notes: null,
    tds_amount: 0,
    tds_section: null,
    ...overrides,
  };
}

function sequentialKeys() {
  let n = 0;
  return () => `key-${++n}`;
}

function response(status: number, json: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => json };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const headerOf = (init: RequestInit) => (init.headers as Record<string, string>)[PAYMENT_IDEMPOTENCY_HEADER];

describe('Payment In idempotency key lifecycle', () => {
  test('sends X-Idempotency-Key with the unchanged JSON body', async () => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest.fn(async (_init: RequestInit) => response(201, { payment: { id: 'p1' } }));

    const attempt = await submitPaymentIn(keys, body(), send);

    expect(attempt.kind).toBe('success');
    const init = send.mock.calls[0][0];
    expect(init.method).toBe('POST');
    expect(headerOf(init)).toBe('key-1');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual(body());
  });

  test('a double-click sends once with one key', async () => {
    const generate = jest.fn(sequentialKeys());
    const keys = createPaymentSubmissionKeys(generate);
    const pending = deferred<ReturnType<typeof response>>();
    const send = jest.fn((_init: RequestInit) => pending.promise);

    const first = submitPaymentIn(keys, body(), send);
    const second = await submitPaymentIn(keys, body(), send);
    expect(second.kind).toBe('ignored');
    expect(keys.inFlight).toBe(true);

    pending.resolve(response(201, { payment: { id: 'p1' } }));
    expect((await first).kind).toBe('success');
    expect(send).toHaveBeenCalledTimes(1);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  test('retry after a network failure reuses the same key', async () => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest
      .fn<Promise<ReturnType<typeof response>>, [RequestInit]>()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(response(201, { payment: { id: 'p1' } }));

    expect((await submitPaymentIn(keys, body(), send)).kind).toBe('network-error');
    expect((await submitPaymentIn(keys, body(), send)).kind).toBe('success');
    expect(headerOf(send.mock.calls[0][0])).toBe('key-1');
    expect(headerOf(send.mock.calls[1][0])).toBe('key-1');
  });

  test.each([
    ['server error', 500, { error: 'Internal error' }],
    ['gateway timeout', 504, null],
    ['validation error', 400, { error: 'Period locked', code: 'PERIOD_LOCKED' }],
    ['unreplayable record', 409, { error: 'x', code: 'IDEMPOTENCY_REPLAY_UNAVAILABLE' }],
  ])('retry after an uncertain %s reuses the same key', async (_label, status, json) => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest
      .fn<Promise<ReturnType<typeof response>>, [RequestInit]>()
      .mockResolvedValueOnce(response(status, json))
      .mockResolvedValueOnce(response(201, { payment: { id: 'p1' } }));

    const failed = await submitPaymentIn(keys, body(), send);
    expect(failed).toMatchObject({ kind: 'failed', status });
    await submitPaymentIn(keys, body(), send);
    expect(headerOf(send.mock.calls[1][0])).toBe(headerOf(send.mock.calls[0][0]));
  });

  test('an unreadable response body is treated as uncertain and keeps the key', async () => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest.fn(async (_init: RequestInit) => ({
      ok: false,
      status: 502,
      json: async () => {
        throw new SyntaxError('Unexpected token <');
      },
    }));

    expect(await submitPaymentIn(keys, body(), send)).toEqual({ kind: 'failed', status: 502, body: null });
    expect(keys.keyFor(paymentInFingerprint(body()))).toBe('key-1');
  });

  test('a new payment after success gets a new key', async () => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest.fn(async (_init: RequestInit) => response(201, { payment: { id: 'p' } }));

    await submitPaymentIn(keys, body(), send);
    await submitPaymentIn(keys, body(), send);
    expect(headerOf(send.mock.calls[0][0])).toBe('key-1');
    expect(headerOf(send.mock.calls[1][0])).toBe('key-2');
  });

  test.each<[string, Partial<PaymentInRequestBody>]>([
    ['amount', { amount: 600 }],
    ['customer', { customer_id: 'cust-2' }],
    ['invoice', { reference_id: 'inv-2' }],
    ['payment mode', { payment_mode: 'upi' }],
    ['payment date', { payment_date: '2026-09-21' }],
    ['notes', { notes: 'cheque 123' }],
    ['tds', { tds_amount: 10, tds_section: '194C' }],
  ])('changing the %s after a failure uses a new key', async (_label, change) => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest.fn(async (_init: RequestInit) => response(500, { error: 'boom' }));

    await submitPaymentIn(keys, body(), send);
    await submitPaymentIn(keys, body(change), send);
    expect(headerOf(send.mock.calls[0][0])).toBe('key-1');
    expect(headerOf(send.mock.calls[1][0])).toBe('key-2');
  });

  test('identity-only fields do not change the key', () => {
    expect(paymentInFingerprint(body({ business_id: 'other', created_by: 'other' }))).toBe(
      paymentInFingerprint(body())
    );
  });

  test('changing details and then reverting reuses the original unresolved key', async () => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest.fn(async (_init: RequestInit) => response(500, { error: 'boom' }));

    await submitPaymentIn(keys, body(), send);
    await submitPaymentIn(keys, body({ amount: 600 }), send);
    await submitPaymentIn(keys, body(), send);
    expect(send.mock.calls.map((c) => headerOf(c[0]))).toEqual(['key-1', 'key-2', 'key-1']);
  });

  test('IDEMPOTENCY_KEY_REUSED discards that key so the next attempt gets a fresh one', async () => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest
      .fn<Promise<ReturnType<typeof response>>, [RequestInit]>()
      .mockResolvedValueOnce(response(409, { error: 'reused', code: 'IDEMPOTENCY_KEY_REUSED' }))
      .mockResolvedValueOnce(response(201, { payment: { id: 'p1' } }));

    await submitPaymentIn(keys, body(), send);
    await submitPaymentIn(keys, body(), send);
    expect(send.mock.calls.map((c) => headerOf(c[0]))).toEqual(['key-1', 'key-2']);
  });

  test('reset (cancel / reopen form) starts a new logical submission', async () => {
    const keys = createPaymentSubmissionKeys(sequentialKeys());
    const send = jest.fn(async (_init: RequestInit) => response(500, { error: 'boom' }));

    await submitPaymentIn(keys, body(), send);
    keys.reset();
    await submitPaymentIn(keys, body(), send);
    expect(send.mock.calls.map((c) => headerOf(c[0]))).toEqual(['key-1', 'key-2']);
  });

  test('no key is generated until a submission begins', () => {
    const generate = jest.fn(sequentialKeys());
    const keys = createPaymentSubmissionKeys(generate);
    expect(generate).not.toHaveBeenCalled();
    expect(keys.keyFor(paymentInFingerprint(body()))).toBeUndefined();
  });

  test('default generator yields distinct header-safe keys', () => {
    const a = generateIdempotencyKey();
    const b = generateIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[\x21-\x7e]{1,200}$/);
  });
});
