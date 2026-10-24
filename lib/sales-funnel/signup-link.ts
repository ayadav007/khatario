import { createHmac, timingSafeEqual } from 'crypto';

/** A signup link stays valid for 7 days; it is spent once the lead is linked to a business. */
export const SIGNUP_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type Payload = { l: string; p: string; e: number };

function secret(): string {
  const s = process.env.JWT_SECRET?.trim();
  if (!s) throw new Error('JWT_SECRET is not set');
  return `${s}:sales-funnel-signup`;
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64url');
}

function sign(body: string): string {
  return createHmac('sha256', secret()).update(body).digest('base64url');
}

export function createSignupToken(leadId: string, phone10: string, now = Date.now()): string {
  const body = b64url(JSON.stringify({ l: leadId, p: phone10, e: now + SIGNUP_LINK_TTL_MS } satisfies Payload));
  return `${body}.${sign(body)}`;
}

export function verifySignupToken(token: string | null | undefined, now = Date.now()): { leadId: string; phone10: string } | null {
  if (!token || typeof token !== 'string' || token.length > 600) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  let expected: string;
  try {
    expected = sign(body);
  } catch {
    return null;
  }
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    if (typeof p.l !== 'string' || typeof p.p !== 'string' || typeof p.e !== 'number') return null;
    if (p.e < now) return null;
    if (!/^[0-9a-f-]{36}$/i.test(p.l) || !/^\d{10,15}$/.test(p.p)) return null;
    return { leadId: p.l, phone10: p.p };
  } catch {
    return null;
  }
}

export function signupLinkUrl(base: string, token: string): string {
  return `${base.replace(/\/$/, '')}/signup?src=whatsapp&lead=${encodeURIComponent(token)}`;
}
