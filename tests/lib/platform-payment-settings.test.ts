let row: Record<string, string | null> | null = null;
const writes: unknown[][] = [];

jest.mock('@/lib/db', () => ({
  queryOne: jest.fn(async (sql: string) => {
    if (sql.includes('information_schema')) return { ok: 1 };
    return row;
  }),
  query: jest.fn(async (_sql: string, params: (string | null)[]) => {
    writes.push(params);
    row = {
      platform_payment_provider: params[0],
      platform_razorpay_key_id: params[1],
      encrypted_platform_razorpay_key_secret: params[2],
      encrypted_platform_razorpay_webhook_secret: params[3],
      platform_easebuzz_key: params[4],
      encrypted_platform_easebuzz_salt: params[5],
      platform_easebuzz_environment: params[6],
    };
    return undefined;
  }),
}));

import {
  loadPlatformPaymentSecrets,
  PlatformPaymentSettingsError,
  savePlatformPaymentSettings,
  toPublicPlatformPaymentSettings,
} from '@/lib/platform-payment-settings';

const ENV_KEYS = [
  'PLATFORM_PAYMENT_PROVIDER',
  'PLATFORM_RAZORPAY_KEY_ID',
  'PLATFORM_RAZORPAY_KEY_SECRET',
  'PLATFORM_RAZORPAY_WEBHOOK_SECRET',
  'RAZORPAY_KEY_ID',
  'RAZORPAY_KEY_SECRET',
  'RAZORPAY_WEBHOOK_SECRET',
  'PLATFORM_EASEBUZZ_KEY',
  'PLATFORM_EASEBUZZ_SALT',
  'PLATFORM_EASEBUZZ_ENV',
];
const saved = { ...process.env };

beforeEach(() => {
  row = null;
  writes.length = 0;
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.SECRETS_ENCRYPTION_KEY = 'a'.repeat(64);
});

afterAll(() => {
  process.env = saved;
});

describe('platform payment settings', () => {
  it('falls back to env when nothing is saved', async () => {
    process.env.PLATFORM_RAZORPAY_KEY_ID = 'rzp_test_env';
    process.env.PLATFORM_RAZORPAY_KEY_SECRET = 'envsecret';
    process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET = 'envhook';
    const s = await loadPlatformPaymentSecrets();
    expect(s.activeProvider).toBe('razorpay');
    expect(s.activeSource).toBe('default');
    expect(s.razorpay).toMatchObject({ keyId: 'rzp_test_env', keySecret: 'envsecret', source: 'env' });
    expect(s.easebuzz.source).toBe('none');
  });

  it('saves Easebuzz encrypted, switches the active gateway and overrides env', async () => {
    process.env.PLATFORM_PAYMENT_PROVIDER = 'razorpay';
    const pub = await savePlatformPaymentSettings({
      active_provider: 'easebuzz',
      easebuzz: { key: 'EBKEY12345', salt: 'EBSALT999', environment: 'sandbox' },
    });
    expect(pub.active_provider).toBe('easebuzz');
    expect(pub.easebuzz).toMatchObject({ ready: true, has_salt: true, source: 'saved', environment: 'sandbox' });
    expect(row?.encrypted_platform_easebuzz_salt).toBeTruthy();
    expect(row?.encrypted_platform_easebuzz_salt).not.toContain('EBSALT999');

    const s = await loadPlatformPaymentSecrets();
    expect(s.activeProvider).toBe('easebuzz');
    expect(s.activeSource).toBe('saved');
    expect(s.easebuzz).toMatchObject({ key: 'EBKEY12345', salt: 'EBSALT999' });
  });

  it('keeps saved secrets when fields are left blank and can switch back to Razorpay', async () => {
    await savePlatformPaymentSettings({
      active_provider: 'easebuzz',
      easebuzz: { key: 'EBKEY12345', salt: 'EBSALT999' },
      razorpay: { key_id: 'rzp_live_abc', key_secret: 'rsecret', webhook_secret: 'rhook' },
    });
    const pub = await savePlatformPaymentSettings({
      active_provider: 'razorpay',
      razorpay: { key_id: '', key_secret: '', webhook_secret: '' },
      easebuzz: { key: '', salt: '' },
    });
    expect(pub.active_provider).toBe('razorpay');
    expect(pub.razorpay).toMatchObject({ key_id: 'rzp_live_abc', mode: 'live', ready: true });
    const s = await loadPlatformPaymentSecrets();
    expect(s.easebuzz.salt).toBe('EBSALT999');
    expect(s.razorpay.keySecret).toBe('rsecret');
  });

  it('refuses to activate a gateway that cannot take payments', async () => {
    await expect(
      savePlatformPaymentSettings({ active_provider: 'easebuzz', easebuzz: { key: 'ONLYKEY' } }),
    ).rejects.toThrow(/Easebuzz is missing: Salt/);
    expect(writes).toHaveLength(0);
  });

  it('rejects unknown providers and malformed Razorpay key ids', async () => {
    await expect(savePlatformPaymentSettings({ active_provider: 'stripe' })).rejects.toBeInstanceOf(
      PlatformPaymentSettingsError,
    );
    await expect(
      savePlatformPaymentSettings({
        active_provider: 'razorpay',
        razorpay: { key_id: 'not-a-key', key_secret: 'x', webhook_secret: 'y' },
      }),
    ).rejects.toThrow(/rzp_test_/);
  });

  it('never exposes secrets in the public view', async () => {
    await savePlatformPaymentSettings({
      active_provider: 'easebuzz',
      easebuzz: { key: 'EBKEY12345', salt: 'EBSALT999' },
      razorpay: { key_id: 'rzp_test_abc', key_secret: 'rsecret', webhook_secret: 'rhook' },
    });
    const json = JSON.stringify(toPublicPlatformPaymentSettings(await loadPlatformPaymentSecrets()));
    for (const secret of ['EBSALT999', 'EBKEY12345', 'rsecret', 'rhook']) {
      expect(json).not.toContain(secret);
    }
    expect(json).toContain('/api/webhooks/platform-billing/easebuzz');
  });
});
