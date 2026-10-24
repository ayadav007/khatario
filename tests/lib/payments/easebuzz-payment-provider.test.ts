import { createHash } from 'crypto';
import {
  EasebuzzPaymentProvider,
  buildEasebuzzTxnId,
  easebuzzRequestHash,
  easebuzzResponseHash,
  easebuzzTxnContext,
  mapEasebuzzStatus,
  redactEasebuzzForLogs,
} from '@/lib/payments/providers/easebuzz-payment-provider';

const KEY = 'TESTKEY123';
const SALT = 'TESTSALT456';

function sha512(s: string) {
  return createHash('sha512').update(s, 'utf8').digest('hex');
}

function signedCallback(overrides: Record<string, string> = {}) {
  const fields: Record<string, string> = {
    key: KEY,
    txnid: 'SO-abc123-1700000000000',
    amount: '150.00',
    productinfo: 'Order payment',
    firstname: 'Ravi',
    email: 'ravi@example.com',
    udf1: '11111111-1111-4111-8111-111111111111',
    udf2: '22222222-2222-4222-8222-222222222222',
    status: 'success',
    easepayid: 'E2409040A97T7L',
    bank_ref_num: 'UTR123',
    ...overrides,
  };
  fields.hash = sha512(
    [
      SALT,
      fields.status,
      '', '', '', '', '', '', '', '',
      fields.udf2,
      fields.udf1,
      fields.email,
      fields.firstname,
      fields.productinfo,
      fields.amount,
      fields.txnid,
      fields.key,
    ].join('|'),
  );
  return fields;
}

describe('Easebuzz hashes', () => {
  it('request hash matches the documented sequence with empty udf3..udf10', () => {
    const hash = easebuzzRequestHash(
      {
        key: KEY,
        txnid: 'T1',
        amount: '10.00',
        productinfo: 'P',
        firstname: 'F',
        email: 'e@x.in',
        udf1: 'a',
        udf2: 'b',
      },
      SALT,
    );
    expect(hash).toBe(sha512(`${KEY}|T1|10.00|P|F|e@x.in|a|b|||||||||${SALT}`));
  });

  it('response hash reverses the sequence', () => {
    const hash = easebuzzResponseHash(
      {
        status: 'success',
        key: KEY,
        txnid: 'T1',
        amount: '10.00',
        productinfo: 'P',
        firstname: 'F',
        email: 'e@x.in',
        udf1: 'a',
        udf2: 'b',
      },
      SALT,
    );
    expect(hash).toBe(sha512(`${SALT}|success|||||||||b|a|e@x.in|F|P|10.00|T1|${KEY}`));
  });
});

describe('EasebuzzPaymentProvider.verifyWebhook', () => {
  const provider = new EasebuzzPaymentProvider({ clientId: KEY, clientSecret: SALT });

  it('accepts a correctly signed form callback and normalises fields', async () => {
    const body = new URLSearchParams(signedCallback()).toString();
    const res = await provider.verifyWebhook({ rawBody: body, headers: {} });
    expect(res.verified).toBe(true);
    expect(res.status).toBe('success');
    expect(res.providerPaymentId).toBe('E2409040A97T7L');
    expect(res.providerOrderId).toBe('SO-abc123-1700000000000');
    expect(res.orderReference).toBe('11111111-1111-4111-8111-111111111111');
    expect(res.amount).toBe(150);
    expect(res.utr).toBe('UTR123');
  });

  it('accepts a JSON body', async () => {
    const res = await provider.verifyWebhook({ rawBody: JSON.stringify(signedCallback()), headers: {} });
    expect(res.verified).toBe(true);
  });

  it('rejects a tampered amount', async () => {
    const f = signedCallback();
    f.amount = '1.00';
    const res = await provider.verifyWebhook({ rawBody: new URLSearchParams(f).toString(), headers: {} });
    expect(res.verified).toBe(false);
  });

  it('rejects a callback for another merchant key', async () => {
    const res = await provider.verifyWebhook({
      rawBody: new URLSearchParams(signedCallback({ key: 'OTHERKEY' })).toString(),
      headers: {},
    });
    expect(res.verified).toBe(false);
  });

  it('rejects a missing hash', async () => {
    const f = signedCallback();
    delete f.hash;
    const res = await provider.verifyWebhook({ rawBody: new URLSearchParams(f).toString(), headers: {} });
    expect(res.verified).toBe(false);
  });

  it('fails closed without credentials', async () => {
    const res = await new EasebuzzPaymentProvider({}).verifyWebhook({
      rawBody: new URLSearchParams(signedCallback()).toString(),
      headers: {},
    });
    expect(res.verified).toBe(false);
  });

  it('never returns the hash in the normalised payload', async () => {
    const res = await provider.verifyWebhook({
      rawBody: new URLSearchParams(signedCallback()).toString(),
      headers: {},
    });
    expect(JSON.stringify(res.rawPayload)).not.toContain(signedCallback().hash);
  });
});

describe('Easebuzz helpers', () => {
  it('maps statuses', () => {
    expect(mapEasebuzzStatus('success')).toBe('success');
    expect(mapEasebuzzStatus('failure')).toBe('failed');
    expect(mapEasebuzzStatus('usercancelled')).toBe('failed');
    expect(mapEasebuzzStatus('dropped')).toBe('failed');
    expect(mapEasebuzzStatus('initiated')).toBe('pending');
  });

  it('builds txnids up to 40 chars with a readable context prefix', () => {
    const id = buildEasebuzzTxnId('PB', '33333333-3333-4333-8333-333333333333', 1700000000000);
    expect(id.length).toBeLessThanOrEqual(40);
    expect(easebuzzTxnContext(id)).toBe('PB');
    expect(easebuzzTxnContext('XX-1')).toBeNull();
  });

  it('redacts salt, key and hash fields', () => {
    const out = redactEasebuzzForLogs({ key: KEY, salt: SALT, hash: 'h', txnid: 't' });
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(JSON.stringify(out)).not.toContain(SALT);
    expect(out.txnid).toBe('t');
  });
});

describe('EasebuzzPaymentProvider.createHostedPaymentLink', () => {
  const realFetch = global.fetch;
  const realUrl = process.env.NEXT_PUBLIC_APP_URL;

  beforeEach(() => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.khatario.com';
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env.NEXT_PUBLIC_APP_URL = realUrl;
  });

  it('posts a signed form and returns the hosted page URL', async () => {
    const calls: { url: string; body: string }[] = [];
    global.fetch = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: String(init?.body) });
      return new Response(JSON.stringify({ status: 1, data: 'ACCESSKEY1' }), { status: 200 });
    }) as typeof fetch;

    const provider = new EasebuzzPaymentProvider({ clientId: KEY, clientSecret: SALT });
    const res = await provider.createHostedPaymentLink({
      businessId: 'biz-1',
      orderId: '44444444-4444-4444-8444-444444444444',
      amount: 99,
      customerName: 'Ravi — Kumar',
      customerPhone: '+91 98765 43210',
      metadata: { description: 'Store order #12 — test', easebuzz_context: 'ST' },
    });

    expect(calls[0].url).toBe('https://testpay.easebuzz.in/payment/initiateLink');
    const form = new URLSearchParams(calls[0].body);
    expect(form.get('surl')).toBe('https://staging.khatario.com/api/payments/return/easebuzz');
    expect(form.get('phone')).toBe('9876543210');
    expect(form.get('amount')).toBe('99.00');
    expect(form.get('txnid')!.startsWith('ST-')).toBe(true);
    expect(form.get('productinfo')).not.toMatch(/[#—]/);
    expect(form.get('hash')).toBe(
      easebuzzRequestHash(
        {
          key: KEY,
          txnid: form.get('txnid')!,
          amount: '99.00',
          productinfo: form.get('productinfo')!,
          firstname: form.get('firstname')!,
          email: form.get('email')!,
          udf1: form.get('udf1')!,
          udf2: form.get('udf2')!,
        },
        SALT,
      ),
    );
    expect(res.paymentUrl).toBe('https://testpay.easebuzz.in/pay/ACCESSKEY1');
    expect(res.providerPaymentId).toBe(form.get('txnid'));
    expect(JSON.stringify(res)).not.toContain(SALT);
  });

  it('surfaces Easebuzz error text', async () => {
    global.fetch = jest.fn(async () =>
      new Response(JSON.stringify({ status: 0, error_desc: 'Invalid email' }), { status: 200 }),
    ) as typeof fetch;
    const provider = new EasebuzzPaymentProvider({ clientId: KEY, clientSecret: SALT });
    await expect(
      provider.createHostedPaymentLink({ businessId: 'b', orderId: 'o', amount: 10 }),
    ).rejects.toThrow('Invalid email');
  });
});
