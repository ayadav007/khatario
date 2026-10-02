/**
 * UPI pay links: the shop is the payee, values are encoded, and the public pay-page token can't be
 * forged or pointed at another order.
 */
jest.mock('@/lib/db', () => ({ queryOne: jest.fn() }));
jest.mock('@/lib/services/payment-transactions', () => ({
  getSuccessfulPaymentsSumForOrder: jest.fn(),
  remainingOrderAmountAfterSuccessSum: jest.fn(),
}));

import { buildUpiUri, createUpiPayToken, upiAppLinks, upiPayPageUrl, verifyUpiPayToken } from '@/lib/payments/upi-pay-link';

const ORDER = '3f2b8c1e-9a4d-4e6f-8b7a-1c2d3e4f5a6b';
const params = { vpa: 'shalini@okicici', payeeName: 'Shalini Traders', amount: 250, note: 'Order SO-0012', reference: 'SO/0012' };

beforeEach(() => {
  process.env.UPI_PAY_LINK_SECRET = 'test-secret-at-least-16-chars';
  process.env.NEXT_PUBLIC_APP_URL = 'https://staging.khatario.com/';
});

describe('buildUpiUri', () => {
  it('pays the shop, encodes values and adds a clean reference', () => {
    const uri = buildUpiUri(params);
    const q = new URLSearchParams(uri.replace('upi://pay?', ''));
    expect(uri.startsWith('upi://pay?')).toBe(true);
    expect(q.get('pa')).toBe('shalini@okicici');
    expect(q.get('pn')).toBe('Shalini Traders');
    expect(q.get('am')).toBe('250.00');
    expect(q.get('cu')).toBe('INR');
    expect(q.get('tn')).toBe('Order SO-0012');
    expect(q.get('tr')).toBe('SO0012');
    expect(uri).not.toContain('+');
  });

  it('builds Android intents per app and iOS app schemes', () => {
    const l = upiAppLinks(params);
    expect(l.android.gpay).toMatch(/^intent:\/\/pay\?.*#Intent;scheme=upi;package=com\.google\.android\.apps\.nbu\.paisa\.user;end$/);
    expect(l.android.phonepe).toContain('package=com.phonepe.app');
    expect(l.ios.gpay.startsWith('gpay://upi/pay?')).toBe(true);
    expect(l.ios.phonepe.startsWith('phonepe://pay?')).toBe(true);
  });
});

describe('pay page token', () => {
  it('round-trips and builds the https page URL', () => {
    const token = createUpiPayToken(ORDER)!;
    expect(verifyUpiPayToken(token)).toBe(ORDER);
    expect(upiPayPageUrl(ORDER)).toBe(`https://staging.khatario.com/pay/upi/${token}`);
  });

  it('rejects a tampered signature or a swapped order id', () => {
    const token = createUpiPayToken(ORDER)!;
    const [, sig] = token.split('.');
    const other = Buffer.from('aaaaaaaa-9a4d-4e6f-8b7a-1c2d3e4f5a6b').toString('base64url');
    expect(verifyUpiPayToken(`${other}.${sig}`)).toBeNull();
    expect(verifyUpiPayToken(`${token}x`)).toBeNull();
    expect(verifyUpiPayToken('garbage')).toBeNull();
  });

  it('rejects tokens signed with another secret and returns null without a secret', () => {
    const token = createUpiPayToken(ORDER)!;
    process.env.UPI_PAY_LINK_SECRET = 'a-different-secret-value';
    expect(verifyUpiPayToken(token)).toBeNull();
    delete process.env.UPI_PAY_LINK_SECRET;
    const jwt = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(createUpiPayToken(ORDER)).toBeNull();
    expect(upiPayPageUrl(ORDER)).toBeNull();
    if (jwt !== undefined) process.env.JWT_SECRET = jwt;
  });
});
