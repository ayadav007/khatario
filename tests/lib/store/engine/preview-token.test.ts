import { createHmac } from 'crypto';
import {
  PREVIEW_TTL,
  signThemePreview,
  signVersionPreview,
  verifyPreviewToken,
  verifyThemePreview,
  verifyVersionPreview,
} from '@/lib/store/engine/preview-token';

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
    const flip = (s: string, i: number) => `${s.slice(0, i)}${s[i] === 'A' ? 'B' : 'A'}${s.slice(i + 1)}`;
    expect(verifyThemePreview(`${body}.${flip(sig, sig.length >> 1)}`, BIZ)).toBeNull();
  });

  it('never verifies a token with its middle character flipped', () => {
    const flip = (s: string, i: number) => `${s.slice(0, i)}${s[i] === 'A' ? 'B' : 'A'}${s.slice(i + 1)}`;
    for (let i = 0; i < 200; i++) {
      const t = signThemePreview(BIZ, THEME, PREVIEW_TTL.share, Date.now() + i * 7919);
      expect(verifyThemePreview(t, BIZ)).toBe(THEME);
      expect(verifyThemePreview(flip(t, t.length >> 1), BIZ)).toBeNull();
    }
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

describe('version preview token (D47)', () => {
  const VERSION = '44444444-4444-4444-8444-444444444444';

  beforeAll(() => {
    process.env.JWT_SECRET = 'unit-test-secret';
  });

  it('has the fixed lifetimes', () => {
    expect(PREVIEW_TTL.version).toBe(2 * 3600_000);
    expect(PREVIEW_TTL.share).toBe(7 * 24 * 3600_000);
    expect(PREVIEW_TTL.editor).toBe(2 * 3600_000);
  });

  it('round trips to the version id for its business', () => {
    const t = signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version);
    expect(verifyVersionPreview(t, BIZ)).toBe(VERSION);
  });

  it('a version token is never a theme token, and a theme token never a version token', () => {
    const v = signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version);
    const t = signThemePreview(BIZ, THEME, PREVIEW_TTL.share);
    expect(verifyThemePreview(v, BIZ)).toBeNull();
    expect(verifyVersionPreview(t, BIZ)).toBeNull();
  });

  it('a theme payload under the version MAC, or a version payload under the theme MAC, does not verify', () => {
    const vBody = signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version).split('.')[0];
    const vAsTheme = Buffer.from(JSON.stringify({ b: BIZ, t: VERSION, exp: Date.now() + 1e9 })).toString('base64url');
    const vSig = signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version).split('.')[1];
    expect(verifyThemePreview(`${vBody}.${vSig}`, BIZ)).toBeNull();
    expect(verifyThemePreview(`${vAsTheme}.${vSig}`, BIZ)).toBeNull();
  });

  it('verifyPreviewToken names the kind', () => {
    expect(verifyPreviewToken(signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version), BIZ)).toEqual({ kind: 'version', id: VERSION });
    expect(verifyPreviewToken(signThemePreview(BIZ, THEME, PREVIEW_TTL.editor), BIZ)).toEqual({ kind: 'theme', id: THEME });
    expect(verifyPreviewToken('garbage', BIZ)).toBeNull();
    expect(verifyPreviewToken(null, BIZ)).toBeNull();
  });

  it('rejects another business', () => {
    const v = signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version);
    expect(verifyVersionPreview(v, OTHER)).toBeNull();
    expect(verifyPreviewToken(v, OTHER)).toBeNull();
  });

  it('expires at now + ttl + 1', () => {
    const now = 5_000_000;
    const v = signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version, now);
    expect(verifyVersionPreview(v, BIZ, now + PREVIEW_TTL.version)).toBe(VERSION);
    expect(verifyVersionPreview(v, BIZ, now + PREVIEW_TTL.version + 1)).toBeNull();
    expect(verifyPreviewToken(v, BIZ, now + PREVIEW_TTL.version + 1)).toBeNull();
  });

  it('rejects a tampered version token', () => {
    const [, sig] = signVersionPreview(BIZ, VERSION, PREVIEW_TTL.version).split('.');
    const forged = Buffer.from(JSON.stringify({ b: BIZ, v: THEME, exp: Date.now() + 1e9 })).toString('base64url');
    expect(verifyVersionPreview(`${forged}.${sig}`, BIZ)).toBeNull();
  });
});
