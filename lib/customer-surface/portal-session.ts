import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest } from 'next/server';
import { queryOne } from '@/lib/db';

export const CUSTOMER_PORTAL_COOKIE = 'khatario_customer_portal';

const SESSION_HOURS = 24 * 7;

export type CustomerPortalSession = {
  session_token: string;
  business_id: string;
  customer_id: string;
  customer_name: string;
  customer_email: string | null;
  expires_at: Date;
};

export async function createCustomerPortalSession(
  businessId: string,
  customerId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS);

  await queryOne(
    `INSERT INTO customer_portal_sessions (business_id, customer_id, session_token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [businessId, customerId, token, expiresAt.toISOString()]
  );

  await queryOne(
    `UPDATE customers SET portal_last_login_at = CURRENT_TIMESTAMP WHERE id = $1`,
    [customerId]
  );

  return { token, expiresAt };
}

export async function resolveCustomerPortalSession(
  token: string | null | undefined
): Promise<CustomerPortalSession | null> {
  if (!token?.trim()) return null;

  const row = await queryOne<{
    session_token: string;
    business_id: string;
    customer_id: string;
    expires_at: string;
    customer_name: string;
    customer_email: string | null;
  }>(
    `SELECT
       s.session_token,
       s.business_id,
       s.customer_id,
       s.expires_at,
       c.name AS customer_name,
       c.email AS customer_email
     FROM customer_portal_sessions s
     INNER JOIN customers c ON c.id = s.customer_id AND c.deleted_at IS NULL
     WHERE s.session_token = $1
       AND s.expires_at > CURRENT_TIMESTAMP
       AND c.portal_enabled = true
       AND c.is_active = true`,
    [token.trim()]
  );

  if (!row) return null;

  return {
    session_token: row.session_token,
    business_id: row.business_id,
    customer_id: row.customer_id,
    customer_name: row.customer_name,
    customer_email: row.customer_email,
    expires_at: new Date(row.expires_at),
  };
}

export function getCustomerPortalTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(CUSTOMER_PORTAL_COOKIE)?.value ?? null;
}

export async function getCustomerPortalSessionFromRequest(
  request: NextRequest
): Promise<CustomerPortalSession | null> {
  return resolveCustomerPortalSession(getCustomerPortalTokenFromRequest(request));
}

export function customerPortalCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

/** Server Components: read portal cookie */
export async function getCustomerPortalSessionFromCookies(): Promise<CustomerPortalSession | null> {
  const jar = await cookies();
  const token = jar.get(CUSTOMER_PORTAL_COOKIE)?.value;
  return resolveCustomerPortalSession(token);
}
