/**
 * Plan limit / plan feature enforcement against real PostgreSQL. Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/plan-enforcement.db.test.ts --runInBand --forceExit
 *
 * Helpers (reused by every task in this file): newBusinessWithOwner, addUser, addEmployee, makeRole,
 * callRoute, userRow, setPlan, count.
 */
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';

const TEST_DB = 'kh_phase2_test';
const enabled = !!process.env.PHASE2_TEST_DATABASE_URL || process.env.SUBSCRIPTION_DB_TEST === '1';
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
} else if (enabled) {
  const env: Record<string, string> = {};
  loadEnv({ path: '.env', processEnv: env });
  const auth = `${encodeURIComponent(env.DB_USER || 'postgres')}:${encodeURIComponent(env.DB_PASSWORD || '')}`;
  process.env.DATABASE_URL = `postgresql://${auth}@localhost:${env.DB_PORT || '5432'}/${TEST_DB}`;
  process.env.DB_SSL = 'false';
}

jest.mock('@/lib/platform-auth', () => ({ logAdminAction: jest.fn() }));
jest.mock('@/lib/platform-email', () => ({
  getBusinessPlatformRecipient: jest.fn(async () => null),
  notifyAdminsSubscriptionChange: jest.fn(),
  sendPlatformEmail: jest.fn(async () => true),
  getPlatformAdminRecipientEmails: jest.fn(async () => []),
  getPlatformNotificationSettings: jest.fn(async () => ({})),
  platformEmailLayout: jest.fn(() => ''),
}));
jest.mock('@/lib/platform-whatsapp-send', () => ({
  lookupTenantWhatsAppPhone: jest.fn(async () => null),
  sendPlatformEventWhatsApp: jest.fn(async () => undefined),
}));
jest.mock('@/lib/jwt', () => ({ clearSessionCookie: jest.fn() }));
jest.mock('@/lib/platform-push', () => ({ sendPlatformAdminPush: jest.fn(async () => undefined) }));

// authorize() and assertSessionValidForCookieAuth() read the request headers through next/headers.
// callRoute() stores the current request's headers here so those reads see the same session.
const headerBag: { current: Record<string, string> } = { current: {} };
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({
    get: (name: string) => headerBag.current[name.toLowerCase()] ?? null,
  })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { NextRequest } from 'next/server';
import { query, queryOne, closePool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { CONSOLE_SEAT_COUNT_SQL, userOccupiesConsoleSeat } from '@/lib/subscription/seat-counting';
import { PATCH as patchUserRoute } from '@/app/api/settings/users/[id]/route';
import { PATCH as patchEmployeeRoute } from '@/app/api/employees/[id]/route';

const run = enabled ? describe : describe.skip;

type SetPlanOpts = {
  end_date?: string; // relative to CURRENT_DATE, e.g. '+300 days' | '-1 day'
  grace_period_end?: string;
  scheduled_plan_id?: string;
  status?: string;
};

type RouteHandler = (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response> | Response;

run('plan enforcement (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  const SESSION_VERSION = 7;

  const phone = () => `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;

  /**
   * A business with billing enabled, a module subscription row on `planId`, a primary-admin owner with
   * auth_session_version = SESSION_VERSION and a user_businesses owner row. `opts.hr` also enables HR
   * (needed to call /api/employees routes).
   */
  async function newBusinessWithOwner(
    planId: string,
    opts: { hr?: boolean; label?: string } = {},
  ): Promise<{ biz: string; owner: string }> {
    const biz = randomUUID();
    created.push(biz);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [biz, `Plan enforcement ${opts.label ?? 't'} ${biz.slice(0, 6)}`],
    );
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [biz],
    );
    if (opts.hr) {
      await query(
        `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'hr', true, 'test')`,
        [biz],
      );
      await setPlan(biz, 'hr', 'hr_staff_lite');
    }
    await setPlan(biz, 'billing', planId);
    const owner = randomUUID();
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version)
       VALUES ($1, $2, 'Owner', $3, true, $4)`,
      [owner, biz, phone(), SESSION_VERSION],
    );
    await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'owner')`, [owner, biz]);
    return { biz, owner };
  }

  /** Put a module row into a known state. Date opts are intervals relative to CURRENT_DATE. */
  async function setPlan(
    businessId: string,
    moduleKey: string,
    planId: string,
    opts: SetPlanOpts = {},
  ): Promise<void> {
    await query(
      `INSERT INTO business_module_subscriptions
         (business_id, module_key, plan_id, status, start_date, end_date, grace_period_end, scheduled_plan_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE,
               CASE WHEN $5::text IS NULL THEN NULL ELSE (CURRENT_DATE + $5::interval)::date END,
               CASE WHEN $6::text IS NULL THEN NULL ELSE (CURRENT_DATE + $6::interval)::date END,
               $7)
       ON CONFLICT (business_id, module_key) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, start_date = CURRENT_DATE,
         trial_end_date = NULL, end_date = EXCLUDED.end_date,
         grace_period_end = EXCLUDED.grace_period_end,
         scheduled_plan_id = EXCLUDED.scheduled_plan_id, updated_at = CURRENT_TIMESTAMP`,
      [
        businessId,
        moduleKey,
        planId,
        opts.status ?? 'active',
        opts.end_date ?? null,
        opts.grace_period_end ?? null,
        opts.scheduled_plan_id ?? null,
      ],
    );
    clearSubscriptionCache(businessId);
    clearModuleSubscriptionCache(businessId);
  }

  /** A role of this business (unique per business and key). Returns its id. */
  async function makeRole(biz: string, key: string): Promise<string> {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO user_roles (business_id, role_name, role_key, is_system_role)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (business_id, role_key) DO UPDATE SET role_name = EXCLUDED.role_name
       RETURNING id`,
      [biz, key, key],
    );
    return r!.id;
  }

  /**
   * A non-owner user. With `accessType` the user also gets an employees row of that access type
   * (the way an HR roster entry links to its login).
   */
  async function addUser(
    biz: string,
    opts: { roleId?: string | null; accessType?: string; isActive?: boolean; seatType?: string } = {},
  ): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO users (id, business_id, name, phone, role_id, is_active, seat_type, auth_session_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 1)`,
      [id, biz, `User ${id.slice(0, 6)}`, phone(), opts.roleId ?? null, opts.isActive ?? true, opts.seatType ?? 'billing'],
    );
    if (opts.accessType) await addEmployee(biz, { userId: id, accessType: opts.accessType });
    return id;
  }

  /** An employees row on the HR roster. Creates its user (no role, attendance-only) when no userId is given. */
  async function addEmployee(
    biz: string,
    opts: { userId?: string; isActive?: boolean; accessType?: string } = {},
  ): Promise<string> {
    const accessType = opts.accessType ?? 'attendance_only';
    const id = opts.userId ?? (await addUser(biz, { isActive: opts.isActive ?? true }));
    await query(
      `INSERT INTO employees (id, business_id, employee_code, access_type, is_active)
       VALUES ($1, $2, $3, $4, $5)`,
      [id, biz, `E-${id.slice(0, 8)}`, accessType, opts.isActive ?? true],
    );
    return id;
  }

  /**
   * Call a route handler as `userId` of `biz` with the trusted headers middleware sets.
   * `path` is also stamped as x-khatario-pathname so plan path gates apply.
   */
  async function callRoute(
    handler: RouteHandler,
    args: {
      biz: string;
      userId: string;
      method: string;
      path: string;
      body?: Record<string, unknown>;
      params?: { id: string };
      sessionVersion?: number;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-authenticated-business-id': args.biz,
      'x-authenticated-user-id': args.userId,
      'x-authenticated-session-version': String(args.sessionVersion ?? SESSION_VERSION),
      'x-khatario-pathname': args.path,
    };
    headerBag.current = headers;
    const req = new NextRequest(`http://localhost${args.path}`, {
      method: args.method,
      headers,
      body: args.body === undefined ? undefined : JSON.stringify(args.body),
    });
    return handler(req, { params: args.params ?? { id: '' } });
  }

  /** A users row (role_id, is_active, seat_type, name), or null. */
  async function userRow(id: string) {
    return queryOne<{
      id: string;
      name: string;
      role_id: string | null;
      is_active: boolean;
      seat_type: string | null;
    }>(`SELECT id, name, role_id, is_active, seat_type FROM users WHERE id = $1`, [id]);
  }

  /** SELECT COUNT(*) FROM <sqlAfterFrom>. */
  async function count(sqlAfterFrom: string, params: unknown[]): Promise<number> {
    const r = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${sqlAfterFrom}`, params);
    return Number(r!.n);
  }

  const patchUser = (biz: string, owner: string, id: string, body: Record<string, unknown>) =>
    callRoute(patchUserRoute, {
      biz, userId: owner, method: 'PATCH', path: `/api/settings/users/${id}`, body, params: { id },
    });
  const patchEmployee = (biz: string, owner: string, id: string, body: Record<string, unknown>) =>
    callRoute(patchEmployeeRoute, {
      biz, userId: owner, method: 'PATCH', path: `/api/employees/${id}`, body, params: { id },
    });

  beforeAll(() => {
    // Tripwire: nothing in these tests may reach the network.
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of created) {
        await query(`DELETE FROM employees WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM user_businesses WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM users WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      await closePool();
    }
  });

  describe('SUB-08: gaining console access needs a free seat', () => {
    let biz: string;
    let owner: string;
    let staffRoleId: string;
    let otherRoleId: string;
    let seatedUserId: string;
    let attendanceOnlyUserId: string;

    beforeEach(async () => {
      // Starter allows 3 console users: owner + two role holders fill it.
      ({ biz, owner } = await newBusinessWithOwner('billing_starter', { hr: true, label: 'seat' }));
      staffRoleId = await makeRole(biz, 'staff');
      otherRoleId = await makeRole(biz, 'cashier');
      seatedUserId = await addUser(biz, { roleId: staffRoleId });
      await addUser(biz, { roleId: staffRoleId });
      attendanceOnlyUserId = await addUser(biz, { accessType: 'attendance_only' });
    });

    it('starts with three seats used and one attendance-only user outside them', async () => {
      expect(await count(`(${CONSOLE_SEAT_COUNT_SQL.replace('$1', `'${biz}'`)}) q WHERE q.count = 3`, [])).toBe(1);
    });

    it('giving a role to an attendance-only user is refused at the seat limit', async () => {
      const res = await patchUser(biz, owner, attendanceOnlyUserId, { role_id: staffRoleId });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
      expect((await userRow(attendanceOnlyUserId))!.role_id).toBeNull();
    });

    it('renaming a user who already holds a seat still works at the limit', async () => {
      const res = await patchUser(biz, owner, seatedUserId, { name: 'Renamed' });
      expect(res.status).toBe(200);
      expect((await userRow(seatedUserId))!.name).toBe('Renamed');
    });

    it('changing the role of a seated user still works at the limit', async () => {
      const res = await patchUser(biz, owner, seatedUserId, { role_id: otherRoleId });
      expect(res.status).toBe(200);
      expect((await userRow(seatedUserId))!.role_id).toBe(otherRoleId);
    });

    it('the same role change succeeds when a seat is free', async () => {
      await query(`UPDATE users SET is_active = false WHERE id = $1`, [seatedUserId]);
      const res = await patchUser(biz, owner, attendanceOnlyUserId, { role_id: staffRoleId });
      expect(res.status).toBe(200);
      expect((await userRow(attendanceOnlyUserId))!.role_id).toBe(staffRoleId);
    });

    it('switching an employee to full access is refused at the seat limit', async () => {
      const res = await patchEmployee(biz, owner, attendanceOnlyUserId, { access_type: 'full' });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
      const e = await queryOne<{ access_type: string }>(`SELECT access_type FROM employees WHERE id = $1`, [attendanceOnlyUserId]);
      expect(e!.access_type).toBe('attendance_only');
    });

    it('switching an employee to full access succeeds when a seat is free', async () => {
      await query(`UPDATE users SET is_active = false WHERE id = $1`, [seatedUserId]);
      const res = await patchEmployee(biz, owner, attendanceOnlyUserId, { access_type: 'full' });
      expect(res.status).toBe(200);
    });

    it('userOccupiesConsoleSeat agrees with the SQL count for these row shapes', async () => {
      // owner (counts), role holders (count), attendance-only (no), inactive role holder (no)
      await addUser(biz, { roleId: staffRoleId, isActive: false });
      const rows = await query(
        `SELECT u.is_active, u.is_primary_admin, u.role_id, u.seat_type, e.access_type
         FROM users u LEFT JOIN employees e ON e.id = u.id WHERE u.business_id = $1`,
        [biz],
      );
      const byRule = (rows.rows as any[]).filter((r) => userOccupiesConsoleSeat(r)).length;
      const bySql = await queryOne<{ count: number }>(CONSOLE_SEAT_COUNT_SQL, [biz]);
      expect(bySql!.count).toBe(3);
      expect(byRule).toBe(bySql!.count);
    });
  });
});

