/**
 * Plan limits are counted and written as one step (plan 2026-11-27 Task 2: SUB-25, SUB-39, SUB-38 and the four
 * HR limit keys) against real PostgreSQL. Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/limits-atomic.db.test.ts --runInBand --forceExit
 *
 * Every plan used here is a throwaway copy of a real plan priced at Rs 1, so the "a Rs 1 plan behaves like any
 * other plan" rule is exercised by every test, and no shared plan row is edited.
 * No real WhatsApp, email or gateway call: the senders are mocked.
 */
import { randomUUID } from 'crypto';

const enabled = !!process.env.PHASE2_TEST_DATABASE_URL;
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
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
const headerBag: { current: Record<string, string> } = { current: {} };
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (name: string) => headerBag.current[name.toLowerCase()] ?? null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

// The count rule is wrapped so one test can make the count query throw (the real function runs otherwise).
const countFailure: { on: boolean } = { on: false };
jest.mock('@/lib/subscription/limit-registry', () => {
  const actual = jest.requireActual('@/lib/subscription/limit-registry');
  return {
    ...actual,
    buildLimitCountQuery: (...args: unknown[]) => {
      if (countFailure.on) throw new Error('simulated count failure');
      return (actual.buildLimitCountQuery as (...a: unknown[]) => unknown)(...args);
    },
  };
});

import { NextRequest } from 'next/server';
import { query, queryOne, closePool } from '@/lib/db';
import { checkLimit, clearSubscriptionCache, evaluateLimit, LIMIT_CHECK_RETRY_MESSAGE } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { LimitRefusedError, limitedQueryOne, withLimitedCreate } from '@/lib/subscription/limit-lock';
import { POST as postEmployeeRoute } from '@/app/api/employees/route';
import { POST as postBranchRoute } from '@/app/api/branches/route';
import { POST as postTaskRoute } from '@/app/api/tasks/route';
import { PATCH as patchOrgCatalogRoute } from '@/app/api/settings/hr-org-catalog/route';
import { createSupplier } from '@/lib/suppliers/create-supplier';
import { processCommissionEarning } from '@/lib/commission-calculator';
import { hasWhatsAppBotAddon, ADDON_CACHE_TTL } from '@/lib/subscription';
import { afterPlanChangeCommitted } from '@/lib/subscription/apply-module-plan-change';

const run = enabled ? describe : describe.skip;

type RouteHandler = (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response> | Response;

run('limits are counted and written as one step (kh_phase2_test)', () => {
  jest.setTimeout(90000);
  const SESSION_VERSION = 7;
  const createdBusinesses: string[] = [];
  const createdPlans: string[] = [];
  const phone = () => `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;

  /** A throwaway copy of `base` priced at Rs 1, with its features and limits, and `limits` applied on top. */
  async function makePlan(base: string, limits: Record<string, number>, opts: { price?: number; legacy?: Record<string, number> } = {}): Promise<string> {
    const id = `t_lim_${randomUUID().slice(0, 8)}`;
    createdPlans.push(id);
    await query(
      `INSERT INTO subscription_plans SELECT (json_populate_record(null::subscription_plans,
         (to_jsonb(p) || jsonb_build_object('id', $1::text, 'name', $1::text, 'display_name', $1::text,
            'price_monthly', $3::numeric, 'price_yearly', $3::numeric * 12, 'price_3year', $3::numeric * 30,
            'is_public', false))::json)).* FROM subscription_plans p WHERE p.id = $2`,
      [id, base, opts.price ?? 1],
    );
    await query(
      `INSERT INTO subscription_plan_features (plan_id, feature_id, enabled)
       SELECT $1, feature_id, enabled FROM subscription_plan_features WHERE plan_id = $2`,
      [id, base],
    );
    await query(
      `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value)
       SELECT $1, limit_key, limit_value FROM subscription_plan_limits WHERE plan_id = $2`,
      [id, base],
    );
    for (const [key, value] of Object.entries(limits)) {
      await query(
        `INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, $2, $3)
         ON CONFLICT (plan_id, limit_key) DO UPDATE SET limit_value = EXCLUDED.limit_value`,
        [id, key, value],
      );
    }
    if (opts.legacy) {
      await query(
        `UPDATE subscription_plans SET features = jsonb_set(features, '{limits}', COALESCE(features->'limits', '{}'::jsonb) || $2::jsonb)
          WHERE id = $1`,
        [id, JSON.stringify(opts.legacy)],
      );
    }
    return id;
  }

  async function setPlan(biz: string, moduleKey: string, planId: string) {
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date)
       VALUES ($1, $2, $3, 'active', CURRENT_DATE)
       ON CONFLICT (business_id, module_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active',
         start_date = CURRENT_DATE, end_date = NULL, grace_period_end = NULL, trial_end_date = NULL, updated_at = CURRENT_TIMESTAMP`,
      [biz, moduleKey, planId],
    );
    clearSubscriptionCache(biz);
    clearModuleSubscriptionCache(biz);
  }

  /** A business with Billing on `billingPlan` (and HR on `hrPlan` when given) and an owner that can call the routes. */
  async function newBusiness(billingPlan: string, hrPlan?: string): Promise<{ biz: string; owner: string }> {
    const biz = randomUUID();
    createdBusinesses.push(biz);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [biz, `Limits atomic ${biz.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [biz]);
    if (hrPlan) {
      await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'hr', true, 'test')`, [biz]);
      await setPlan(biz, 'hr', hrPlan);
    }
    await setPlan(biz, 'billing', billingPlan);
    const owner = randomUUID();
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version)
       VALUES ($1, $2, 'Owner', $3, true, $4)`,
      [owner, biz, phone(), SESSION_VERSION],
    );
    await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'owner')`, [owner, biz]);
    return { biz, owner };
  }

  async function addEmployee(biz: string, opts: { department?: string; designation?: string; active?: boolean } = {}): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_active, auth_session_version) VALUES ($1, $2, $3, $4, true, 1)`,
      [id, biz, `Emp ${id.slice(0, 6)}`, phone()],
    );
    await query(
      `INSERT INTO employees (id, business_id, employee_code, access_type, is_active, department, designation)
       VALUES ($1, $2, $3, 'attendance_only', $4, $5, $6)`,
      [id, biz, `E-${id.slice(0, 8)}`, opts.active ?? true, opts.department ?? null, opts.designation ?? null],
    );
    return id;
  }

  async function callRoute(
    handler: RouteHandler,
    a: { biz: string; userId: string; method: string; path: string; body?: Record<string, unknown> },
  ): Promise<Response> {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-authenticated-business-id': a.biz,
      'x-authenticated-user-id': a.userId,
      'x-authenticated-session-version': String(SESSION_VERSION),
      'x-khatario-pathname': a.path,
    };
    headerBag.current = headers;
    const req = new NextRequest(`http://localhost${a.path}`, {
      method: a.method,
      headers,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
    });
    return handler(req, { params: { id: '' } });
  }

  const count = async (sqlAfterFrom: string, params: unknown[]) =>
    Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${sqlAfterFrom}`, params))!.n);

  const statuses = (rs: Response[]) => rs.map((r) => r.status).sort((x, y) => x - y);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of createdBusinesses) {
        await query(`DELETE FROM commission_earnings WHERE employee_id IN (SELECT id FROM employees WHERE business_id = $1)`, [id]).catch(() => undefined);
        await query(`DELETE FROM employee_performance WHERE employee_id IN (SELECT id FROM employees WHERE business_id = $1)`, [id]).catch(() => undefined);
        await query(`DELETE FROM commission_rules WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM invoices WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM customers WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM tasks WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM whatsapp_messages WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM suppliers WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM branches WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM employees WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM user_businesses WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM users WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      for (const id of createdPlans) await query(`DELETE FROM subscription_plans WHERE id = $1`, [id]).catch(() => undefined);
      await closePool();
    }
  });

  afterEach(() => {
    countFailure.on = false;
  });

  describe('two creates at limit - 1: exactly one succeeds', () => {
    it('employees (POST /api/employees)', async () => {
      const hr = await makePlan('hr_starter', { max_employees: 3 });
      const { biz, owner } = await newBusiness(await makePlan('billing_growth', {}), hr);
      await addEmployee(biz);
      await addEmployee(biz); // 2 of 3
      const post = (n: number) =>
        callRoute(postEmployeeRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: '/api/employees',
          body: { name: `Racer ${n}`, phone: phone() },
        });
      const rs = await Promise.all([post(1), post(2)]);
      expect(statuses(rs)).toEqual([201, 403]);
      const refused = rs.find((r) => r.status === 403)!;
      expect(await refused.json()).toMatchObject({ code: 'SUBSCRIPTION_LIMIT_EXCEEDED', limit_type: 'employees' });
      expect(await count(`employees WHERE business_id = $1 AND is_active = true`, [biz])).toBe(3);
      // The refused request left no login behind without an employee.
      expect(await count(`users u WHERE u.business_id = $1 AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = u.id) AND u.id <> $2`, [biz, owner])).toBe(0);
    });

    it('branches (POST /api/branches)', async () => {
      const plan = await makePlan('billing_business', { max_branches: 3 });
      const { biz, owner } = await newBusiness(plan);
      for (const [i, def] of [[1, true], [2, false]] as const) {
        await query(`INSERT INTO branches (business_id, name, is_default, is_active) VALUES ($1, $2, $3, true)`, [biz, `B${i}`, def]);
      }
      const post = (n: number) =>
        callRoute(postBranchRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: '/api/branches',
          body: { business_id: biz, name: `Racer branch ${n}`, created_by_user_id: owner },
        });
      const rs = await Promise.all([post(1), post(2)]);
      expect(statuses(rs)).toEqual([201, 403]);
      expect(await count(`branches WHERE business_id = $1 AND is_active = true`, [biz])).toBe(3);
    });

    it('a refused branch create leaves the current default branch as it was', async () => {
      const plan = await makePlan('billing_business', { max_branches: 1 });
      const { biz, owner } = await newBusiness(plan);
      await query(`INSERT INTO branches (business_id, name, is_default, is_active) VALUES ($1, 'Main', true, true)`, [biz]);
      const res = await callRoute(postBranchRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'POST', path: '/api/branches',
        body: { business_id: biz, name: 'Second', is_default: true, created_by_user_id: owner },
      });
      expect(res.status).toBe(403);
      const main = await queryOne<{ is_default: boolean }>(`SELECT is_default FROM branches WHERE business_id = $1 AND name = 'Main'`, [biz]);
      expect(main!.is_default).toBe(true);
    });

    it('suppliers (createSupplier, also used by imports)', async () => {
      const plan = await makePlan('billing_growth', { max_suppliers: 3 });
      const { biz, owner } = await newBusiness(plan);
      for (let i = 0; i < 2; i++) await query(`INSERT INTO suppliers (business_id, name) VALUES ($1, $2)`, [biz, `S${i}`]);
      headerBag.current = {
        'x-authenticated-business-id': biz,
        'x-authenticated-user-id': owner,
        'x-authenticated-session-version': String(SESSION_VERSION),
      };
      const make = (n: number) =>
        createSupplier({ businessId: biz, userId: owner } as never, { name: `Racer supplier ${n}` });
      const results = await Promise.allSettled([make(1), make(2)]);
      const ok = results.filter((r) => r.status === 'fulfilled' && (r.value as { ok: boolean }).ok);
      const refused = results.filter((r) => r.status === 'rejected');
      expect(ok).toHaveLength(1);
      expect(refused).toHaveLength(1);
      expect(String((refused[0] as PromiseRejectedResult).reason?.message)).toMatch(/suppliers limit/);
      expect(await count(`suppliers WHERE business_id = $1`, [biz])).toBe(3);
    });

    it('a monthly HR limit (POST /api/tasks, max_employee_tasks_per_month)', async () => {
      const hr = await makePlan('hr_starter', { max_employee_tasks_per_month: 3 });
      const { biz, owner } = await newBusiness(await makePlan('billing_growth', {}), hr);
      for (let i = 0; i < 2; i++) await query(`INSERT INTO tasks (business_id, title) VALUES ($1, $2)`, [biz, `T${i}`]);
      const post = (n: number) =>
        callRoute(postTaskRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: '/api/tasks', body: { title: `Racer task ${n}` },
        });
      const rs = await Promise.all([post(1), post(2)]);
      expect(statuses(rs)).toEqual([201, 403]);
      expect(await count(`tasks WHERE business_id = $1`, [biz])).toBe(3);
    });

    it('the WhatsApp daily counter (limitedQueryOne into whatsapp_messages)', async () => {
      const plan = await makePlan('billing_growth', { max_whatsapp_per_day: 5 });
      const { biz } = await newBusiness(plan);
      for (let i = 0; i < 4; i++) {
        await query(`INSERT INTO whatsapp_messages (business_id, to_number, message_type, status) VALUES ($1, $2, 'text', 'sent')`, [biz, phone()]);
      }
      const send = () =>
        limitedQueryOne(
          biz, 'whatsapp',
          `INSERT INTO whatsapp_messages (business_id, to_number, message_type, status) VALUES ($1, $2, 'text', 'sent') RETURNING id`,
          [biz, phone()],
        );
      const results = await Promise.allSettled([send(), send(), send()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      for (const r of results.filter((x) => x.status === 'rejected')) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(LimitRefusedError);
      }
      expect(await count(`whatsapp_messages WHERE business_id = $1`, [biz])).toBe(5);
      expect((await checkLimit(biz, 'whatsapp')).allowed).toBe(false);
    });

    it('a slow insert cannot widen the window: employees, monthly HR tasks and WhatsApp, forced to overlap', async () => {
      const hr = await makePlan('hr_starter', { max_employees: 3, max_employee_tasks_per_month: 3 });
      const bill = await makePlan('billing_growth', { max_whatsapp_per_day: 3 });
      const { biz } = await newBusiness(bill, hr);
      await addEmployee(biz);
      await addEmployee(biz);
      for (let i = 0; i < 2; i++) {
        await query(`INSERT INTO tasks (business_id, title) VALUES ($1, $2)`, [biz, `T${i}`]);
        await query(`INSERT INTO whatsapp_messages (business_id, to_number, message_type, status) VALUES ($1, $2, 'text', 'sent')`, [biz, phone()]);
      }
      const slow = (limit: 'employees' | 'employee_tasks' | 'whatsapp', insert: (c: import('pg').PoolClient) => Promise<unknown>) =>
        withLimitedCreate(biz, limit, async (c) => {
          await c.query('SELECT pg_sleep(0.4)'); // both requests have counted before either insert, unless the lock queues them
          return insert(c);
        });
      const settled = async (limit: 'employees' | 'employee_tasks' | 'whatsapp', insert: (c: import('pg').PoolClient) => Promise<unknown>) =>
        (await Promise.allSettled([slow(limit, insert), slow(limit, insert)])).filter((r) => r.status === 'fulfilled').length;

      expect(await settled('employees', async (c) => {
        const id = randomUUID();
        await c.query(`INSERT INTO users (id, business_id, name, phone, is_active, auth_session_version) VALUES ($1, $2, 'E', $3, true, 1)`, [id, biz, phone()]);
        await c.query(`INSERT INTO employees (id, business_id, employee_code, access_type, is_active) VALUES ($1, $2, $3, 'attendance_only', true)`, [id, biz, `E-${id.slice(0, 8)}`]);
      })).toBe(1);
      expect(await settled('employee_tasks', (c) => c.query(`INSERT INTO tasks (business_id, title) VALUES ($1, 'slow')`, [biz]))).toBe(1);
      expect(await settled('whatsapp', (c) =>
        c.query(`INSERT INTO whatsapp_messages (business_id, to_number, message_type, status) VALUES ($1, $2, 'text', 'sent')`, [biz, phone()]),
      )).toBe(1);
      expect(await count(`employees WHERE business_id = $1 AND is_active = true`, [biz])).toBe(3);
      expect(await count(`tasks WHERE business_id = $1`, [biz])).toBe(3);
      expect(await count(`whatsapp_messages WHERE business_id = $1`, [biz])).toBe(3);
    });

    it('a Rs 1 plan and a Rs 999 plan with the same limits refuse alike', async () => {
      const cheap = await newBusiness(await makePlan('billing_growth', { max_suppliers: 1 }, { price: 1 }));
      const dear = await newBusiness(await makePlan('billing_growth', { max_suppliers: 1 }, { price: 999 }));
      for (const { biz } of [cheap, dear]) {
        await query(`INSERT INTO suppliers (business_id, name) VALUES ($1, 'one')`, [biz]);
        const check = await checkLimit(biz, 'suppliers');
        expect(check).toMatchObject({ allowed: false, current: 1, limit: 1 });
        await expect(withLimitedCreate(biz, 'suppliers', async () => 'inserted')).rejects.toBeInstanceOf(LimitRefusedError);
      }
    });
  });

  describe('SUB-25: a failing count refuses the request', () => {
    it('checkLimit answers "try again", not the upgrade prompt, and logs the error', async () => {
      const { biz } = await newBusiness(await makePlan('billing_growth', { max_suppliers: 50 }));
      const errLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      countFailure.on = true;
      const check = await checkLimit(biz, 'suppliers');
      expect(check.allowed).toBe(false);
      expect(check.unavailable).toBe(true);
      expect(check.message).toBe(LIMIT_CHECK_RETRY_MESSAGE);
      expect(check.message).toMatch(/try again in a moment/i);
      expect(check.message).not.toMatch(/upgrade/i);
      expect(errLog).toHaveBeenCalled();
      errLog.mockRestore();
    });

    it('a locked create is refused with the retry message and nothing is inserted', async () => {
      const { biz } = await newBusiness(await makePlan('billing_growth', { max_suppliers: 50 }));
      const errLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      countFailure.on = true;
      let inserted = false;
      await expect(
        withLimitedCreate(biz, 'suppliers', async () => {
          inserted = true;
        }),
      ).rejects.toMatchObject({ name: 'LimitRefusedError', check: { unavailable: true, message: LIMIT_CHECK_RETRY_MESSAGE } });
      expect(inserted).toBe(false);
      errLog.mockRestore();
    });

    it('a route answers 503 LIMIT_CHECK_UNAVAILABLE (no upgrade prompt)', async () => {
      const hr = await makePlan('hr_starter', { max_employees: 50 });
      const { biz, owner } = await newBusiness(await makePlan('billing_growth', {}), hr);
      const errLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      countFailure.on = true;
      const res = await callRoute(postEmployeeRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'POST', path: '/api/employees', body: { name: 'X', phone: phone() },
      });
      countFailure.on = false;
      errLog.mockRestore();
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'LIMIT_CHECK_UNAVAILABLE' });
      expect(await count(`employees WHERE business_id = $1`, [biz])).toBe(0);
    });
  });

  describe('SUB-39: a registry limit of 0 means 0', () => {
    it('is refused although the legacy JSON on the plan row says 50', async () => {
      const plan = await makePlan('billing_growth', { max_suppliers: 0 }, { legacy: { max_suppliers: 50 } });
      const { biz } = await newBusiness(plan);
      const check = await checkLimit(biz, 'suppliers');
      expect(check).toMatchObject({ allowed: false, limit: 0, current: 0 });
      await expect(withLimitedCreate(biz, 'suppliers', async () => 'inserted')).rejects.toBeInstanceOf(LimitRefusedError);
    });

    it('a limit key with no registry row still reads the legacy JSON (unchanged behaviour)', async () => {
      const { biz } = await newBusiness(await makePlan('billing_growth', {}));
      // Simulate "no active platform_limits row": the plan-limit lookup returns nothing, other reads are real.
      const noRegistryRow = async (sql: string, params?: unknown[]) =>
        /FROM platform_limits/.test(sql) ? null : queryOne(sql, params as unknown[]);
      const withJson = await evaluateLimit(biz, 'suppliers', noRegistryRow, { legacyLimits: { max_suppliers: 50 } });
      expect(withJson).toMatchObject({ allowed: true, limit: 50 });
      const withoutJson = await evaluateLimit(biz, 'suppliers', noRegistryRow, { legacyLimits: null });
      expect(withoutJson).toMatchObject({ allowed: false, message: 'No limits defined' });
    });
  });

  describe('the four HR limit keys are enforced where the records are created', () => {
    it('max_departments: a new department name is refused at the limit, an existing one is not', async () => {
      const hr = await makePlan('hr_starter', { max_departments: 2 });
      const { biz, owner } = await newBusiness(await makePlan('billing_growth', {}), hr);
      await addEmployee(biz, { department: 'Sales' });
      await addEmployee(biz, { department: 'Stores' });
      const post = (department: string) =>
        callRoute(postEmployeeRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: '/api/employees', body: { name: 'N', phone: phone(), department },
        });
      const refused = await post('Finance');
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: 'SUBSCRIPTION_LIMIT_EXCEEDED', limit_type: 'departments' });
      expect((await post('sales')).status).toBe(201); // same name, other letter case: not new
    });

    it('max_designations: a new designation name is refused at the limit', async () => {
      const hr = await makePlan('hr_starter', { max_designations: 1 });
      const { biz, owner } = await newBusiness(await makePlan('billing_growth', {}), hr);
      await addEmployee(biz, { designation: 'Clerk' });
      const res = await callRoute(postEmployeeRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'POST', path: '/api/employees', body: { name: 'N', phone: phone(), designation: 'Manager' },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ limit_type: 'designations' });
    });

    it('Settings → departments counts names saved there too', async () => {
      const hr = await makePlan('hr_starter', { max_departments: 2, max_designations: 5 });
      const { biz, owner } = await newBusiness(await makePlan('billing_growth', {}), hr);
      const patch = (body: Record<string, unknown>) =>
        callRoute(patchOrgCatalogRoute as unknown as RouteHandler, { biz, userId: owner, method: 'PATCH', path: '/api/settings/hr-org-catalog', body });
      expect((await patch({ departments: ['A', 'B'] })).status).toBe(200);
      const over = await patch({ departments: ['A', 'B', 'C'] });
      expect(over.status).toBe(403);
      expect(await over.json()).toMatchObject({ limit_type: 'departments' });
      expect((await patch({ departments: ['b', 'A'] })).status).toBe(200); // nothing new
    });

    it('max_commissions_per_month and max_performance_reviews_per_month', async () => {
      const hr = await makePlan('hr_starter', { max_commissions_per_month: 1, max_performance_reviews_per_month: 1 });
      const { biz } = await newBusiness(await makePlan('billing_growth', {}), hr);
      const emp = await addEmployee(biz);
      await query(`INSERT INTO commission_rules (business_id, employee_id, commission_type, commission_value, is_active) VALUES ($1, $2, 'percentage', 5, true)`, [biz, emp]);
      const makeInvoice = async () => {
        const customerId = randomUUID();
        const invoiceId = randomUUID();
        await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'C', $3)`, [customerId, biz, phone()]);
        await query(`INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date) VALUES ($1, $2, $3, $4, CURRENT_DATE)`, [invoiceId, biz, customerId, `INV-${invoiceId.slice(0, 6)}`]);
        return invoiceId;
      };
      const earn = async () => {
        const id = await makeInvoice();
        return processCommissionEarning(biz, id, { id, grand_total: 1000, created_by: emp, items: [] });
      };
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      expect(await earn()).not.toBeNull();
      expect(await earn()).toBeNull(); // second commission this month: not recorded, invoice unaffected
      warn.mockRestore();
      expect(await count(`commission_earnings ce JOIN employees e ON e.id = ce.employee_id WHERE e.business_id = $1`, [biz])).toBe(1);
      // One performance record was allowed; the daily and monthly rows are separate records, so only one was added.
      expect(await count(`employee_performance WHERE employee_id = $1`, [emp])).toBe(1);
    });

    it('two commissions at limit - 1 at once: exactly one is recorded', async () => {
      const hr = await makePlan('hr_starter', { max_commissions_per_month: 3, max_performance_reviews_per_month: -1 });
      const { biz } = await newBusiness(await makePlan('billing_growth', {}), hr);
      const emp = await addEmployee(biz);
      await query(`INSERT INTO commission_rules (business_id, employee_id, commission_type, commission_value, is_active) VALUES ($1, $2, 'percentage', 5, true)`, [biz, emp]);
      const customerId = randomUUID();
      await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'C', $3)`, [customerId, biz, phone()]);
      const invoiceIds: string[] = [];
      for (let i = 0; i < 4; i++) {
        const invoiceId = randomUUID();
        invoiceIds.push(invoiceId);
        await query(`INSERT INTO invoices (id, business_id, customer_id, invoice_number, invoice_date) VALUES ($1, $2, $3, $4, CURRENT_DATE)`, [invoiceId, biz, customerId, `INV-${invoiceId.slice(0, 6)}`]);
      }
      for (const id of invoiceIds.slice(0, 2)) {
        await query(`INSERT INTO commission_earnings (employee_id, invoice_id, sale_amount, commission_rate, commission_amount, status) VALUES ($1, $2, 100, 5, 5, 'pending')`, [emp, id]);
      }
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const results = await Promise.all(
        invoiceIds.slice(2).map((id) => processCommissionEarning(biz, id, { id, grand_total: 1000, created_by: emp, items: [] })),
      );
      warn.mockRestore();
      expect(results.filter((r) => r !== null)).toHaveLength(1);
      expect(await count(`commission_earnings ce JOIN employees e ON e.id = ce.employee_id WHERE e.business_id = $1`, [biz])).toBe(3);
    });
  });

  describe('SUB-38: Connect entitlement cache', () => {
    it('is held for at most 30 seconds', () => {
      expect(ADDON_CACHE_TTL).toBeLessThanOrEqual(30_000);
    });

    it('a plan change drops it in this process at once (afterPlanChangeCommitted)', async () => {
      const { biz } = await newBusiness(await makePlan('billing_growth', {}));
      await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'connect', true, 'test')`, [biz]);
      const connectPlan = await makePlan('connect', {});
      await setPlan(biz, 'connect', connectPlan);
      const before = await hasWhatsAppBotAddon(biz);
      // Move the Connect row to the free plan behind the cache's back, as another process would.
      await query(`UPDATE business_module_subscriptions SET plan_id = 'connect_free' WHERE business_id = $1 AND module_key = 'connect'`, [biz]);
      expect(await hasWhatsAppBotAddon(biz)).toBe(before); // still the cached answer
      await afterPlanChangeCommitted(
        { business_id: biz, module_key: 'connect', plan_id: 'connect_free', billing_cycle: 'monthly' } as never,
        { fromPlanId: connectPlan, paymentMethod: 'test', paymentReference: 'x' } as never,
      );
      expect(await hasWhatsAppBotAddon(biz)).toBe(false);
      expect(before).toBe(true);
    });
  });
});
