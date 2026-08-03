import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db';
import { resolveBusinessByPortalSlug } from '@/lib/employee-portal/resolve-business';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import {
  createEmployeePortalSession,
  employeePortalCookieOptions,
  EMPLOYEE_PORTAL_COOKIE,
} from '@/lib/employee-portal/session';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { normalizePhoneOrNull } from '@/lib/utils/phone';
import { getMustChangePassword } from '@/lib/employee-portal/password';
import { getHrPortalSettings } from '@/lib/hr/hr-portal-settings';

export const dynamic = 'force-dynamic';

/** Normalize pasted passwords (trim, ASCII hyphen). */
function normalizePortalPassword(input: string): string {
  return input.trim().replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2212/g, '-');
}

const LOGIN_LIMIT = 20;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export async function POST(
  request: NextRequest,
  { params }: { params: { slug: string } }
) {
  try {
    const ip = getClientIp(request);
    const rl = checkRateLimit(`emp-portal-login:${ip}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
    if (!rl.allowed) {
      return NextResponse.json({ error: 'Too many attempts. Try again later.' }, { status: 429 });
    }

    const business = await resolveBusinessByPortalSlug(params.slug);
    if (!business) {
      return NextResponse.json({ error: 'Invalid employee ID or password' }, { status: 401 });
    }

    try {
      await assertFeatureAccess(business.id, 'hr_employee_portal');
    } catch (error) {
      if (error instanceof FeatureAccessDeniedError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const body = await request.json();
    const employeeCode = String(body.employee_code ?? '')
      .trim()
      .toUpperCase();
    const phoneRaw = String(body.phone ?? '').trim();
    const password = normalizePortalPassword(String(body.password ?? ''));
    const kioskMode = body.kiosk === true;

    if (!employeeCode && !phoneRaw) {
      return NextResponse.json({ error: 'Employee ID or phone is required' }, { status: 400 });
    }
    if (kioskMode) {
      const portalSettings = await getHrPortalSettings(business.id);
      if (!portalSettings.kiosk_enabled) {
        return NextResponse.json({ error: 'Attendance kiosk is disabled' }, { status: 403 });
      }

      const row = await queryOne<{
        id: string;
        employee_code: string;
        name: string;
      }>(
        `SELECT e.id, e.employee_code, u.name
         FROM employees e
         INNER JOIN users u ON u.id = e.id
         WHERE e.business_id = $1
           AND upper(trim(e.employee_code)) = $2
           AND e.is_active = true
           AND u.is_active = true`,
        [business.id, employeeCode]
      );

      if (!row) {
        return NextResponse.json({ error: 'Invalid employee ID' }, { status: 401 });
      }

      const { token, expiresAt } = await createEmployeePortalSession(business.id, row.id);
      const response = NextResponse.json({
        employee: {
          id: row.id,
          name: row.name,
          employee_code: row.employee_code,
        },
      });
      response.cookies.set(EMPLOYEE_PORTAL_COOKIE, token, employeePortalCookieOptions(expiresAt));
      return response;
    }

    if (!password) {
      return NextResponse.json({ error: 'Employee ID and password are required' }, { status: 400 });
    }

    const row = await queryOne<{
      id: string;
      employee_code: string;
      access_type: string;
      password_hash: string | null;
      name: string;
    }>(
      phoneRaw
        ? `SELECT e.id, e.employee_code, e.access_type, u.password_hash, u.name
           FROM employees e
           INNER JOIN users u ON u.id = e.id
           WHERE e.business_id = $1
             AND u.phone = $2
             AND e.is_active = true
             AND u.is_active = true`
        : `SELECT e.id, e.employee_code, e.access_type, u.password_hash, u.name
           FROM employees e
           INNER JOIN users u ON u.id = e.id
           WHERE e.business_id = $1
             AND upper(trim(e.employee_code)) = $2
             AND e.is_active = true
             AND u.is_active = true`,
      phoneRaw
        ? [business.id, normalizePhoneOrNull(phoneRaw) ?? phoneRaw]
        : [business.id, employeeCode]
    );
    if (!row) {
      return NextResponse.json({ error: 'Invalid employee ID or password' }, { status: 401 });
    }
    if (!row.password_hash) {
      return NextResponse.json(
        {
          error:
            'Portal sign-in is not set up yet. Ask your HR admin to send a new portal invite from the employee profile.',
        },
        { status: 401 }
      );
    }

    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) {
      return NextResponse.json({ error: 'Invalid employee ID or password' }, { status: 401 });
    }

    const { token, expiresAt } = await createEmployeePortalSession(business.id, row.id);
    const mustChangePassword = await getMustChangePassword(row.id, business.id);

    const response = NextResponse.json({
      employee: {
        id: row.id,
        name: row.name,
        employee_code: row.employee_code,
        access_type: row.access_type,
      },
      business: {
        id: business.id,
        name: business.name,
        logo_url: business.logo_url,
        portal_slug: business.portal_slug,
      },
      must_change_password: mustChangePassword,
    });
    response.cookies.set(EMPLOYEE_PORTAL_COOKIE, token, employeePortalCookieOptions(expiresAt));
    return response;
  } catch (error: unknown) {
    console.error('[employee portal login]', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Login failed' },
      { status: 500 }
    );
  }
}
