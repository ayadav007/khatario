import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import {
  PARTNER_SESSION_COOKIE,
  PARTNER_SESSION_HEADER,
} from '@/lib/partners/constants';
import type { PartnerUserRole } from '@/lib/partners/team';
import type { PartnerPublicProfile } from '@/lib/partners/types';

export { PARTNER_SESSION_COOKIE, PARTNER_SESSION_HEADER };

const SESSION_HOURS = 24 * 7;

export type PartnerSession = {
  session_token: string;
  partner_id: string;
  partner_user_id: string | null;
  role: PartnerUserRole;
  user_name: string;
  expires_at: Date;
  partner: PartnerPublicProfile;
};

export async function createPartnerSession(params: {
  partnerId: string;
  partnerUserId?: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS);

  await query(
    `INSERT INTO platform_partner_sessions (partner_id, partner_user_id, session_token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [params.partnerId, params.partnerUserId ?? null, token, expiresAt.toISOString()],
  );

  await query(
    `UPDATE platform_partners SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = $1`,
    [params.partnerId],
  );

  return { token, expiresAt };
}

export async function resolvePartnerSession(
  token: string | null | undefined,
): Promise<PartnerSession | null> {
  if (!token?.trim()) return null;

  const row = await queryOne<{
    session_token: string;
    partner_id: string;
    partner_user_id: string | null;
    expires_at: string;
    id: string;
    partner_type: PartnerPublicProfile['partner_type'];
    name: string;
    email: string;
    phone: string | null;
    referral_code: string;
    status: PartnerPublicProfile['status'];
    commission_type: PartnerPublicProfile['commission_type'];
    commission_value: string | number;
    commission_basis: PartnerPublicProfile['commission_basis'];
    hold_days: number | null;
    user_role: PartnerUserRole | null;
    user_name: string | null;
    user_active: boolean | null;
  }>(
    `SELECT
       s.session_token, s.partner_id, s.partner_user_id, s.expires_at,
       p.id, p.partner_type, p.name, p.email, p.phone, p.referral_code, p.status,
       p.commission_type, p.commission_value, p.commission_basis, p.hold_days,
       u.role AS user_role, u.name AS user_name, u.is_active AS user_active
     FROM platform_partner_sessions s
     INNER JOIN platform_partners p ON p.id = s.partner_id
     LEFT JOIN platform_partner_users u ON u.id = s.partner_user_id
     WHERE s.session_token = $1
       AND s.expires_at > CURRENT_TIMESTAMP
       AND p.status = 'active'`,
    [token.trim()],
  );

  if (!row) return null;
  if (row.partner_user_id && row.user_active === false) return null;

  return {
    session_token: row.session_token,
    partner_id: row.partner_id,
    partner_user_id: row.partner_user_id,
    role: row.user_role || 'owner',
    user_name: row.user_name || row.name,
    expires_at: new Date(row.expires_at),
    partner: {
      id: row.id,
      partner_type: row.partner_type,
      name: row.name,
      email: row.email,
      phone: row.phone,
      referral_code: row.referral_code,
      status: row.status,
      commission_type: row.commission_type,
      commission_value: Number(row.commission_value),
      commission_basis: row.commission_basis,
      hold_days: row.hold_days,
    },
  };
}

export function getPartnerTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(PARTNER_SESSION_COOKIE)?.value ?? null;
}

export async function getPartnerSessionFromRequest(
  request: NextRequest,
): Promise<PartnerSession | null> {
  return resolvePartnerSession(getPartnerTokenFromRequest(request));
}

export async function getPartnerSessionFromCookies(): Promise<PartnerSession | null> {
  const jar = await cookies();
  return resolvePartnerSession(jar.get(PARTNER_SESSION_COOKIE)?.value);
}

function cookieSecure(): boolean {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || '';
  return process.env.NODE_ENV === 'production' && appUrl.startsWith('https://');
}

export function setPartnerSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: Date,
): void {
  response.cookies.set(PARTNER_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });
}

export function clearPartnerSessionCookie(response: NextResponse): void {
  response.cookies.set(PARTNER_SESSION_COOKIE, '', {
    httpOnly: true,
    secure: cookieSecure(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

export async function destroyPartnerSession(token: string | null | undefined): Promise<void> {
  if (!token?.trim()) return;
  await query(`DELETE FROM platform_partner_sessions WHERE session_token = $1`, [token.trim()]);
}
