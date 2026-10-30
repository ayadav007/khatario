import { createHmac } from 'crypto';
import { PREVIEW_TTL, signThemePreview, verifyThemePreview } from '@/lib/store/engine/preview-token';

const BIZ = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const THEME = '33333333-3333-4333-8333-333333333333';

describe('theme preview token', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  it('round trips to the theme id', () => {
    const t = signThemePreview(BIZ, THEME, PREVIEW_TTL.editor);
    expect(verifyThemePreview(t, BIZ)).toBe(THEME);
  });

  it('rejects another business', () => {
    expect(verifyThemePreview(signThemePreview(BIZ, THEME, PREVIEW_TTL.share), OTHER)).toBeNull();
  });

  it('rejects an expired token', () => {
    const t = signThemePreview(BIZ, THEME, 1000, 1_000_000);
    expect(verifyThemePreview(t, BIZ, 1_000_999)).toBe(THEME);
    expect(verifyThemePreview(t, BIZ, 1_001_001)).toBeNull();
  });

  it('rejects a tampered body or signature', () => {
    const [body, sig] = signThemePreview(BIZ, THEME, PREVIEW_TTL.editor).split('.');
    const forged = Buffer.from(JSON.stringify({ b: BIZ, t: OTHER, exp: Date.now() + 1e9 })).toString('base64url');
    expect(verifyThemePreview(`${forged}.${sig}`, BIZ)).toBeNull();
    expect(verifyThemePreview(`${body}.${sig.slice(0, -2)}AA`, BIZ)).toBeNull();
  });

  it('rejects a token whose MAC was computed without the purpose prefix', () => {
    const body = Buffer.from(JSON.stringify({ b: BIZ, t: THEME, exp: Date.now() + 1e9 })).toString('base64url');
    const bare = createHmac('sha256', 'unit-test-secret').update(body).digest('base64url');
    expect(verifyThemePreview(`${body}.${bare}`, BIZ)).toBeNull();
  });

  it('rejects garbage', () => {
    for (const g of [null, undefined, '', 'abc', 'a.b', 'a.b.c', '.']) expect(verifyThemePreview(g, BIZ)).toBeNull();
  });
});
