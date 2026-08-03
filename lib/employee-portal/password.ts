import bcrypt from 'bcryptjs';
import { queryOne } from '@/lib/db';

const MIN_PASSWORD_LENGTH = 8;

export function validateEmployeePortalPassword(password: string): { ok: true } | { ok: false; error: string } {
  const trimmed = password.trim();
  if (trimmed.length < MIN_PASSWORD_LENGTH) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  if (!/[A-Za-z]/.test(trimmed) || !/[0-9]/.test(trimmed)) {
    return { ok: false, error: 'Password must include at least one letter and one number' };
  }
  return { ok: true };
}

export async function updateEmployeePortalPassword(
  employeeId: string,
  businessId: string,
  plainPassword: string,
  options: { mustChange?: boolean } = {}
): Promise<void> {
  const validation = validateEmployeePortalPassword(plainPassword);
  if (!validation.ok) {
    throw new Error(validation.error);
  }

  const hash = await bcrypt.hash(plainPassword.trim().replace(/\u2010|\u2011|\u2012|\u2013|\u2014|\u2212/g, '-'), 10);
  const mustChange = options.mustChange ?? false;

  const updated = await queryOne(
    `UPDATE users u
     SET password_hash = $1,
         must_change_password = $2,
         updated_at = CURRENT_TIMESTAMP
     FROM employees e
     WHERE u.id = e.id AND e.id = $3 AND e.business_id = $4
     RETURNING u.id`,
    [hash, mustChange, employeeId, businessId]
  );

  if (!updated) {
    throw new Error('Employee not found');
  }
}

export async function clearMustChangePassword(employeeId: string, businessId: string): Promise<void> {
  await queryOne(
    `UPDATE users u
     SET must_change_password = false, updated_at = CURRENT_TIMESTAMP
     FROM employees e
     WHERE u.id = e.id AND e.id = $1 AND e.business_id = $2
     RETURNING u.id`,
    [employeeId, businessId]
  );
}

export async function getMustChangePassword(
  employeeId: string,
  businessId: string
): Promise<boolean> {
  const row = await queryOne<{ must_change_password: boolean }>(
    `SELECT u.must_change_password
     FROM users u
     INNER JOIN employees e ON e.id = u.id
     WHERE u.id = $1 AND e.business_id = $2`,
    [employeeId, businessId]
  );
  return row?.must_change_password ?? false;
}
