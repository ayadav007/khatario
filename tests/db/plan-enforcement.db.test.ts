/**
 * Plan limit / plan feature enforcement against real PostgreSQL. Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/plan-enforcement.db.test.ts --runInBand --forceExit
 *
 * Helpers (reused by every task in this file): newBusinessWithOwner, addUser, addEmployee, makeRole,
 * callRoute, userRow, setPlan, count, makeInvoiceWithCustomer, fillWhatsAppQuota, addOwnedBusiness, moduleRow.
 */
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';

// Own-origin document links for the invoice WhatsApp send (Task 2).
process.env.NEXT_PUBLIC_APP_URL = 'https://app.test.khatario';

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
jest.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: jest.fn(async () => undefined) }));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  setSessionCookies: jest.fn(),
  signAccessToken: jest.fn(async () => 'access-token'),
  signRefreshToken: jest.fn(async () => 'refresh-token'),
}));
jest.mock('@/lib/platform-push', () => ({ sendPlatformAdminPush: jest.fn(async () => undefined) }));

// authorize() and assertSessionValidForCookieAuth() read the request headers through next/headers.
// callRoute() stores the current request's headers here so those reads see the same session.
const headerBag: { current: Record<string, string> } = { current: {} };
// `noRequest.current` makes headers() carry nothing, as for a call with no request (cron, jobs). Real Next.js
// throws there; that path is covered in tests/lib/authorization-business-context.test.ts, because
// assertSessionValidForCookieAuth() reads headers() unguarded and would throw before the plan gates run.
const noRequest: { current: boolean } = { current: false };
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => {
    if (noRequest.current) return { get: () => null };
    return { get: (name: string) => headerBag.current[name.toLowerCase()] ?? null };
  }),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { NextRequest } from 'next/server';
import { query, queryOne, closePool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { CONSOLE_SEAT_COUNT_SQL, userOccupiesConsoleSeat } from '@/lib/subscription/seat-counting';
import { PATCH as patchUserRoute } from '@/app/api/settings/users/[id]/route';
import { PATCH as patchEmployeeRoute } from '@/app/api/employees/[id]/route';
import { POST as postInvoiceWhatsApp } from '@/app/api/invoices/[id]/whatsapp/route';
import { sendWhatsAppMessage } from '@/lib/whatsapp';
import { checkLimit, clearAddonCache } from '@/lib/subscription';
import { GET as getLedgerRoute } from '@/app/api/ledger/route';
import { POST as postBusinessRoute } from '@/app/api/businesses/route';
import { authorize } from '@/lib/authorization';
import { getPool } from '@/lib/db';
import { ownerHasOtherBusiness, provisionBusiness } from '@/lib/businesses/provision-business';

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
      headers?: Record<string, string>;
    },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-authenticated-business-id': args.biz,
      'x-authenticated-user-id': args.userId,
      'x-authenticated-session-version': String(args.sessionVersion ?? SESSION_VERSION),
      'x-khatario-pathname': args.path,
      ...(args.headers ?? {}),
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


  /**
   * A further business owned by the same login (one users row, many user_businesses rows). Gets a billing
   * module on `planId` and its own primary_admin role. The trusted headers and session version of
   * newBusinessWithOwner stay valid for requests on it. Returns the new business id.
   */
  async function addOwnedBusiness(ownerUserId: string, planId: string): Promise<string> {
    const biz = randomUUID();
    created.push(biz);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [biz, `Plan enforcement owned ${biz.slice(0, 6)}`],
    );
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [biz],
    );
    await setPlan(biz, 'billing', planId);
    await makeRole(biz, 'primary_admin');
    await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'owner')`, [ownerUserId, biz]);
    return biz;
  }

  /** The subscription row of one module of a business, or null. */
  async function moduleRow(biz: string, moduleKey: string) {
    return queryOne<{ plan_id: string; status: string; trial_end_date: string | null }>(
      `SELECT plan_id, status, trial_end_date FROM business_module_subscriptions WHERE business_id = $1 AND module_key = $2`,
      [biz, moduleKey],
    );
  }

  const getLedger = (biz: string, userId: string) =>
    callRoute(getLedgerRoute as unknown as RouteHandler, { biz, userId, method: 'GET', path: '/api/ledger' });
  const createBusiness = (biz: string, userId: string, body: Record<string, unknown>) =>
    callRoute(postBusinessRoute as unknown as RouteHandler, {
      biz, userId, method: 'POST', path: '/api/businesses',
      body: { businessType: 'retail', industry: 'other', ...body },
    });

  /** A customer with a phone number and an invoice for it. Returns the invoice id. */
  async function makeInvoiceWithCustomer(biz: string): Promise<string> {
    const customerId = randomUUID();
    const invoiceId = randomUUID();
    await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Cust', $3)`, [
      customerId, biz, phone(),
    ]);
    await query(
      `INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date)
       VALUES ($1, $2, $3, $4, CURRENT_DATE)`,
      [invoiceId, biz, customerId, `INV-${invoiceId.slice(0, 6)}`],
    );
    return invoiceId;
  }

  /** Insert today's whatsapp_messages rows (the rows checkLimit counts) up to the plan's daily limit. */
  async function fillWhatsAppQuota(biz: string): Promise<void> {
    const check = await checkLimit(biz, 'whatsapp');
    const limit = check.limit as number;
    for (let i = check.current; i < limit; i++) {
      await query(
        `INSERT INTO whatsapp_messages (business_id, to_number, message_type, status)
         VALUES ($1, $2, 'text', 'sent')`,
        [biz, phone()],
      );
    }
    clearSubscriptionCache(biz);
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
  describe('SUB-09: the invoice WhatsApp send is checked like every other send', () => {
    const ownUrl = (id: string) => `https://app.test.khatario/api/invoices/${id}/pdf`;
    let biz: string;
    let owner: string;
    let invoiceId: string;

    const send = (userId: string, body: Record<string, unknown>) =>
      callRoute(postInvoiceWhatsApp as unknown as RouteHandler, {
        biz, userId, method: 'POST', path: `/api/invoices/${invoiceId}/whatsapp`, body, params: { id: invoiceId },
      });

    beforeEach(async () => {
      jest.mocked(sendWhatsAppMessage).mockClear();
      ({ biz, owner } = await newBusinessWithOwner('free', { label: 'wa' }));
      invoiceId = await makeInvoiceWithCustomer(biz);
    });

    it('a user without invoice permission cannot send', async () => {
      const noPerm = await addUser(biz, { roleId: await makeRole(biz, 'noinvoice') });
      await query(`UPDATE users SET auth_session_version = 7 WHERE id = $1`, [noPerm]);
      const res = await send(noPerm, { pdf_url: ownUrl(invoiceId) });
      expect(res.status).toBe(403);
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('a link to another site is refused', async () => {
      const res = await send(owner, { pdf_url: 'https://evil.example/x.pdf' });
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('INVALID_PDF_URL');
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it.each(['javascript:alert(1)', '//evil.example/x.pdf', '/api/invoices/x/pdf', 'https://app.test.khatario\\@evil.example/x'])(
      'the link %s is refused',
      async (pdf_url) => {
        const res = await send(owner, { pdf_url });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('INVALID_PDF_URL');
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
      },
    );

    it('the daily cap applies', async () => {
      await fillWhatsAppQuota(biz);
      const res = await send(owner, { pdf_url: ownUrl(invoiceId) });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
      expect(sendWhatsAppMessage).not.toHaveBeenCalled();
    });

    it('a permitted user under the cap can send', async () => {
      const res = await send(owner, { pdf_url: ownUrl(invoiceId) });
      expect(res.status).toBe(200);
      expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
    });

    it('the document URL handed to the sender is the normalised href, not the raw value', async () => {
      const res = await send(owner, { pdf_url: `  HTTPS://APP.test.khatario:443/api/invoices/${invoiceId}/pdf  ` });
      expect(res.status).toBe(200);
      const args = jest.mocked(sendWhatsAppMessage).mock.calls[0];
      expect(args[3]).toBe(`https://app.test.khatario/api/invoices/${invoiceId}/pdf`);
      expect(args[4]).toBe('document');
    });

    it('outside production the request origin is also accepted (loopback test host)', async () => {
      const res = await send(owner, { pdf_url: `http://localhost/api/invoices/${invoiceId}/pdf` });
      expect(res.status).toBe(200);
    });

    it('in production a spoofed Host header cannot make a foreign link pass', async () => {
      const prev = process.env.NODE_ENV;
      (process.env as Record<string, string>).NODE_ENV = 'production';
      try {
        const res = await callRoute(postInvoiceWhatsApp as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: `/api/invoices/${invoiceId}/whatsapp`,
          body: { pdf_url: 'https://evil.example/x.pdf' }, params: { id: invoiceId },
          headers: { host: 'evil.example', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' },
        });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('INVALID_PDF_URL');
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
      } finally {
        (process.env as Record<string, string>).NODE_ENV = prev as string;
      }
    });

    it('a custom message is passed through on a plan with the custom-message entitlement', async () => {
      await query(
        `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'connect', true, 'test')
         ON CONFLICT (business_id, module_key) DO UPDATE SET enabled = true`,
        [biz],
      );
      await setPlan(biz, 'connect', 'connect');
      clearAddonCache(biz);
      const res = await send(owner, { pdf_url: ownUrl(invoiceId), custom_message: 'Thanks for your order' });
      expect(res.status).toBe(200);
      expect(jest.mocked(sendWhatsAppMessage).mock.calls[0][2]).toBe('Thanks for your order');
    });

    it('a custom message without the custom-message entitlement falls back to the default text', async () => {
      const res = await send(owner, { pdf_url: ownUrl(invoiceId), custom_message: 'Buy now' });
      expect(res.status).toBe(200);
      const text = jest.mocked(sendWhatsAppMessage).mock.calls[0][2];
      expect(text).not.toBe('Buy now');
      expect(text).toMatch(/^Hello! Please find your invoice INV-/);
    });
  });
  describe('SUB-12: plan checks use the session business; one trial per owner', () => {
    let freeBiz: string;
    let paidBiz: string;
    let owner: string;

    beforeEach(async () => {
      noRequest.current = false;
      ({ biz: freeBiz, owner } = await newBusinessWithOwner('free', { label: 'sub12' }));
      paidBiz = await addOwnedBusiness(owner, 'billing_business');
    });
    afterEach(() => {
      noRequest.current = false;
    });

    it('a session on the Free business is judged on the Free business even after switching elsewhere', async () => {
      await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [paidBiz, owner]);
      const res = await getLedger(freeBiz, owner);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
    });

    it('the paid business is not refused while the stored pointer is on the Free one', async () => {
      await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [freeBiz, owner]);
      const res = await getLedger(paidBiz, owner);
      expect(res.status).toBe(200);
    });

    it('a session business the user does not belong to is denied', async () => {
      const { biz: strangerBiz } = await newBusinessWithOwner('billing_business', { label: 'stranger' });
      await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [freeBiz, owner]);
      const res = await getLedger(strangerBiz, owner);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('CROSS_TENANT_DENIED');
    });

    it('authorize works with no request (cron)', async () => {
      noRequest.current = true;
      await expect(authorize(owner, 'invoices', 'read', { businessId: paidBiz })).resolves.toBeUndefined();
    });

    it('authorize with no request and no business falls back to the stored pointer', async () => {
      noRequest.current = true;
      await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [paidBiz, owner]);
      await expect(authorize(owner, 'invoices', 'read')).resolves.toBeUndefined();
    });

    it('a second business starts on Free, not on a new trial', async () => {
      const { biz: trialBiz, owner: trialOwner } = await newBusinessWithOwner('trial', { label: 'trial2' });
      // A running trial, as signup seeds it.
      await query(
        `UPDATE business_module_subscriptions SET status = 'trial', trial_end_date = CURRENT_DATE + 20
         WHERE business_id = $1 AND module_key = 'billing'`,
        [trialBiz],
      );
      clearSubscriptionCache(trialBiz);
      clearModuleSubscriptionCache(trialBiz);
      const res = await createBusiness(trialBiz, trialOwner, { businessName: 'Second shop' });
      expect(res.status).toBe(201);
      const id = (await res.json()).businessId as string;
      created.push(id);
      expect(await moduleRow(id, 'billing')).toMatchObject({ plan_id: 'free', status: 'active', trial_end_date: null });
    });

    it('multi-business is checked on the session business', async () => {
      await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [paidBiz, owner]);
      const before = await count(`user_businesses WHERE user_id = $1`, [owner]);
      const res = await createBusiness(freeBiz, owner, { businessName: 'Third shop' });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
      expect(await count(`user_businesses WHERE user_id = $1`, [owner])).toBe(before);
    });

    it('a paid session business may add a business even while the stored pointer is on the Free one', async () => {
      await query(`UPDATE users SET business_id = $1 WHERE id = $2`, [freeBiz, owner]);
      const res = await createBusiness(paidBiz, owner, { businessName: 'Fourth shop' });
      expect(res.status).toBe(201);
      const id = (await res.json()).businessId as string;
      created.push(id);
      expect(await moduleRow(id, 'billing')).toMatchObject({ plan_id: 'free', status: 'active', trial_end_date: null });
    });

    describe('provisioning', () => {
      const input = {
        businessName: 'Provision test', businessType: 'retail', industry: 'other', productLine: 'billing' as const,
      };
      async function provision(ownerUserId?: string) {
        const client = await getPool().connect();
        try {
          await client.query('BEGIN');
          const r = await provisionBusiness(client, { ...input, ownerUserId });
          await client.query('COMMIT');
          created.push(r.businessId);
          return r;
        } catch (e) {
          await client.query('ROLLBACK');
          throw e;
        } finally {
          client.release();
        }
      }

      it('a brand-new account keeps the 30-day trial on its first business', async () => {
        const r = await provision(randomUUID());
        const row = await moduleRow(r.businessId, 'billing');
        expect(row).toMatchObject({ plan_id: 'trial', status: 'trial' });
        expect(row!.trial_end_date).not.toBeNull();
        expect(r.trialDays).toBe(30);
      });

      it('signup (no owner yet) keeps the trial', async () => {
        const r = await provision();
        expect(await moduleRow(r.businessId, 'billing')).toMatchObject({ plan_id: 'trial', status: 'trial' });
      });

      it('an owner who already owns a business gets Free, active, no trial dates', async () => {
        const r = await provision(owner);
        expect(await moduleRow(r.businessId, 'billing')).toMatchObject({ plan_id: 'free', status: 'active', trial_end_date: null });
        expect(r.trialDays).toBeNull();
      });

      it('ownerHasOtherBusiness is true only for an owner row, and runs on the given client', async () => {
        const client = await getPool().connect();
        try {
          expect(await ownerHasOtherBusiness(client, owner)).toBe(true);
          expect(await ownerHasOtherBusiness(client, randomUUID())).toBe(false);
          const staff = await addUser(freeBiz);
          await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'staff')`, [staff, freeBiz]);
          expect(await ownerHasOtherBusiness(client, staff)).toBe(false);
        } finally {
          client.release();
        }
      });
    });
  });
});
