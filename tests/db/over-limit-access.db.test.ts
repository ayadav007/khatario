/**
 * Users and branches over the plan limit after a downgrade (plan 2026-11-27 Task 4: SUB-24) and the Free plan's
 * web access on the server (SUB-19), against real PostgreSQL. Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/over-limit-access.db.test.ts --runInBand --forceExit
 *
 * The test executes migration 483 as text first (the columns it adds hold the owner's choice).
 * Every paid plan used is a throwaway copy of a real plan priced at Rs 1, so "a Rs 1 plan behaves like any other
 * plan" is exercised by every test. No real WhatsApp, email or gateway call.
 */
import { randomUUID } from 'crypto';
import fs from 'fs';
import path from 'path';

const enabled = !!process.env.PHASE2_TEST_DATABASE_URL;
if (process.env.PHASE2_TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;
}

jest.mock('@/lib/platform-auth', () => ({ logAdminAction: jest.fn() }));
const sentEmails: { to: string; subject: string; text?: string; html: string; businessId?: string }[] = [];
jest.mock('@/lib/platform-email', () => ({
  getBusinessPlatformRecipient: jest.fn(async () => ({ email: 'owner@example.test', businessName: 'Test' })),
  notifyAdminsSubscriptionChange: jest.fn(),
  sendPlatformEmail: jest.fn(async (m: { to: string; subject: string; text?: string; html: string; businessId?: string }) => {
    sentEmails.push(m);
    return true;
  }),
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

const headerBag: { current: Record<string, string> } = { current: {} };
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: (name: string) => headerBag.current[name.toLowerCase()] ?? null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

// The layout's client components are stubs: only which one the server layout picks matters here.
jest.mock('@/components/layout/AppRouteShell', () => ({ AppRouteShell: function AppRouteShell() { return null; } }));
jest.mock('@/components/layout/AppGateScreens', () => ({
  WebAccessWall: function WebAccessWall() { return null; },
  PlanCheckFailedScreen: function PlanCheckFailedScreen() { return null; },
  SeatPausedScreen: function SeatPausedScreen() { return null; },
}));

// One test makes the web-access plan check throw.
const webAccessFailure: { on: boolean } = { on: false };
jest.mock('@/lib/subscription/web-access', () => {
  const actual = jest.requireActual('@/lib/subscription/web-access');
  return {
    ...actual,
    businessHasWebAccess: async (id: string) => {
      if (webAccessFailure.on) throw new Error('simulated plan check failure');
      return actual.businessHasWebAccess(id);
    },
  };
});

import bcrypt from 'bcryptjs';
import { NextRequest } from 'next/server';
import { query, queryOne, closePool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { requireStrictSession, assertSessionValidForCookieAuth } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { enforceAccess, EnforceAccessError } from '@/lib/enforce-access';
import { POST as loginRoute } from '@/app/api/auth/login/route';
import { GET as myBusinessesRoute } from '@/app/api/businesses/my/route';
import { POST as switchBusinessRoute } from '@/app/api/businesses/switch/route';
import { GET as gstStatusRoute } from '@/app/api/gst/status/route';
import { GET as gstChargesRoute } from '@/app/api/gst/charges/route';
import { GET as gstr3bExportRoute } from '@/app/api/gst/gstr3b/export/route';
import { POST as gstFileRoute } from '@/app/api/gst/file/route';
import { PATCH as invoicePaymentRoute } from '@/app/api/invoices/[id]/payments/route';
import { POST as postEmployeeRoute } from '@/app/api/employees/route';
import { execFileSync } from 'child_process';
import { PATCH as patchUserRoute } from '@/app/api/settings/users/[id]/route';
import { PATCH as patchBranchRoute } from '@/app/api/branches/[id]/route';
import { GET as getChoiceRoute, PUT as putChoiceRoute } from '@/app/api/settings/over-limit-access/route';
import { POST as postExpenseRoute } from '@/app/api/expenses/route';
import { resolveServerAppGate } from '@/lib/subscription/app-gate';
import AppRouteLayout from '@/app/(app)/layout';
import { SEAT_PAUSED_MESSAGE, isBranchReadOnly, isUserSeatPaused } from '@/lib/subscription/over-limit-access';

const run = enabled ? describe : describe.skip;

type RouteHandler = (req: NextRequest, ctx: { params: { id: string } }) => Promise<Response> | Response;

run('over-limit access and Free web access (kh_phase2_test)', () => {
  jest.setTimeout(90000);
  const SESSION_VERSION = 7;
  const PASSWORD = 'Over-limit-pw-1';
  const createdBusinesses: string[] = [];
  const createdPlans: string[] = [];
  const phone = () => `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;
  const hash = bcrypt.hashSync(PASSWORD, 4);

  beforeAll(async () => {
    if (!enabled) return;
    const sql = fs.readFileSync(path.join(process.cwd(), 'database/migrations/483_over_limit_access.sql'), 'utf8');
    await query(sql); // twice on purpose: the migrations are idempotent
    await query(sql);
    const sql484 = fs.readFileSync(path.join(process.cwd(), 'database/migrations/484_over_limit_notice.sql'), 'utf8');
    await query(sql484);
    await query(sql484);
  });

  async function makePlan(base: string, limits: Record<string, number>, price = 1): Promise<string> {
    const id = `t_olim_${randomUUID().slice(0, 8)}`;
    createdPlans.push(id);
    await query(
      `INSERT INTO subscription_plans SELECT (json_populate_record(null::subscription_plans,
         (to_jsonb(p) || jsonb_build_object('id', $1::text, 'name', $1::text, 'display_name', $1::text,
            'price_monthly', $3::numeric, 'price_yearly', $3::numeric * 12, 'price_3year', $3::numeric * 30,
            'is_public', false))::json)).* FROM subscription_plans p WHERE p.id = $2`,
      [id, base, price],
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
    return id;
  }

  /** Changes the plan the way a plan change does: the subscription caches are cleared afterwards. */
  async function setPlan(biz: string, planId: string) {
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE)
       ON CONFLICT (business_id, module_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active',
         start_date = CURRENT_DATE, end_date = NULL, grace_period_end = NULL, trial_end_date = NULL, updated_at = CURRENT_TIMESTAMP`,
      [biz, planId],
    );
    clearSubscriptionCache(biz);
    clearModuleSubscriptionCache(biz);
  }

  async function newBusiness(planId: string): Promise<{ biz: string; owner: string; ownerPhone: string }> {
    const biz = randomUUID();
    createdBusinesses.push(biz);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [biz, `Over limit ${biz.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [biz]);
    await setPlan(biz, planId);
    const owner = randomUUID();
    const ownerPhone = phone();
    await query(
      `INSERT INTO users (id, business_id, name, phone, password_hash, is_primary_admin, auth_session_version, created_at)
       VALUES ($1, $2, 'Owner', $3, $4, true, $5, NOW() - interval '100 days')`,
      [owner, biz, ownerPhone, hash, SESSION_VERSION],
    );
    await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'owner')`, [owner, biz]);
    return { biz, owner, ownerPhone };
  }

  /** A console user. `ageDays` is how long they have been in the business (older = longer-standing). */
  async function addUser(biz: string, ageDays: number, opts: { active?: boolean } = {}): Promise<{ id: string; phone: string }> {
    const id = randomUUID();
    const p = phone();
    await query(
      `INSERT INTO users (id, business_id, name, phone, password_hash, is_active, auth_session_version, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW() - ($8 || ' days')::interval)`,
      [id, biz, `User ${ageDays}d`, p, hash, opts.active ?? true, SESSION_VERSION, String(ageDays)],
    );
    await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'staff')`, [id, biz]);
    return { id, phone: p };
  }

  function sessionRequest(a: { biz: string; userId: string; method?: string; path?: string; body?: unknown; userAgent?: string }) {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-authenticated-business-id': a.biz,
      'x-authenticated-user-id': a.userId,
      'x-authenticated-session-version': String(SESSION_VERSION),
      'x-khatario-pathname': a.path ?? '/dashboard',
      ...(a.userAgent ? { 'user-agent': a.userAgent } : {}),
    };
    headerBag.current = headers;
    return new NextRequest(`http://localhost${a.path ?? '/dashboard'}`, {
      method: a.method ?? 'GET',
      headers,
      body: a.body === undefined ? undefined : JSON.stringify(a.body),
    });
  }

  const callRoute = (handler: RouteHandler, a: Parameters<typeof sessionRequest>[0] & { id?: string }) =>
    handler(sessionRequest(a), { params: { id: a.id ?? '' } });

  const login = (phoneNumber: string) =>
    loginRoute(
      new NextRequest('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ phone: phoneNumber, password: PASSWORD }),
      }),
    );

  /** Moves a business past its 7-day warning, the way time does, and drops the cached state. */
  async function startEnforcement(biz: string) {
    await isUserSeatPaused(randomUUID(), biz); // a request-time check records "first seen over the limit"
    await isBranchReadOnly(biz, randomUUID());
    await query(
      `UPDATE businesses SET over_limit_seats_since = CASE WHEN over_limit_seats_since IS NULL THEN NULL ELSE NOW() - interval '8 days' END,
                             over_limit_branches_since = CASE WHEN over_limit_branches_since IS NULL THEN NULL ELSE NOW() - interval '8 days' END
        WHERE id = $1`,
      [biz],
    );
    clearSubscriptionCache(biz);
  }
  const sinceOf = async (biz: string) =>
    (await queryOne<{ s: string | null; b: string | null }>(
      `SELECT over_limit_seats_since AS s, over_limit_branches_since AS b FROM businesses WHERE id = $1`, [biz]))!;

  const statuses = (rs: Response[]) => rs.map((r) => r.status).sort((x, y) => x - y);

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of createdBusinesses) {
        await query(`DELETE FROM expenses WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM recurring_invoices WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM invoices WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM user_branches WHERE user_id IN (SELECT id FROM users WHERE business_id = $1)`, [id]).catch(() => undefined);
        await query(`DELETE FROM branches WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM employees WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM user_businesses WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM users WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM user_roles WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      for (const id of createdPlans) await query(`DELETE FROM subscription_plans WHERE id = $1`, [id]).catch(() => undefined);
      await closePool();
    }
  });

  afterEach(() => {
    webAccessFailure.on = false;
  });

  describe('seats beyond the plan after a downgrade', () => {
    it('refuses the newest extra user at sign-in and on an existing session, never the owner; an upgrade restores access at once', async () => {
      const roomy = await makePlan('billing_growth', { max_users: 5 });
      const { biz, owner, ownerPhone } = await newBusiness(roomy);
      const oldest = await addUser(biz, 60);
      const middle = await addUser(biz, 30);
      const newest = await addUser(biz, 1);

      // Everyone fits the 5 seats: all sign in, all sessions pass.
      for (const u of [oldest, middle, newest]) expect((await login(u.phone)).status).toBe(200);
      // A sign-in on this plan starts a new session generation (single-device policy); use that generation below.
      await query(`UPDATE users SET auth_session_version = $2 WHERE business_id = $1`, [biz, SESSION_VERSION]);
      expect((await requireStrictSession(sessionRequest({ biz, userId: newest.id }))).ok).toBe(true);

      // Downgrade to 3 seats: owner, oldest, middle keep access; the newest is paused. Nothing is deleted.
      const small = await makePlan('billing_growth', { max_users: 3 });
      await setPlan(biz, small);

      // The first request after the downgrade starts a 7-day warning: nobody is paused yet, the time is recorded once,
      // and the owner gets one email naming who will be paused, the date, the choice screen and the upgrade link.
      sentEmails.length = 0;
      expect(await isUserSeatPaused(newest.id, biz)).toBe(false);
      expect((await login(newest.phone)).status).toBe(200);
      await query(`UPDATE users SET auth_session_version = $2 WHERE business_id = $1`, [biz, SESSION_VERSION]);
      const since = (await sinceOf(biz)).s;
      expect(since).not.toBeNull();
      for (let i = 0; i < 20 && sentEmails.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].text).toContain('User 1d');
      expect(sentEmails[0].text).toContain('/settings/over-limit-access');
      expect(sentEmails[0].text).toContain('/settings/subscription');
      expect(sentEmails[0].text).toMatch(/On \d{1,2} \w+ \d{4} these people will be paused/);
      clearSubscriptionCache(biz);
      await isUserSeatPaused(newest.id, biz);
      expect((await sinceOf(biz)).s).toEqual(since); // not rewritten
      expect(sentEmails).toHaveLength(1); // not repeated
      // The owner screen says who will be paused and when.
      const warn = await (await callRoute(getChoiceRoute as unknown as RouteHandler, { biz, userId: owner, path: '/api/settings/over-limit-access' })).json();
      expect(warn.seats.enforced).toBe(false);
      expect(warn.seats.users.filter((u: { will_pause: boolean }) => u.will_pause).map((u: { id: string }) => u.id)).toEqual([newest.id]);

      // 7 days later the warning has run out.
      await startEnforcement(biz);

      const refused = await login(newest.phone);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: 'SEAT_PAUSED', error: SEAT_PAUSED_MESSAGE });

      const session = await requireStrictSession(sessionRequest({ biz, userId: newest.id }));
      expect(session.ok).toBe(false);
      if (!session.ok) {
        expect(session.response.status).toBe(403);
        expect(await session.response.json()).toMatchObject({ code: 'SEAT_PAUSED', error: SEAT_PAUSED_MESSAGE });
      }
      headerBag.current = sessionRequest({ biz, userId: newest.id }).headers as unknown as Record<string, string>;
      headerBag.current = {
        'x-authenticated-user-id': newest.id,
        'x-authenticated-session-version': String(SESSION_VERSION),
      };
      await expect(assertSessionValidForCookieAuth(newest.id)).rejects.toMatchObject({ code: 'SEAT_PAUSED' });
      // The business-level authorize path refuses the same way.
      headerBag.current = {
        'x-authenticated-user-id': newest.id,
        'x-authenticated-business-id': biz,
        'x-authenticated-session-version': String(SESSION_VERSION),
      };
      await expect(authorize(newest.id, 'settings', 'read', { businessId: biz })).rejects.toMatchObject({ code: 'SEAT_PAUSED' });

      // The owner and the longer-standing users are untouched.
      expect((await login(ownerPhone)).status).toBe(200);
      expect((await login(oldest.phone)).status).toBe(200);
      expect((await login(middle.phone)).status).toBe(200);
      await query(`UPDATE users SET auth_session_version = $2 WHERE business_id = $1`, [biz, SESSION_VERSION]);
      expect((await requireStrictSession(sessionRequest({ biz, userId: owner }))).ok).toBe(true);
      expect(await isUserSeatPaused(owner, biz)).toBe(false);

      // Records and the login row are still there.
      expect((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users WHERE business_id = $1 AND is_active = true`, [biz]))!.n).toBe('4');

      // Upgrade: access is back on the very next request, with no job in between.
      await setPlan(biz, roomy);
      expect((await login(newest.phone)).status).toBe(200);
      expect((await sinceOf(biz)).s).toBeNull(); // back within the limit: the warning clock is cleared
      await query(`UPDATE users SET auth_session_version = $2 WHERE business_id = $1`, [biz, SESSION_VERSION]);
      expect((await requireStrictSession(sessionRequest({ biz, userId: newest.id }))).ok).toBe(true);
    });

    it('a seat count of 1 pauses everyone but the owner, whatever the order', async () => {
      const one = await makePlan('billing_growth', { max_users: 1 });
      const { biz, owner } = await newBusiness(one);
      const a = await addUser(biz, 90);
      await startEnforcement(biz);
      expect(await isUserSeatPaused(a.id, biz)).toBe(true);
      expect(await isUserSeatPaused(owner, biz)).toBe(false);
    });

    it("the owner's explicit choice is respected and validated", async () => {
      const small = await makePlan('billing_growth', { max_users: 3 });
      const { biz, owner } = await newBusiness(small);
      const oldest = await addUser(biz, 60);
      const middle = await addUser(biz, 30);
      const newest = await addUser(biz, 1);
      await startEnforcement(biz);
      expect(await isUserSeatPaused(newest.id, biz)).toBe(true); // default order

      // A non-owner cannot choose; a user from another business is refused; too many is refused.
      const staffTry = await callRoute(putChoiceRoute as unknown as RouteHandler, {
        biz, userId: oldest.id, method: 'PUT', path: '/api/settings/over-limit-access', body: { keep_user_ids: [oldest.id] },
      });
      expect(staffTry.status).toBe(403);

      const other = await newBusiness(small);
      const foreign = await callRoute(putChoiceRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'PUT', path: '/api/settings/over-limit-access', body: { keep_user_ids: [other.owner] },
      });
      expect(foreign.status).toBe(400);
      expect(await foreign.json()).toMatchObject({ code: 'NOT_FOUND' });

      const tooMany = await callRoute(putChoiceRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'PUT', path: '/api/settings/over-limit-access', body: { keep_user_ids: [oldest.id, middle.id, newest.id] },
      });
      expect(tooMany.status).toBe(400);
      expect(await tooMany.json()).toMatchObject({ code: 'TOO_MANY' });
      // A refused choice changes nothing.
      expect(await isUserSeatPaused(newest.id, biz)).toBe(true);

      // 3 seats = the owner + 2 chosen: keep the newest and the middle, pause the oldest.
      const ok = await callRoute(putChoiceRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'PUT', path: '/api/settings/over-limit-access', body: { keep_user_ids: [newest.id, middle.id] },
      });
      expect(ok.status).toBe(200);
      expect(await isUserSeatPaused(newest.id, biz)).toBe(false);
      expect(await isUserSeatPaused(middle.id, biz)).toBe(false);
      expect(await isUserSeatPaused(oldest.id, biz)).toBe(true);
      expect(await isUserSeatPaused(owner, biz)).toBe(false);

      // The owner screen lists who is paused and what the plan allows.
      const view = await (await callRoute(getChoiceRoute as unknown as RouteHandler, {
        biz, userId: owner, path: '/api/settings/over-limit-access',
      })).json();
      expect(view.seats).toMatchObject({ allowed: 3, used: 4, over_limit: true });
      expect(view.seats.users.filter((u: { paused: boolean }) => u.paused).map((u: { id: string }) => u.id)).toEqual([oldest.id]);
    });

    it('reactivating at the limit: two requests, one seat, exactly one succeeds', async () => {
      const three = await makePlan('billing_growth', { max_users: 3 });
      const { biz, owner } = await newBusiness(three);
      await addUser(biz, 20); // 2 of 3 seats used
      const a = await addUser(biz, 10, { active: false });
      const b = await addUser(biz, 5, { active: false });
      const reactivate = (id: string) =>
        callRoute(patchUserRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'PATCH', path: `/api/settings/users/${id}`, id, body: { is_active: true },
        });
      const rs = await Promise.all([reactivate(a.id), reactivate(b.id)]);
      expect(statuses(rs)).toEqual([200, 403]);
      expect(await rs.find((r) => r.status === 403)!.json()).toMatchObject({ code: 'SUBSCRIPTION_LIMIT_EXCEEDED' });
      expect((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users WHERE business_id = $1 AND is_active = true`, [biz]))!.n).toBe('3');
    });
  });

  describe('branches beyond the plan', () => {
    async function branchBusiness(maxBranches: number) {
      const plan = await makePlan('billing_business', { max_branches: maxBranches });
      const ctx = await newBusiness(plan);
      const mk = async (name: string, isDefault: boolean, ageDays: number, active = true) => {
        const id = (await queryOne<{ id: string }>(
          `INSERT INTO branches (business_id, name, is_default, is_active, created_at)
           VALUES ($1, $2, $3, $4, NOW() - ($5 || ' days')::interval) RETURNING id`,
          [ctx.biz, name, isDefault, active, String(ageDays)],
        ))!.id;
        // The owner may work in every branch (branch access is a separate rule from the plan limit).
        await query(
          `INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions)
           VALUES ($1, $2, true, true, true, true)`,
          [ctx.owner, id],
        );
        return id;
      };
      return { ...ctx, plan, mk };
    }

    it('the branch beyond the limit is read-only: writes are refused, reading is allowed; the oldest keep', async () => {
      const { biz, owner, mk } = await branchBusiness(2);
      const main = await mk('Main', true, 90);
      const second = await mk('Second', false, 60);
      const third = await mk('Third', false, 1);
      headerBag.current = sessionRequest({ biz, userId: owner }).headers as unknown as Record<string, string>;
      // During the 7-day warning nothing is read-only.
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: third })).resolves.toBeUndefined();
      await startEnforcement(biz);

      // Writing under the third branch: refused with a plain message, for everyone, the owner included.
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: third })).rejects.toMatchObject({ code: 'BRANCH_READ_ONLY' });
      await expect(authorize(owner, 'invoices', 'create', { businessId: biz, branchId: third })).rejects.toMatchObject({ code: 'BRANCH_READ_ONLY' });
      await expect(authorize(owner, 'invoices', 'update', { businessId: biz, branchId: third })).rejects.toMatchObject({ code: 'BRANCH_READ_ONLY' });
      try {
        await enforceAccess({ businessId: biz, userId: owner, branchId: third });
      } catch (e) {
        expect(e).toBeInstanceOf(EnforceAccessError);
        expect((e as Error).message).toMatch(/read-only/);
      }
      // A real write route (expense create) refuses before saving anything.
      const res = await callRoute(postExpenseRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'POST', path: '/api/expenses',
        body: {
          business_id: biz, branch_id: third, expense_date: '2026-11-20', amount: 10, description: 'Tea',
          category_id: randomUUID(), idempotency_key: randomUUID(), payment_mode: 'cash',
        },
      });
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'BRANCH_READ_ONLY' });
      expect((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM expenses WHERE business_id = $1`, [biz]))!.n).toBe('0');

      // Viewing works, and the default and second branches are writable.
      await expect(authorize(owner, 'invoices', 'read', { businessId: biz, branchId: third })).resolves.toBeUndefined();
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: third, branchPermission: 'view' })).resolves.toBeUndefined();
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: main })).resolves.toBeUndefined();
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: second })).resolves.toBeUndefined();
    });

    it("the owner's choice swaps which branch stays writable; validated against the limit; nothing is deleted", async () => {
      const { biz, owner, mk } = await branchBusiness(2);
      const main = await mk('Main', true, 90);
      const second = await mk('Second', false, 60);
      const third = await mk('Third', false, 1);
      headerBag.current = sessionRequest({ biz, userId: owner }).headers as unknown as Record<string, string>;
      await startEnforcement(biz);

      const tooMany = await callRoute(putChoiceRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'PUT', path: '/api/settings/over-limit-access', body: { keep_branch_ids: [second, third] },
      });
      expect(tooMany.status).toBe(400);
      expect(await tooMany.json()).toMatchObject({ code: 'TOO_MANY' });

      const ok = await callRoute(putChoiceRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'PUT', path: '/api/settings/over-limit-access', body: { keep_branch_ids: [third] },
      });
      expect(ok.status).toBe(200);
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: third })).resolves.toBeUndefined();
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: second })).rejects.toMatchObject({ code: 'BRANCH_READ_ONLY' });
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: main })).resolves.toBeUndefined(); // default never read-only
      expect((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM branches WHERE business_id = $1`, [biz]))!.n).toBe('3');

      // An upgrade makes every branch writable again at once.
      await setPlan(biz, await makePlan('billing_business', { max_branches: 5 }));
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: second })).resolves.toBeUndefined();
    });

    it('reactivating a branch at the limit: two requests, one slot, exactly one succeeds', async () => {
      const { biz, owner, mk } = await branchBusiness(2);
      await mk('Main', true, 90); // 1 of 2
      const a = await mk('Closed A', false, 30, false);
      const b = await mk('Closed B', false, 20, false);
      const reactivate = (id: string) =>
        callRoute(patchBranchRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'PATCH', path: `/api/branches/${id}`, id, body: { is_active: true },
        });
      const rs = await Promise.all([reactivate(a), reactivate(b)]);
      expect(statuses(rs)).toEqual([200, 403]);
      expect((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM branches WHERE business_id = $1 AND is_active = true`, [biz]))!.n).toBe('2');
    });
  });

  describe('Free plan web access on the server (SUB-19)', () => {
    const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) Chrome/120';
    const PHONE_APP = 'Mozilla/5.0 (Linux; Android 14) KhatarioPhone/1.0';

    it('a Free business gets the wall instead of the page; plan pages and the phone app stay open', async () => {
      const { biz, owner } = await newBusiness('free');
      const gate = (pathname: string, userAgent: string) =>
        resolveServerAppGate({ businessId: biz, userId: owner, pathname, userAgent });
      expect(await gate('/dashboard', BROWSER)).toBe('web_wall');
      expect(await gate('/invoices', BROWSER)).toBe('web_wall');
      expect(await gate('/settings/subscription', BROWSER)).toBe('open');
      expect(await gate('/dashboard', PHONE_APP)).toBe('open');

      // The server layout itself: the page is not rendered, the wall is (no JavaScript involved).
      headerBag.current = {
        'x-authenticated-business-id': biz,
        'x-authenticated-user-id': owner,
        'x-khatario-pathname': '/dashboard',
        'user-agent': BROWSER,
      };
      const page = { marker: 'page' };
      const element = (await AppRouteLayout({ children: page as unknown as React.ReactNode })) as { type: { name: string }; props: { children?: unknown } };
      expect(element.type.name).toBe('WebAccessWall');
      expect(JSON.stringify(element.props)).not.toContain('marker');
    });

    it('fails closed: a plan check error shows the retry screen, never the app', async () => {
      const paid = await makePlan('billing_starter', {});
      const { biz, owner } = await newBusiness(paid);
      webAccessFailure.on = true;
      expect(await resolveServerAppGate({ businessId: biz, userId: owner, pathname: '/dashboard', userAgent: BROWSER })).toBe('check_failed');
      headerBag.current = {
        'x-authenticated-business-id': biz,
        'x-authenticated-user-id': owner,
        'x-khatario-pathname': '/dashboard',
        'user-agent': BROWSER,
      };
      const element = (await AppRouteLayout({ children: null })) as { type: { name: string } };
      expect(element.type.name).toBe('PlanCheckFailedScreen');
      // The phone app is not gated by the web check at all.
      expect(await resolveServerAppGate({ businessId: biz, userId: owner, pathname: '/dashboard', userAgent: PHONE_APP })).toBe('open');
    });

    it('a Rs 1 paid plan has normal access', async () => {
      const paid = await makePlan('billing_starter', {}, 1);
      const { biz, owner } = await newBusiness(paid);
      expect(await resolveServerAppGate({ businessId: biz, userId: owner, pathname: '/dashboard', userAgent: BROWSER })).toBe('open');
      headerBag.current = {
        'x-authenticated-business-id': biz,
        'x-authenticated-user-id': owner,
        'x-khatario-pathname': '/dashboard',
        'user-agent': BROWSER,
      };
      const element = (await AppRouteLayout({ children: null })) as { type: { name: string } };
      expect(element.type.name).toBe('AppRouteShell');
    });

    it('a paused seat gets the notice from the server layout, not the page', async () => {
      const one = await makePlan('billing_starter', { max_users: 1 });
      const { biz } = await newBusiness(one);
      const extra = await addUser(biz, 10);
      await startEnforcement(biz);
      headerBag.current = {
        'x-authenticated-business-id': biz,
        'x-authenticated-user-id': extra.id,
        'x-khatario-pathname': '/dashboard',
        'user-agent': BROWSER,
      };
      const element = (await AppRouteLayout({ children: null })) as { type: { name: string } };
      expect(element.type.name).toBe('SeatPausedScreen');
    });
  });

  describe('a pause applies only to the business it was decided for (I1)', () => {
    async function threeBusinesses() {
      const oneSeat = await makePlan('billing_growth', { max_users: 1 });
      const roomy = await makePlan('billing_growth', { max_users: 5 });
      const A = await newBusiness(oneSeat);
      const B = await newBusiness(roomy);
      const C = await newBusiness(oneSeat);
      await addUser(C.biz, 400); // a longer-standing staff member in C, so the visitor ranks below them
      const U = await addUser(A.biz, 1); // newest in A: paused there
      await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'staff'), ($1, $3, 'staff')`, [U.id, B.biz, C.biz]);
      await startEnforcement(A.biz);
      await startEnforcement(C.biz);
      return { A, B, C, U };
    }

    it('login lands in a business that does not pause the person; refused only when every business does', async () => {
      const { A, B, C, U } = await threeBusinesses();
      expect(await isUserSeatPaused(U.id, A.biz)).toBe(true);
      const res = await login(U.phone);
      expect(res.status).toBe(200);
      expect((await queryOne<{ b: string }>(`SELECT business_id AS b FROM users WHERE id = $1`, [U.id]))!.b).toBe(B.biz);
      expect((await res.json()).business.id).toBe(B.biz);

      // Every business pauses this person: login is refused with the message.
      const V = await addUser(A.biz, 2);
      await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'staff')`, [V.id, C.biz]);
      const refused = await login(V.phone);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: 'SEAT_PAUSED', error: SEAT_PAUSED_MESSAGE });
      void C;
    });

    it('the business list and the switch never answer 401 because of a pause; switching INTO a pausing business is 403', async () => {
      const { A, B, C, U } = await threeBusinesses();
      // The session acts in A, where U is paused.
      const strict = await requireStrictSession(sessionRequest({ biz: A.biz, userId: U.id }));
      expect(strict.ok).toBe(false);
      const mine = await callRoute(myBusinessesRoute as unknown as RouteHandler, { biz: A.biz, userId: U.id, path: '/api/businesses/my' });
      expect(mine.status).toBe(200);
      expect((await mine.json()).businesses).toHaveLength(3);

      const intoC = await callRoute(switchBusinessRoute as unknown as RouteHandler, {
        biz: A.biz, userId: U.id, method: 'POST', path: '/api/businesses/switch', body: { business_id: C.biz },
      });
      expect(intoC.status).toBe(403);
      expect(await intoC.json()).toMatchObject({ code: 'SEAT_PAUSED', error: SEAT_PAUSED_MESSAGE });
      expect((await queryOne<{ b: string }>(`SELECT business_id AS b FROM users WHERE id = $1`, [U.id]))!.b).toBe(A.biz);

      const intoB = await callRoute(switchBusinessRoute as unknown as RouteHandler, {
        biz: A.biz, userId: U.id, method: 'POST', path: '/api/businesses/switch', body: { business_id: B.biz },
      });
      expect(intoB.status).toBe(200);
      // Acting in B the person is not refused.
      expect((await requireStrictSession(sessionRequest({ biz: B.biz, userId: U.id }))).ok).toBe(true);
    });
  });

  describe('a read-only branch blocks only new or edited sales, purchase and stock documents (I2)', () => {
    it('GST status, charges, export and filing, and a payment on an existing invoice pass; a new invoice is refused', async () => {
      const plan = await makePlan('billing_business', { max_branches: 1 });
      const { biz, owner } = await newBusiness(plan);
      const main = (await queryOne<{ id: string }>(
        `INSERT INTO branches (business_id, name, is_default, is_active, created_at) VALUES ($1, 'Main', true, true, NOW() - interval '90 days') RETURNING id`, [biz]))!.id;
      const second = (await queryOne<{ id: string }>(
        `INSERT INTO branches (business_id, name, is_default, is_active, created_at) VALUES ($1, 'Second', false, true, NOW() - interval '10 days') RETURNING id`, [biz]))!.id;
      for (const b of [main, second]) {
        await query(`INSERT INTO user_branches (user_id, branch_id, can_view, can_edit, can_delete, can_create_transactions) VALUES ($1, $2, true, true, true, true)`, [owner, b]);
      }
      await startEnforcement(biz);
      expect(await isBranchReadOnly(biz, second)).toBe(true);
      const notReadOnlyRefusal = async (res: Response) => {
        const body = await res.clone().json().catch(() => ({}));
        expect(body.code).not.toBe('BRANCH_READ_ONLY');
        return res;
      };
      const get = (handler: RouteHandler, p: string) =>
        callRoute(handler, { biz, userId: owner, path: `${p}${p.includes('?') ? '&' : '?'}branch_id=${second}` });

      const status = await notReadOnlyRefusal(await get(gstStatusRoute as unknown as RouteHandler, '/api/gst/status?period=2026-10'));
      expect(status.status).toBe(200);
      await notReadOnlyRefusal(await get(gstChargesRoute as unknown as RouteHandler, '/api/gst/charges?period=2026-10'));
      await notReadOnlyRefusal(await get(gstr3bExportRoute as unknown as RouteHandler, '/api/gst/gstr3b/export?period=2026-10'));
      const filing = await callRoute(gstFileRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'POST', path: '/api/gst/file', body: { branch_id: second, period: '2026-10', return_type: 'GSTR3B' },
      });
      await notReadOnlyRefusal(filing); // a validation answer is fine; the read-only branch must not be the reason

      // A payment against an existing invoice of the read-only branch is not stopped by the branch (it reaches the
      // invoice-state checks: a draft answers 409).
      const inv = (await queryOne<{ id: string }>(
        `INSERT INTO invoices (business_id, branch_id, invoice_number, invoice_date, status) VALUES ($1, $2, 'RO-1', CURRENT_DATE, 'draft') RETURNING id`, [biz, second]))!.id;
      const pay = await callRoute(invoicePaymentRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'PATCH', path: `/api/invoices/${inv}/payments`, id: inv, body: { amount: 10 },
      });
      expect(pay.status).toBe(409);
      expect((await pay.json()).code).not.toBe('BRANCH_READ_ONLY');
      // The same invoice may not be edited...
      headerBag.current = sessionRequest({ biz, userId: owner }).headers as unknown as Record<string, string>;
      await expect(authorize(owner, 'invoices', 'update', { businessId: biz, branchId: second, resourceId: inv })).rejects.toMatchObject({ code: 'BRANCH_READ_ONLY' });
      // ...and a new invoice is refused.
      await expect(authorize(owner, 'invoices', 'create', { businessId: biz, branchId: second })).rejects.toMatchObject({ code: 'BRANCH_READ_ONLY' });
      await expect(enforceAccess({ businessId: biz, userId: owner, branchId: second, feature: undefined })).rejects.toMatchObject({ code: 'BRANCH_READ_ONLY' });
      // Reads and journals/payments under the branch.
      await expect(authorize(owner, 'invoices', 'read', { businessId: biz, branchId: second })).resolves.toBeUndefined();
      await expect(authorize(owner, 'payments', 'create', { businessId: biz, branchId: second })).resolves.toBeUndefined();
      await query(`DELETE FROM invoices WHERE id = $1`, [inv]);
    });

    it('the recurring-invoice cron skips a schedule on a read-only branch and records why; delivery challans are refused', async () => {
      const plan = await makePlan('billing_business', { max_branches: 1 });
      const { biz } = await newBusiness(plan);
      await query(`INSERT INTO branches (business_id, name, is_default, is_active, created_at) VALUES ($1, 'Main', true, true, NOW() - interval '90 days')`, [biz]);
      const second = (await queryOne<{ id: string }>(
        `INSERT INTO branches (business_id, name, is_default, is_active, created_at) VALUES ($1, 'Second', false, true, NOW() - interval '10 days') RETURNING id`, [biz]))!.id;
      await startEnforcement(biz);
      const rec = (await queryOne<{ id: string }>(
        `INSERT INTO recurring_invoices (business_id, branch_id, frequency, start_date, next_run_date, items, is_active)
         VALUES ($1, $2, 'monthly', CURRENT_DATE - 40, CURRENT_DATE - 1, '[]'::jsonb, true) RETURNING id`, [biz, second]))!.id;
      const { runRecurringInvoices } = await import('@/lib/invoices/recurring');
      const { getPool } = await import('@/lib/db');
      const out = await runRecurringInvoices(getPool(), { today: new Date().toISOString().slice(0, 10), recurringId: rec });
      expect(out[0].message).toMatch(/read-only/);
      expect(out[0].created).toHaveLength(0);
      const row = (await queryOne<{ last_error: string | null; n: string }>(
        `SELECT last_error, (next_run_date = CURRENT_DATE - 1)::text AS n FROM recurring_invoices WHERE id = $1`, [rec]))!;
      expect(row.last_error).toMatch(/read-only/);
      expect(row.n).toBe('true'); // left unchanged: it resumes when the branch is writable again

      const { writeChallan } = await import('@/lib/delivery-challans/challan');
      await expect(
        writeChallan(getPool(), biz, { challan_date: '2026-11-20', customer_id: randomUUID(), branch_id: second, items: [] }),
      ).rejects.toThrow(/read-only/);
    });
  });

  describe('deploy-day safety (I5)', () => {
    it('branches get the same 7-day warning; scripts/check-over-limit.js counts them with no personal data', async () => {
      const plan = await makePlan('billing_growth', { max_branches: 1, max_users: 1 });
      const { biz, owner } = await newBusiness(plan);
      await query(`INSERT INTO branches (business_id, name, is_default, is_active, created_at) VALUES ($1, 'Main', true, true, NOW() - interval '90 days')`, [biz]);
      const second = (await queryOne<{ id: string }>(
        `INSERT INTO branches (business_id, name, is_default, is_active, created_at) VALUES ($1, 'Secret Branch Name', false, true, NOW() - interval '10 days') RETURNING id`, [biz]))!.id;
      const extra = await addUser(biz, 5);
      sentEmails.length = 0;
      expect(await isBranchReadOnly(biz, second)).toBe(false); // warning period: still writable
      expect((await sinceOf(biz)).b).not.toBeNull();
      for (let i = 0; i < 20 && sentEmails.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
      expect(sentEmails[0]?.text).toContain('Secret Branch Name');
      expect(sentEmails[0]?.text).toMatch(/will become read-only/);

      const url = new URL(process.env.PHASE2_TEST_DATABASE_URL!);
      const out = execFileSync('node', ['scripts/check-over-limit.js'], {
        env: { ...process.env, DB_HOST: url.hostname, DB_PORT: url.port, DB_USER: decodeURIComponent(url.username), DB_PASSWORD: decodeURIComponent(url.password), DB_NAME: url.pathname.slice(1), DB_SSL: 'false' },
        encoding: 'utf8',
      });
      expect(out).toMatch(new RegExp(`${plan} \\| 1 \\| 0 \\| 1 \\| 1 \\| 1 \\| 1`));
      expect(out).not.toContain('Secret Branch Name');
      expect(out).not.toContain(extra.phone);
      expect(out).not.toContain(owner);
    });
  });

  describe('seats gained on employee create are counted under the users lock (M6)', () => {
    it('two creates with a login and one free seat: exactly one succeeds, the refused one leaves nothing behind', async () => {
      const billing = await makePlan('billing_growth', { max_users: 3 });
      const hr = await makePlan('hr_starter', { max_employees: 50, max_users: 3 });
      const { biz, owner } = await newBusiness(billing);
      await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'hr', true, 'test')`, [biz]);
      await query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date) VALUES ($1, 'hr', $2, 'active', CURRENT_DATE)
         ON CONFLICT (business_id, module_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = 'active'`, [biz, hr]);
      clearSubscriptionCache(biz);
      clearModuleSubscriptionCache(biz);
      await addUser(biz, 30); // owner + 1 = 2 of 3 seats
      const role = (await queryOne<{ id: string }>(
        `INSERT INTO user_roles (business_id, role_name, role_key, is_system_role) VALUES ($1, 'Cashier', 'cashier', false) RETURNING id`, [biz]))!.id;
      const post = (n: number) =>
        callRoute(postEmployeeRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: '/api/employees',
          body: { name: `Racer ${n}`, phone: phone(), employee_code: `RC-${n}`, role_id: role, password: 'Racer-pw-12345' },
        });
      const rs = await Promise.all([post(1), post(2)]);
      expect(statuses(rs)).toEqual([201, 403]);
      expect(await rs.find((r) => r.status === 403)!.json()).toMatchObject({ code: 'SUBSCRIPTION_LIMIT_EXCEEDED', limit_type: 'users' });
      expect((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users WHERE business_id = $1 AND is_active = true`, [biz]))!.n).toBe('3');
      expect((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM users u WHERE u.business_id = $1 AND u.name LIKE 'Racer%'`, [biz]))!.n).toBe('1');
    });
  });

  it('migrations 483 and 484 ran twice without error and added their columns', async () => {
    const cols = await query(
      `SELECT table_name FROM information_schema.columns WHERE column_name = 'over_limit_keep' AND table_name IN ('users','branches')`,
    );
    expect(cols.rows.map((r: { table_name: string }) => r.table_name).sort()).toEqual(['branches', 'users']);
    // Silence the unused import lint for AuthorizationError (kept for readers who extend the suite).
    expect(AuthorizationError).toBeDefined();
  });
});
