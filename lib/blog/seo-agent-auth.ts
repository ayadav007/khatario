import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The SEO agent writes blog drafts with `Authorization: Bearer <SEO_AGENT_API_KEY>`.
 * Drafts are attributed to SEO_AGENT_ADMIN_ID (the platform admin who reviews them).
 * Fails closed when either is missing.
 */
export function requireSeoAgent(
  request: NextRequest,
): { ok: true; adminId: string } | { ok: false; response: NextResponse } {
  const secret = process.env.SEO_AGENT_API_KEY?.trim();
  const adminId = process.env.SEO_AGENT_ADMIN_ID?.trim();
  if (!secret || secret.length < 32 || !adminId || !UUID.test(adminId)) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'SEO agent access is not configured' }, { status: 503 }),
    };
  }
  const header = request.headers.get('authorization') || '';
  const given = Buffer.from(header.startsWith('Bearer ') ? header.slice(7) : '');
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  return { ok: true, adminId };
}
