import crypto from 'crypto';
import { cookies } from 'next/headers';
import { NextRequest, NextResponse } from 'next/server';
import { queryOne } from '@/lib/db';

export const EMPLOYEE_PORTAL_COOKIE = 'khatario_employee_portal';

const SESSION_HOURS = 24 * 7;

export type EmployeePortalSession = {
  session_token: string;
  business_id: string;
  employee_id: string;
  employee_name: string;
  employee_code: string;
  expires_at: Date;
};

export async function createEmployeePortalSession(
  businessId: string,
  employeeId: string
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + SESSION_HOURS);

  await queryOne(
    `INSERT INTO employee_portal_sessions (business_id, employee_id, session_token, expires_at)
     VALUES ($1, $2, $3, $4)`,
    [businessId, employeeId, token, expiresAt.toISOString()]
  );

  await queryOne(
    `UPDATE employees SET
       portal_last_login_at = CURRENT_TIMESTAMP,
       portal_registered_at = COALESCE(portal_registered_at, CURRENT_TIMESTAMP)
     WHERE id = $1`,
    [employeeId]
  );

  return { token, expiresAt };
}

export async function resolveEmployeePortalSession(
  token: string | null | undefined
): Promise<EmployeePortalSession | null> {
  if (!token?.trim()) return null;

  const row = await queryOne<{
    session_token: string;
    business_id: string;
    employee_id: string;
    expires_at: string;
    employee_name: string;
    employee_code: string;
  }>(
    `SELECT
       s.session_token,
       s.business_id,
       s.employee_id,
       s.expires_at,
       u.name AS employee_name,
       e.employee_code
     FROM employee_portal_sessions s
     INNER JOIN employees e ON e.id = s.employee_id AND e.is_active = true
     INNER JOIN users u ON u.id = e.id AND u.is_active = true
     WHERE s.session_token = $1
       AND s.expires_at > CURRENT_TIMESTAMP`,
    [token.trim()]
  );

  if (!row) return null;

  return {
    session_token: row.session_token,
    business_id: row.business_id,
    employee_id: row.employee_id,
    employee_name: row.employee_name,
    employee_code: row.employee_code,
    expires_at: new Date(row.expires_at),
  };
}

export function getEmployeePortalTokenFromRequest(request: NextRequest): string | null {
  return request.cookies.get(EMPLOYEE_PORTAL_COOKIE)?.value ?? null;
}

export async function getEmployeePortalSessionFromRequest(
  request: NextRequest
): Promise<EmployeePortalSession | null> {
  return resolveEmployeePortalSession(getEmployeePortalTokenFromRequest(request));
}

export async function getEmployeePortalSessionFromCookies(): Promise<EmployeePortalSession | null> {
  const jar = await cookies();
  return resolveEmployeePortalSession(jar.get(EMPLOYEE_PORTAL_COOKIE)?.value);
}

export function employeePortalCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    path: '/',
    expires: expiresAt,
  };
}

export async function destroyEmployeePortalSession(token: string | null | undefined): Promise<void> {
  if (!token?.trim()) return;
  await queryOne(`DELETE FROM employee_portal_sessions WHERE session_token = $1`, [token.trim()]);
}

export function clearEmployeePortalCookie(response: NextResponse): void {
  response.cookies.set(EMPLOYEE_PORTAL_COOKIE, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}
