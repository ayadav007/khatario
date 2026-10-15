import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/db';
import { checkRateLimit, getClientIp } from '@/lib/rate-limit';
import { assertFeatureAccess, FeatureAccessDeniedError } from '@/lib/subscription/feature-access';
import {
  normalizePairingCode,
  parseDevicePublicKey,
  sha256Hex,
  StaffAuthError,
} from '@/lib/hr/staff-app/device-auth';
import { STAFF_ATTENDANCE_FEATURE } from '@/lib/hr/staff-app/route';

export const dynamic = 'force-dynamic';

const PAIR_LIMIT = 10;
const PAIR_WINDOW_MS = 15 * 60 * 1000;

function text(v: unknown, max: number): string | null {
  if (v == null) return null;
  const s = String(v).trim().slice(0, max);
  return s || null;
}

/**
 * POST /api/staff-app/pair — public. Links this phone to the employee whose one-time code the
 * owner showed. Body: { code, public_key, hardware_backed, device: { model, os_version, app_version } }.
 */
export async function POST(request: NextRequest) {
  const rl = checkRateLimit(`staff-pair:${getClientIp(request)}`, PAIR_LIMIT, PAIR_WINDOW_MS);
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'Too many tries. Wait a few minutes and try again.', code: 'RATE_LIMITED' },
      { status: 429 },
    );
  }

  const client = await getPool().connect();
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const code = normalizePairingCode(String(body.code ?? ''));
    if (code.length !== 10) {
      return NextResponse.json({ error: 'Enter the 10-letter code from your employer.', code: 'BAD_CODE' }, { status: 400 });
    }
    const publicKey = String(body.public_key ?? '');
    parseDevicePublicKey(publicKey);
    const device = (body.device && typeof body.device === 'object' ? body.device : {}) as Record<string, unknown>;

    await client.query('BEGIN');
    const claimed = await client.query<{ business_id: string; employee_id: string }>(
      `UPDATE staff_app_pairing_codes SET used_at = CURRENT_TIMESTAMP
       WHERE code_hash = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP
       RETURNING business_id, employee_id`,
      [sha256Hex(code)],
    );
    const link = claimed.rows[0];
    if (!link) {
      await client.query('ROLLBACK');
      return NextResponse.json(
        { error: 'That code is wrong or has expired. Ask your employer for a new one.', code: 'BAD_CODE' },
        { status: 400 },
      );
    }

    const employee = await client.query<{ name: string; employee_code: string | null; business_name: string }>(
      `SELECT u.name, e.employee_code, b.name AS business_name
       FROM employees e JOIN users u ON u.id = e.id JOIN businesses b ON b.id = e.business_id
       WHERE e.id = $1 AND e.business_id = $2 AND e.is_active AND u.is_active`,
      [link.employee_id, link.business_id],
    );
    if (!employee.rows[0]) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'This employee is no longer active.', code: 'EMPLOYEE_INACTIVE' }, { status: 400 });
    }

    try {
      await assertFeatureAccess(link.business_id, STAFF_ATTENDANCE_FEATURE);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    await client.query(
      `UPDATE staff_app_devices SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'replaced'
       WHERE employee_id = $1 AND revoked_at IS NULL`,
      [link.employee_id],
    );
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO staff_app_devices
         (business_id, employee_id, public_key, hardware_backed, device_model, os_version, app_version, last_seen_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, CURRENT_TIMESTAMP) RETURNING id`,
      [
        link.business_id,
        link.employee_id,
        publicKey,
        body.hardware_backed === true,
        text(device.model, 120),
        text(device.os_version, 40),
        text(device.app_version, 40),
      ],
    );
    await client.query('COMMIT');

    const e = employee.rows[0];
    return NextResponse.json({
      device_id: inserted.rows[0].id,
      employee: { name: e.name, code: e.employee_code },
      business: { name: e.business_name },
      server_time: Date.now(),
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (error instanceof StaffAuthError) return error.toNextResponse();
    if (error instanceof FeatureAccessDeniedError) return error.toNextResponse();
    console.error('[staff-app pair]', error);
    return NextResponse.json({ error: 'Could not link this phone. Try again.' }, { status: 500 });
  } finally {
    client.release();
  }
}
