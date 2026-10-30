import { createHmac, timingSafeEqual } from 'crypto';

export const PREVIEW_TTL = { editor: 2 * 3600_000, share: 7 * 24 * 3600_000 } as const;

function secret(): string {
  const key = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('JWT_SECRET is required for theme previews');
  return key;
}

function mac(body: string): string {
  return createHmac('sha256', secret()).update(`store-theme-preview:${body}`).digest('base64url');
}

/** `base64url(json).base64url(hmac)`; the payload binds the token to one business and one theme. */
export function signThemePreview(businessId: string, themeId: string, ttlMs: number, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ b: businessId, t: themeId, exp: now + ttlMs })).toString('base64url');
  return `${body}.${mac(body)}`;
}

/** Returns the theme id when the token is genuine, unexpired and issued for this business. */
export function verifyThemePreview(token: string | null | undefined, businessId: string, now = Date.now()): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = Buffer.from(mac(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as { b?: unknown; t?: unknown; exp?: unknown };
    if (p.b !== businessId || typeof p.t !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
    return p.t;
  } catch {
    return null;
  }
}
