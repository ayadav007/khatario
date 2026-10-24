import { NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db';
import { ownerRoute } from '@/lib/hr/staff-app/owner-route';
import {
  formatPairingCode,
  generatePairingCode,
  PAIRING_CODE_TTL_MS,
  PAIRING_QR_PREFIX,
  sha256Hex,
} from '@/lib/hr/staff-app/device-auth';
import { getEmployeeSiteIds, setEmployeeSites } from '@/lib/hr/staff-app/sites';

export const dynamic = 'force-dynamic';

type Params = { id: string };

async function employeeInBusiness(employeeId: string, businessId: string): Promise<boolean> {
  const row = await queryOne('SELECT 1 FROM employees WHERE id = $1 AND business_id = $2', [employeeId, businessId]);
  return !!row;
}

const notFound = () => NextResponse.json({ error: 'Employee not found' }, { status: 404 });

/** GET — the linked phone (if any) and the employee's check-in sites. */
export const GET = ownerRoute<Params>('device get', 'attendance', 'read', async ({ businessId, params }) => {
  if (!(await employeeInBusiness(params.id, businessId))) return notFound();
  const device = await queryOne(
    `SELECT id, device_model, os_version, app_version, hardware_backed, created_at, last_seen_at
     FROM staff_app_devices WHERE employee_id = $1 AND business_id = $2 AND revoked_at IS NULL`,
    [params.id, businessId],
  );
  return NextResponse.json({ device: device ?? null, site_ids: await getEmployeeSiteIds(params.id) });
});

/** POST — a fresh one-time code (and QR text) to link a phone. Earlier unused codes stop working. */
export const POST = ownerRoute<Params>('device pair', 'attendance', 'update', async ({ businessId, userId, params }) => {
  const employee = await queryOne<{ active: boolean }>(
    `SELECT (e.is_active AND u.is_active) AS active FROM employees e JOIN users u ON u.id = e.id
     WHERE e.id = $1 AND e.business_id = $2`,
    [params.id, businessId],
  );
  if (!employee) return notFound();
  if (!employee.active) return NextResponse.json({ error: 'This employee is inactive.' }, { status: 400 });

  await query(
    `UPDATE staff_app_pairing_codes SET expires_at = CURRENT_TIMESTAMP
     WHERE employee_id = $1 AND used_at IS NULL AND expires_at > CURRENT_TIMESTAMP`,
    [params.id],
  );
  const code = generatePairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_CODE_TTL_MS);
  await query(
    `INSERT INTO staff_app_pairing_codes (business_id, employee_id, code_hash, expires_at, created_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [businessId, params.id, sha256Hex(code), expiresAt, userId],
  );
  return NextResponse.json({
    code: formatPairingCode(code),
    qr: `${PAIRING_QR_PREFIX}${code}`,
    expires_at: expiresAt.toISOString(),
  });
});

/** PATCH — { site_ids: [...] }. An empty list lets the employee use any site. */
export const PATCH = ownerRoute<Params>('device sites', 'attendance', 'update', async ({ request, businessId, params }) => {
  if (!(await employeeInBusiness(params.id, businessId))) return notFound();
  const body = (await request.json().catch(() => ({}))) as { site_ids?: unknown };
  const ids = (Array.isArray(body.site_ids) ? body.site_ids : [])
    .map(String)
    .filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  return NextResponse.json({ site_ids: await setEmployeeSites(businessId, params.id, ids) });
});

/** DELETE — unlink the phone. It must be linked again with a new code. */
export const DELETE = ownerRoute<Params>('device unlink', 'attendance', 'update', async ({ businessId, params }) => {
  if (!(await employeeInBusiness(params.id, businessId))) return notFound();
  await query(
    `UPDATE staff_app_devices SET revoked_at = CURRENT_TIMESTAMP, revoked_reason = 'unlinked'
     WHERE employee_id = $1 AND business_id = $2 AND revoked_at IS NULL`,
    [params.id, businessId],
  );
  return NextResponse.json({ success: true });
});
