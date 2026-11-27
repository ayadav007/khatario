import { normaliseOwnAppUrl } from '@/lib/http/own-app-url';

const env = { NEXT_PUBLIC_APP_URL: 'https://app.test.khatario' } as unknown as NodeJS.ProcessEnv;

describe('normaliseOwnAppUrl', () => {
  it('accepts the configured app URL origin', () => {
    expect(normaliseOwnAppUrl('https://app.test.khatario/api/x.pdf', { env, nodeEnv: 'production' })).not.toBeNull();
  });
  it('accepts PUBLIC_PAYMENT_CALLBACK_URL origin', () => {
    const e = { PUBLIC_PAYMENT_CALLBACK_URL: 'https://pay.test.khatario/cb' } as unknown as NodeJS.ProcessEnv;
    expect(normaliseOwnAppUrl('https://pay.test.khatario/x', { env: e, nodeEnv: 'production' })).not.toBeNull();
  });
  it('refuses a different scheme or port on the same host', () => {
    expect(normaliseOwnAppUrl('http://app.test.khatario/x', { env, nodeEnv: 'production' })).toBeNull();
    expect(normaliseOwnAppUrl('https://app.test.khatario:8443/x', { env, nodeEnv: 'production' })).toBeNull();
  });
  it('refuses the userinfo trick', () => {
    expect(normaliseOwnAppUrl('https://app.test.khatario@evil.example/x', { env, nodeEnv: 'production' })).toBeNull();
  });
  it('returns the normalised href', () => {
    expect(normaliseOwnAppUrl('  HTTPS://App.test.khatario:443/a b'.replace(' b', '%20b'), { env, nodeEnv: 'production' })).toBe('https://app.test.khatario/a%20b');
  });
  it('refuses the backslash parser-differential form', () => {
    expect(normaliseOwnAppUrl('https://app.test.khatario\\@evil.example/x', { env, nodeEnv: 'production' })).toBeNull();
  });
  it('refuses embedded tab, newline and inner spaces but trims outer spaces', () => {
    expect(normaliseOwnAppUrl('https://app.test.khatario/a\tb', { env, nodeEnv: 'production' })).toBeNull();
    expect(normaliseOwnAppUrl('https://app.test.khatario/a\nb', { env, nodeEnv: 'production' })).toBeNull();
    expect(normaliseOwnAppUrl('https://app.test.khatario/a b', { env, nodeEnv: 'production' })).toBeNull();
    expect(normaliseOwnAppUrl('  https://app.test.khatario/x  ', { env, nodeEnv: 'production' })).toBe('https://app.test.khatario/x');
  });
  it('refuses userinfo on an otherwise own origin', () => {
    expect(normaliseOwnAppUrl('https://user:pw@app.test.khatario/x', { env, nodeEnv: 'production' })).toBeNull();
  });
  it('refuses non-strings and over-long values', () => {
    expect(normaliseOwnAppUrl(42, { env, nodeEnv: 'production' })).toBeNull();
    expect(normaliseOwnAppUrl('https://app.test.khatario/' + 'a'.repeat(2000), { env, nodeEnv: 'production' })).toBeNull();
  });
  it('refuses the request origin when nodeEnv is unset', () => {
    expect(normaliseOwnAppUrl('https://evil.example/x', { requestOrigin: 'https://evil.example', env: {} as NodeJS.ProcessEnv })).toBeNull();
  });
  it('refuses non-http(s), protocol-relative and relative values', () => {
    for (const u of ['javascript:alert(1)', '//app.test.khatario/x', '/x.pdf', '']) {
      expect(normaliseOwnAppUrl(u, { env, nodeEnv: 'production' })).toBeNull();
    }
  });
  it('accepts the request origin only in development or test', () => {
    const none = {} as NodeJS.ProcessEnv;
    const opts = { requestOrigin: 'https://evil.example', env: none };
    expect(normaliseOwnAppUrl('https://evil.example/x', { ...opts, nodeEnv: 'development' })).not.toBeNull();
    expect(normaliseOwnAppUrl('https://evil.example/x', { ...opts, nodeEnv: 'production' })).toBeNull();
  });
  it('refuses everything in production when no app URL is configured', () => {
    expect(normaliseOwnAppUrl('https://app.test.khatario/x', { env: {} as NodeJS.ProcessEnv, nodeEnv: 'production' })).toBeNull();
  });
});
