import { isQaTestPhone } from '@/lib/qa-test-phones';
import { otpDebugAllowedFor } from '@/lib/platform-public-otp-core';

describe('isQaTestPhone', () => {
  const staging = { NEXT_PUBLIC_APP_URL: 'https://staging.khatario.com', QA_TEST_PHONES: '9000011001, +91 90000 11002' };

  it('matches listed phones in any format, including WhatsApp ids', () => {
    expect(isQaTestPhone('9000011001', staging)).toBe(true);
    expect(isQaTestPhone('+919000011002', staging)).toBe(true);
    expect(isQaTestPhone('919000011001@s.whatsapp.net', staging)).toBe(true);
    expect(isQaTestPhone('919000011001:12@s.whatsapp.net', staging)).toBe(true);
    expect(isQaTestPhone('9876543210', staging)).toBe(false);
  });

  it('ignores groups, linked-device ids and short numbers', () => {
    expect(isQaTestPhone('919000011001@g.us', staging)).toBe(false);
    expect(isQaTestPhone('919000011001@lid', staging)).toBe(false);
    expect(isQaTestPhone('11001', staging)).toBe(false);
  });

  it('does not accept "*"', () => {
    expect(isQaTestPhone('9876543210', { ...staging, QA_TEST_PHONES: '*' })).toBe(false);
  });

  it('is never on for the production host', () => {
    for (const url of ['https://khatario.com', 'https://www.khatario.com', 'https://app.khatario.com']) {
      expect(isQaTestPhone('9000011001', { ...staging, NEXT_PUBLIC_APP_URL: url, SIGNUP_DEBUG: 'true' })).toBe(false);
    }
  });

  it('needs SIGNUP_DEBUG outside staging', () => {
    const local = { NEXT_PUBLIC_APP_URL: 'http://localhost:3000', QA_TEST_PHONES: '9000011001' };
    expect(isQaTestPhone('9000011001', local)).toBe(false);
    expect(isQaTestPhone('9000011001', { ...local, SIGNUP_DEBUG: 'true' })).toBe(true);
  });

  it('also shows the signup OTP for test phones', () => {
    expect(otpDebugAllowedFor('9000011001', staging)).toBe(true);
    expect(otpDebugAllowedFor('9876543210', staging)).toBe(false);
  });
});

describe('WhatsApp sends to QA test phones', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
    jest.resetModules();
  });

  it('Cloud API text and template sends never call Graph', async () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://staging.khatario.com';
    process.env.QA_TEST_PHONES = '9000011001';
    jest.doMock('@/lib/meta-whatsapp-credentials', () => ({
      getMetaWaConfig: jest.fn(async () => ({ phoneNumberId: 'pn', accessToken: 'tok' })),
      isMetaWaConfigured: jest.fn(),
    }));
    const fetchSpy = jest.fn();
    (global as any).fetch = fetchSpy;
    const wa = await import('@/lib/meta-whatsapp');
    const text = await wa.sendTextMessage({ to: '+919000011001', body: 'hi' });
    const tpl = await wa.sendTemplateMessage({ to: '919000011001', name: 'signup_otp', language: 'en' });
    const btn = await wa.sendInteractiveButtons({
      to: '9000011001',
      body: 'pick',
      buttons: [{ id: 'a', title: 'A' }],
    } as any);
    expect(text.messageId).toMatch(/^qa-suppressed-/);
    expect(tpl.messageId).toMatch(/^qa-suppressed-/);
    expect(btn.messageId).toMatch(/^qa-suppressed-/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
