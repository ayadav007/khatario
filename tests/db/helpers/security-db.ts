/**
 * Real-PostgreSQL harness for security regression tests.
 *
 * Runs only when KH_SECURITY_TEST_DATABASE_URL is set, and refuses any database that is not a
 * local `kh_phase2_test` (AGENTS.md: tests use only the disposable test database). Route handlers,
 * `authorize`, RBAC and every SQL statement run for real; test files stub only subscription/plan
 * gates, which depend on plan catalogue rows a disposable database may not carry.
 *
 * Each test file seeds its own businesses under fresh UUIDs and deletes them afterwards.
 */
import { randomUUID } from 'crypto';
import type { Pool } from 'pg';

export const SECURITY_DB_URL = process.env.KH_SECURITY_TEST_DATABASE_URL;

export function assertDisposableUrl(url: string): void {
  const u = new URL(url);
  const db = u.pathname.replace(/^\//, '');
  const localHosts = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (db !== 'kh_phase2_test' || !localHosts.has(u.hostname)) {
    throw new Error(`Refusing security DB tests against ${u.hostname}/${db}; only local kh_phase2_test is allowed`);
  }
}

/** Call at module top level, before anything imports '@/lib/db'. */
export function pointLibDbAtTestDatabase(): void {
  if (!SECURITY_DB_URL) return;
  assertDisposableUrl(SECURITY_DB_URL);
  process.env.DATABASE_URL = SECURITY_DB_URL;
}

/** Shared bag the `next/headers` mock reads, so code calling headers() sees the request's session. */
export const headerBag: { current: Record<string, string> } = { current: {} };
(global as unknown as { __securityHeaders: typeof headerBag }).__securityHeaders = headerBag;

export function sessionHeaders(userId: string, businessId: string): Record<string, string> {
  return {
    'x-authenticated-user-id': userId,
    'x-authenticated-business-id': businessId,
    'x-authenticated-session-version': '1',
  };
}

export type SeededBusiness = {
  businessId: string;
  ownerId: string;
  ownerRoleId: string;
  /** Restricted staff: a role with no permission on any module the tests exercise. */
  staffId: string;
  staffRoleId: string;
  branchId: string;
};

const createdBusinesses: string[] = [];
const createdUsers: string[] = [];

async function ensureModule(pool: Pool, key: string): Promise<void> {
  await pool.query(
    `INSERT INTO permission_modules (module_key, module_name, is_active)
     VALUES ($1, $1, true) ON CONFLICT (module_key) DO NOTHING`,
    [key],
  );
}

/** A business with an owner (primary admin), a restricted staff user, and one branch. */
export async function seedBusiness(pool: Pool, label: string): Promise<SeededBusiness> {
  const businessId = randomUUID();
  const ownerId = randomUUID();
  const staffId = randomUUID();
  const ownerRoleId = randomUUID();
  const staffRoleId = randomUUID();
  const branchId = randomUUID();
  const tag = `${label}-${businessId.slice(0, 8)}`;

  await pool.query(`INSERT INTO businesses (id, name) VALUES ($1, $2)`, [businessId, `Sec ${tag}`]);
  await pool.query(
    `INSERT INTO user_roles (id, business_id, role_name, role_key, is_system_role)
     VALUES ($1, $3, 'Primary Admin', 'primary_admin', true), ($2, $3, 'Restricted', 'restricted', false)`,
    [ownerRoleId, staffRoleId, businessId],
  );
  await pool.query(
    `INSERT INTO users (id, business_id, name, phone, role_id, is_primary_admin, is_active)
     VALUES ($1, $3, $4, $5, $6, true, true), ($2, $3, $7, $8, $9, false, true)`,
    [
      ownerId, staffId, businessId,
      `Owner ${tag}`, `9${ownerId.replace(/\D/g, '').slice(0, 9).padEnd(9, '1')}`, ownerRoleId,
      `Staff ${tag}`, `8${staffId.replace(/\D/g, '').slice(0, 9).padEnd(9, '2')}`, staffRoleId,
    ],
  );
  await pool.query(
    `INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $3, 'owner'), ($2, $3, 'staff')`,
    [ownerId, staffId, businessId],
  );
  await pool.query(`INSERT INTO branches (id, business_id, name) VALUES ($1, $2, $3)`, [branchId, businessId, `Main ${tag}`]);
  createdBusinesses.push(businessId);
  createdUsers.push(ownerId, staffId);
  return { businessId, ownerId, ownerRoleId, staffId, staffRoleId, branchId };
}

/** Grants `module` flags to a role (e.g. to model an Accountant who can read expenses). */
export async function grantRole(
  pool: Pool,
  roleId: string,
  module: string,
  flags: { view?: boolean; add?: boolean; modify?: boolean; delete?: boolean },
): Promise<void> {
  await ensureModule(pool, module);
  await pool.query(
    `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
     VALUES ($1, $2, $3, $4, $5, $6, false)`,
    [roleId, module, !!flags.view, !!flags.add, !!flags.modify, !!flags.delete],
  );
}

/** Makes a user an employee of their business (employees.id is the user id). */
export async function seedEmployee(pool: Pool, userId: string, businessId: string): Promise<string> {
  await pool.query(
    `INSERT INTO employees (id, business_id, employee_code, is_active) VALUES ($1, $2, $3, true)`,
    [userId, businessId, `E-${userId.slice(0, 8)}`],
  );
  return userId;
}

export async function seedExpense(pool: Pool, employeeId: string, description = 'Taxi'): Promise<string> {
  const id = randomUUID();
  await pool.query(
    `INSERT INTO employee_expenses (id, employee_id, expense_date, amount, description, status)
     VALUES ($1, $2, '2026-10-01', 500, $3, 'pending')`,
    [id, employeeId, description],
  );
  return id;
}

/** Deletes every business and user this file created (cascades to their rows). */
export async function cleanupSeeded(pool: Pool): Promise<void> {
  if (createdBusinesses.length === 0) return;
  // Rows that reference users without ON DELETE CASCADE must go first.
  await pool.query(`DELETE FROM employee_expenses WHERE employee_id = ANY($1::uuid[])`, [createdUsers]);
  await pool.query(`DELETE FROM employees WHERE id = ANY($1::uuid[])`, [createdUsers]);
  await pool.query(`DELETE FROM user_businesses WHERE user_id = ANY($1::uuid[])`, [createdUsers]);
  await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [createdUsers]);
  await pool.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [createdBusinesses]);
  createdBusinesses.length = 0;
  createdUsers.length = 0;
}
