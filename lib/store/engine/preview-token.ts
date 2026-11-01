import { createHmac, timingSafeEqual } from 'crypto';

/** Editor tokens and version previews live 2 hours; shared theme links 7 days (D47). */
export const PREVIEW_TTL = { editor: 2 * 3600_000, share: 7 * 24 * 3600_000, version: 2 * 3600_000 } as const;

// Each kind of token is MACed under its own domain prefix, so neither can ever verify as the other (D47).
const THEME_PREFIX = 'store-theme-preview:';
const VERSION_PREFIX = 'store-theme-version-preview:';

function secret(): string {
  const key = process.env.JWT_SECRET || process.env.NEXTAUTH_SECRET;
  if (!key) throw new Error('JWT_SECRET is required for theme previews');
  return key;
}

function mac(prefix: string, body: string): string {
  return createHmac('sha256', secret()).update(`${prefix}${body}`).digest('base64url');
}

function sign(prefix: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${mac(prefix, body)}`;
}

/** The id under `key` when the token is genuine for `prefix`, unexpired and issued for this business; otherwise null. */
function verify(
  prefix: string,
  key: 't' | 'v',
  token: string | null | undefined,
  businessId: string,
  now: number,
): string | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [body, sig] = parts;
  const expected = Buffer.from(mac(prefix, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
    const id = p[key];
    if (p.b !== businessId || typeof id !== 'string' || typeof p.exp !== 'number' || p.exp < now) return null;
    return id;
  } catch {
    return null;
  }
}

/** `base64url(json).base64url(hmac)`; the payload binds the token to one business and one theme. */
export function signThemePreview(businessId: string, themeId: string, ttlMs: number, now = Date.now()): string {
  return sign(THEME_PREFIX, { b: businessId, t: themeId, exp: now + ttlMs });
}

/** Returns the theme id when the token is genuine, unexpired and issued for this business. */
export function verifyThemePreview(token: string | null | undefined, businessId: string, now = Date.now()): string | null {
  return verify(THEME_PREFIX, 't', token, businessId, now);
}

/** D47: a read-only preview of one published version, bound to one business and one version. */
export function signVersionPreview(businessId: string, versionId: string, ttlMs: number, now = Date.now()): string {
  return sign(VERSION_PREFIX, { b: businessId, v: versionId, exp: now + ttlMs });
}

/** Returns the version id when the token is a genuine, unexpired version token for this business. */
export function verifyVersionPreview(token: string | null | undefined, businessId: string, now = Date.now()): string | null {
  return verify(VERSION_PREFIX, 'v', token, businessId, now);
}

/** Either kind of preview token, with the kind it was signed as; null when it is neither. Throws without a secret. */
export function verifyPreviewToken(
  token: string | null | undefined,
  businessId: string,
  now = Date.now(),
): { kind: 'theme' | 'version'; id: string } | null {
  const theme = verifyThemePreview(token, businessId, now);
  if (theme) return { kind: 'theme', id: theme };
  const version = verifyVersionPreview(token, businessId, now);
  return version ? { kind: 'version', id: version } : null;
}
