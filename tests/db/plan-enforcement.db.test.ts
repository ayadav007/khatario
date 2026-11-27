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
// The platform "Supplier Hub visible" switch. Visible by default; one test turns it off.
jest.mock('@/lib/supplier-hub-visibility', () => ({ isSupplierHubVisible: jest.fn(async () => true) }));

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
import { runRecurringInvoices } from '@/lib/invoices/recurring';
import * as featureAccess from '@/lib/subscription/feature-access';
import { POST as postRecurringRoute } from '@/app/api/recurring-invoices/[id]/route';
import { processCampaign } from '@/lib/campaign-processor';
import { checkLimit, clearAddonCache } from '@/lib/subscription';
import { GET as getLedgerRoute } from '@/app/api/ledger/route';
import { POST as postEwayBillRoute } from '@/app/api/eway-bills/route';
import { POST as postEwayImportRoute } from '@/app/api/eway-bills/import/route';
import { PATCH as patchEwayBillRoute } from '@/app/api/eway-bills/[id]/route';
import { POST as postBusinessRoute } from '@/app/api/businesses/route';
import { authorize } from '@/lib/authorization';
import { getPool } from '@/lib/db';
import { readFileSync } from 'fs';
import { POST as convertCandidateRoute } from '@/app/api/hr/recruitment/candidates/[id]/convert/route';
import { POST as checkInRoute } from '@/app/api/employees/attendance/check-in/route';
import { POST as checkOutRoute } from '@/app/api/employees/attendance/check-out/route';
import { POST as faceRoute } from '@/app/api/employees/attendance/face-recognition/route';
import { AttendanceLimitError, ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE, recordCheckIn } from '@/lib/hr/attendance-punch';
import { attendanceDateYmd } from '@/lib/hr/attendance-date';
import { POST as restoreBackupRoute } from '@/app/api/backup/restore/route';
import { POST as postEmployeeRoute } from '@/app/api/employees/route';
import { decideRegularizationRequest } from '@/lib/hr/attendance-regularization';
import { serializeFaceEncoding } from '@/lib/face-recognition';
import { ownerHasOtherBusiness, provisionBusiness } from '@/lib/businesses/provision-business';
import { isSupplierHubVisible } from '@/lib/supplier-hub-visibility';
import { POST as postLeaveType } from '@/app/api/leave-types/route';
import { PATCH as patchLeaveType, DELETE as deleteLeaveType } from '@/app/api/leave-types/[id]/route';
import {
  GET as listJournalTemplates,
  POST as postJournalTemplate,
} from '@/app/api/journal-entries/templates/route';
import {
  GET as getJournalTemplate,
  PATCH as patchJournalTemplate,
  DELETE as deleteJournalTemplate,
} from '@/app/api/journal-entries/templates/[id]/route';
import { GET as listStockRequests, POST as postStockRequests } from '@/app/api/stock-requests/route';
import { PATCH as patchStockRequest } from '@/app/api/stock-requests/[id]/route';
import { GET as stockRequestSummary } from '@/app/api/stock-requests/summary/route';
import { GET as stockReorderSuggestions } from '@/app/api/stock-requests/reorder-suggestions/route';
import { GET as stockRequestEvents } from '@/app/api/stock-requests/[id]/events/route';
import { POST as linkStockRequest } from '@/app/api/stock-requests/[id]/link/route';
import { POST as respondStockRequest } from '@/app/api/stock-requests/[id]/respond/route';
import { POST as spawnUpstreamStockRequest } from '@/app/api/stock-requests/[id]/spawn-upstream/route';
import { GET as supplierDashboard } from '@/app/api/suppliers/dashboard/route';
import { GET as supplierDashboardAnalytics } from '@/app/api/suppliers/dashboard/analytics/route';
import { GET as supplierRequests } from '@/app/api/suppliers/requests/route';
import {
  GET as supplierThresholdsGet,
  POST as supplierThresholdsPost,
  DELETE as supplierThresholdsDelete,
} from '@/app/api/suppliers/thresholds/route';
import { POST as dismissLowStockAlert } from '@/app/api/suppliers/dashboard/dismiss-alert/route';
import { GET as supplierLookupCustomer } from '@/app/api/suppliers/lookup-customer/route';

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


  const RECURRING_RUN_DAY = '2026-06-15';
  const RECURRING_START = '2026-06-01';

  /**
   * A monthly recurring-invoice schedule of `biz` that is due on RECURRING_RUN_DAY (next_run_date =
   * RECURRING_START), with one inline item (no template invoice) and its own customer. Returns its id.
   * The table is recurring_invoices; the column is next_run_date.
   */
  async function makeDueSchedule(biz: string, opts: { autoFinalize?: boolean; start?: string } = {}): Promise<string> {
    const customerId = randomUUID();
    const id = randomUUID();
    await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Recurring cust', $3)`, [
      customerId, biz, phone(),
    ]);
    const owner = await queryOne<{ id: string }>(
      `SELECT id FROM users WHERE business_id = $1 AND is_primary_admin = true LIMIT 1`, [biz]);
    await query(
      `INSERT INTO recurring_invoices
         (id, business_id, customer_id, frequency, interval_value, start_date, next_run_date, items, created_by, auto_finalize)
       VALUES ($1, $2, $3, 'monthly', 1, $4, $4, $5::jsonb, $6, $7)`,
      [
        id, biz, customerId, opts.start ?? RECURRING_START,
        JSON.stringify([{ item_name: 'Monthly service', quantity: 1, unit_price: 1000, tax_rate: 18 }]),
        owner!.id, opts.autoFinalize ?? false,
      ],
    );
    return id;
  }

  async function scheduleRow(id: string) {
    return queryOne<{ next_run_date: string; last_run_date: string | null; is_active: boolean; last_error: string | null }>(
      `SELECT next_run_date::text, last_run_date::text, is_active, last_error FROM recurring_invoices WHERE id = $1`, [id]);
  }

  /** Run all due schedules as of RECURRING_RUN_DAY; returns the per-schedule summaries and how many were skipped for plan. */
  async function runRecurring() {
    // A cron run has no request: without this, headers() would still carry the last route call's user.
    noRequest.current = true;
    let summaries: Awaited<ReturnType<typeof runRecurringInvoices>>;
    try {
      summaries = await runRecurringInvoices(getPool(), { today: RECURRING_RUN_DAY });
    } finally {
      noRequest.current = false;
    }
    return { summaries, skippedNoPlan: summaries.filter((r) => r.skippedNoPlan).length };
  }

  /** A running WhatsApp campaign of `biz` with `recipients` pending recipients and no delay beyond the 1s minimum. */
  async function makeScheduledCampaign(biz: string, recipients = 2): Promise<string> {
    const id = randomUUID();
    await query(
      `INSERT INTO whatsapp_campaigns
         (id, business_id, name, message_type, message_text, status, total_recipients, pending_count,
          delay_between_messages, random_delay_jitter, batch_size, pause_between_batches, started_at)
       VALUES ($1, $2, 'Plan test campaign', 'text', 'Hello', 'running', $3, $3, 1, 0, 20, 0, CURRENT_TIMESTAMP)`,
      [id, biz, recipients],
    );
    for (let i = 0; i < recipients; i++) {
      await query(`INSERT INTO whatsapp_campaign_recipients (campaign_id, phone, name) VALUES ($1, $2, 'R')`, [id, phone()]);
    }
    return id;
  }

  async function campaignRow(id: string) {
    return queryOne<{ status: string; sent_count: number; pending_count: number; completed_at: string | null }>(
      `SELECT status, sent_count, pending_count, completed_at::text FROM whatsapp_campaigns WHERE id = $1`, [id]);
  }

  /** Enable Connect on `biz` with an active `connect` plan (the Connect gate of the campaign APIs). */
  async function enableConnect(biz: string, planId = 'connect'): Promise<void> {
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'connect', true, 'test')
       ON CONFLICT (business_id, module_key) DO UPDATE SET enabled = true`,
      [biz],
    );
    await setPlan(biz, 'connect', planId);
    clearAddonCache(biz);
  }

  /** Fill today's whatsapp_messages up to `left` messages short of the plan's daily limit. */
  async function leaveWhatsAppQuota(biz: string, left: number): Promise<void> {
    const check = await checkLimit(biz, 'whatsapp');
    for (let i = check.current; i < (check.limit as number) - left; i++) {
      await query(
        `INSERT INTO whatsapp_messages (business_id, to_number, message_type, status) VALUES ($1, $2, 'text', 'sent')`,
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
        await query(`DELETE FROM journal_entry_templates WHERE business_id = $1`, [id]).catch(() => undefined);
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
  describe('SUB-18: monthly e-Way bill quota', () => {
    let seq = 0;
    const uniqueEwb = () => {
      seq += 1;
      return `7${String(Date.now()).slice(-8)}${String(seq).padStart(3, '0')}`.slice(0, 12);
    };
    const payload = () => ({
      ewb_number: uniqueEwb(),
      distance_km: 120,
      generated_at: new Date(Date.now() - 3600_000).toISOString(),
    });
    const createEwayBill = (biz: string, userId: string, body: Record<string, unknown> = payload()) =>
      callRoute(postEwayBillRoute as unknown as RouteHandler, {
        biz, userId, method: 'POST', path: '/api/eway-bills', body,
      });
    /** Insert `n` e-way bill rows created now (the rows checkLimit counts). */
    async function fillEwayBills(biz: string, n: number): Promise<void> {
      for (let i = 0; i < n; i++) {
        await query(
          `INSERT INTO eway_bills (business_id, source_type, ewb_number, distance_km, generated_at)
           VALUES ($1, 'other', $2, 10, NOW())`,
          [biz, uniqueEwb()],
        );
      }
      clearSubscriptionCache(biz);
    }
    let biz: string;
    let owner: string;

    beforeEach(async () => {
      ({ biz, owner } = await newBusinessWithOwner('billing_starter', { label: 'sub18' }));
    });

    it('check-limit reports the quota', async () => {
      await fillEwayBills(biz, 10);
      expect(await checkLimit(biz, 'eway_bills')).toMatchObject({ limit: 10, current: 10, allowed: false });
    });

    it('below the quota an e-Way bill is recorded', async () => {
      await fillEwayBills(biz, 9);
      const res = await createEwayBill(biz, owner);
      expect(res.status).toBe(201);
      expect(await count(`eway_bills WHERE business_id = $1`, [biz])).toBe(10);
    });

    it('the 11th e-Way bill in a month is refused on Starter', async () => {
      await fillEwayBills(biz, 10);
      const res = await createEwayBill(biz, owner);
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({
        code: 'SUBSCRIPTION_LIMIT_EXCEEDED', limit_type: 'eway_bills', limit: 10, current: 10,
      });
      expect(await count(`eway_bills WHERE business_id = $1`, [biz])).toBe(10);
    });

    it('the quota counts by the server creation time, not the client generated_at', async () => {
      await fillEwayBills(biz, 10);
      const res = await createEwayBill(biz, owner, {
        ...payload(), generated_at: new Date(Date.now() - 40 * 86400_000).toISOString(),
      });
      expect(res.status).toBe(403);
    });

    it('last month does not count', async () => {
      await fillEwayBills(biz, 10);
      await query(`UPDATE eway_bills SET created_at = created_at - INTERVAL '40 days' WHERE business_id = $1`, [biz]);
      clearSubscriptionCache(biz);
      const res = await createEwayBill(biz, owner);
      expect(res.status).toBe(201);
    });

    it('Business plan is unlimited', async () => {
      await fillEwayBills(biz, 10);
      await setPlan(biz, 'billing', 'billing_business');
      const res = await createEwayBill(biz, owner);
      expect(res.status).toBe(201);
    });

    it('Growth allows 25', async () => {
      await setPlan(biz, 'billing', 'billing_growth');
      expect(await checkLimit(biz, 'eway_bills')).toMatchObject({ limit: 25, current: 0, allowed: true });
    });

    it('on Free the feature gate refuses before the limit', async () => {
      const free = await newBusinessWithOwner('free', { label: 'sub18free' });
      const res = await createEwayBill(free.biz, free.owner);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
    });

    it('editing an existing e-Way bill at the limit is not refused and does not count as new', async () => {
      const res0 = await createEwayBill(biz, owner);
      expect(res0.status).toBe(201);
      const id = (await res0.json()).eway_bill.id as string;
      await fillEwayBills(biz, 9);
      const res = await callRoute(patchEwayBillRoute as unknown as RouteHandler, {
        biz, userId: owner, method: 'PATCH', path: `/api/eway-bills/${id}`, params: { id },
        body: { action: 'vehicle', vehicle_number: 'MH12AB1234' },
      });
      expect(res.status).toBe(200);
      expect(await count(`eway_bills WHERE business_id = $1`, [biz])).toBe(10);
    });

    it('two simultaneous creates at 9 of 10 let exactly one through', async () => {
      await fillEwayBills(biz, 9);
      const results = await Promise.all([createEwayBill(biz, owner), createEwayBill(biz, owner)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 403]);
      expect(await count(`eway_bills WHERE business_id = $1`, [biz])).toBe(10);
    });

    describe('portal import', () => {
      async function purchaseFor(b: string, billNumber: string): Promise<void> {
        const sup = randomUUID();
        await query(`INSERT INTO suppliers (id, business_id, name, gstin) VALUES ($1, $2, 'Sup', '27AAAPA1234A1Z5')`, [sup, b]);
        await query(
          `INSERT INTO purchases (id, business_id, supplier_id, bill_number, bill_date, grand_total, status)
           VALUES ($1, $2, $3, $4, CURRENT_DATE, 100, 'received')`,
          [randomUUID(), b, sup, billNumber],
        );
      }
      const csvFor = (...bills: Array<[string, string]>) =>
        ['EWB No,EWB Date,From GSTIN,Doc No,Value,Distance']
          .concat(bills.map(([n, d]) => `${n},2026-11-27,27AAAPA1234A1Z5,${d},100,50`))
          .join('\n');
      const importCsv = (b: string, u: string, csv: string) =>
        callRoute(postEwayImportRoute as unknown as RouteHandler, {
          biz: b, userId: u, method: 'POST', path: '/api/eway-bills/import', body: { csv },
        });

      it('is refused at the limit', async () => {
        await fillEwayBills(biz, 10);
        await purchaseFor(biz, 'PB-1');
        const res = await importCsv(biz, owner, csvFor([uniqueEwb(), 'PB-1']));
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        expect(await count(`eway_bills WHERE business_id = $1`, [biz])).toBe(10);
      });

      it('stops at the limit part-way and reports what was left out', async () => {
        await fillEwayBills(biz, 9);
        await purchaseFor(biz, 'PB-1');
        await purchaseFor(biz, 'PB-2');
        const res = await importCsv(biz, owner, csvFor([uniqueEwb(), 'PB-1'], [uniqueEwb(), 'PB-2']));
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.matched).toHaveLength(1);
        expect(body.over_limit).toHaveLength(1);
        expect(await count(`eway_bills WHERE business_id = $1`, [biz])).toBe(10);
      });
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
  describe('SUB-22/23: employee and attendance limits on every write path; HR structure limits', () => {
    const startOfMonthDates = (n: number) =>
      `SELECT (CURRENT_DATE - (g || ' days')::interval)::date FROM generate_series(1, ${n}) g`;

    /** n attendance rows (created now, dated in the past) for one employee: fills the monthly quota. */
    async function fillAttendance(employeeId: string, n: number) {
      await query(
        `INSERT INTO employee_attendance (employee_id, date, status)
         SELECT $1, d, 'present' FROM (${startOfMonthDates(n)}) t(d)`,
        [employeeId],
      );
    }

    /** n further active employees in one statement (users first, then employees). */
    async function fillEmployees(biz: string, n: number) {
      await query(
        `WITH u AS (
           INSERT INTO users (id, business_id, name, phone, auth_session_version)
           SELECT uuid_generate_v4(), $1, 'Bulk ' || g, '8' || LPAD((floor(random()*1e9))::text, 9, '0') || g, 1
           FROM generate_series(1, $2) g RETURNING id
         )
         INSERT INTO employees (id, business_id, employee_code, access_type, is_active)
         SELECT id, $1, 'B-' || substr(id::text, 1, 8), 'attendance_only', true FROM u`,
        [biz, n],
      );
    }

    describe('employee limit', () => {
      let biz: string, owner: string, inactiveId: string, activeId: string;
      beforeAll(async () => {
        ({ biz, owner } = await newBusinessWithOwner('billing_growth', { hr: true, label: 'emp-limit' }));
        activeId = await addEmployee(biz);
        inactiveId = await addEmployee(biz, { isActive: false });
        await fillEmployees(biz, 29); // 30 active in total: HR Lite limit
        clearSubscriptionCache(biz);
      });

      it('reactivating an employee is refused at the limit', async () => {
        const res = await patchEmployee(biz, owner, inactiveId, { is_active: true });
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        const e = await queryOne<{ is_active: boolean }>(`SELECT is_active FROM employees WHERE id = $1`, [inactiveId]);
        expect(e!.is_active).toBe(false);
      });

      it('editing an active employee still works at the limit', async () => {
        const res = await patchEmployee(biz, owner, activeId, { designation: 'Senior' });
        expect(res.status).toBe(200);
      });

      it('re-sending is_active:true for an active employee is not refused', async () => {
        const res = await patchEmployee(biz, owner, activeId, { is_active: true });
        expect(res.status).toBe(200);
      });

      it('deactivating works at the limit, and then reactivating another succeeds', async () => {
        expect((await patchEmployee(biz, owner, activeId, { is_active: false })).status).toBe(200);
        clearSubscriptionCache(biz);
        const res = await patchEmployee(biz, owner, inactiveId, { is_active: true });
        expect(res.status).toBe(200);
      });
    });

    describe('candidate conversion', () => {
      let biz: string, owner: string, candidateId: string;
      beforeAll(async () => {
        ({ biz, owner } = await newBusinessWithOwner('billing_growth', { label: 'convert' }));
        await query(
          `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'hr', true, 'test')`,
          [biz],
        );
        await setPlan(biz, 'hr', 'hr_pro');
        const job = randomUUID();
        await query(`INSERT INTO recruitment_jobs (id, business_id, title) VALUES ($1, $2, 'Clerk')`, [job, biz]);
        candidateId = randomUUID();
        await query(
          `INSERT INTO recruitment_candidates (id, business_id, job_id, full_name, email, phone, status)
           VALUES ($1, $2, $3, 'Cand Idate', 'cand@example.com', '9123456780', 'offer_accepted')`,
          [candidateId, biz, job],
        );
        await query(
          `INSERT INTO recruitment_offer_letters (business_id, candidate_id, designation, joining_date, status, accepted_at, basic_salary)
           VALUES ($1, $2, 'Clerk', CURRENT_DATE, 'accepted', CURRENT_TIMESTAMP, 20000)`,
          [biz, candidateId],
        );
        await addEmployee(biz);
        await fillEmployees(biz, 199); // 200 active: HR Pro limit (one INSERT ... SELECT generate_series)
        clearSubscriptionCache(biz);
      });

      it('converting a candidate is refused at the employee limit and writes nothing', async () => {
        const usersBefore = await count('users WHERE business_id = $1', [biz]);
        const res = await callRoute(convertCandidateRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: `/api/hr/recruitment/candidates/${candidateId}/convert`,
          body: { physical_documents_verified: true }, params: { id: candidateId },
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        expect(body.limit_type).toBe('employees');
        expect(await count('users WHERE business_id = $1', [biz])).toBe(usersBefore);
        const c = await queryOne<{ employee_id: string | null }>(`SELECT employee_id FROM recruitment_candidates WHERE id = $1`, [candidateId]);
        expect(c!.employee_id).toBeNull();
      });

      it('converting succeeds once a slot is free and creates an active employee with the offer joining date', async () => {
        await query(`UPDATE employees SET is_active = false WHERE id = (SELECT id FROM employees WHERE business_id = $1 LIMIT 1)`, [biz]);
        clearSubscriptionCache(biz);
        const res = await callRoute(convertCandidateRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: `/api/hr/recruitment/candidates/${candidateId}/convert`,
          body: { physical_documents_verified: true }, params: { id: candidateId },
        });
        const body = await res.json();
        expect([res.status, body.error ?? '']).toEqual([200, '']);
        const e = await queryOne<{ is_active: boolean; jd: string }>(
          `SELECT is_active, joining_date::text AS jd FROM employees WHERE id = $1`, [body.employee_id],
        );
        const offerDay = await queryOne<{ d: string }>(
          `SELECT joining_date::text AS d FROM recruitment_offer_letters WHERE candidate_id = $1`, [candidateId],
        );
        expect(e!.is_active).toBe(true);
        expect(e!.jd).toBe(offerDay!.d);
      });
    });

    describe('reactivation through the settings users route', () => {
      let biz: string, owner: string, inactiveUser: string, loneUser: string;
      beforeAll(async () => {
        ({ biz, owner } = await newBusinessWithOwner('billing_growth', { hr: true, label: 'user-react' }));
        inactiveUser = await addUser(biz, { accessType: 'attendance_only', isActive: false });
        await query(`UPDATE employees SET is_active = false WHERE id = $1`, [inactiveUser]);
        loneUser = await addUser(biz, { isActive: false }); // no employees row
        await fillEmployees(biz, 30); // 30 active employees: HR Lite limit
        clearSubscriptionCache(biz);
      });
      const flags = async (id: string) => ({
        user: (await userRow(id))!.is_active,
        emp: (await queryOne<{ is_active: boolean }>(`SELECT is_active FROM employees WHERE id = $1`, [id]))?.is_active,
      });

      it('is refused at the employee limit and changes neither row', async () => {
        const res = await patchUser(biz, owner, inactiveUser, { is_active: true });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        expect(body.limit_type).toBe('employees');
        expect(await flags(inactiveUser)).toEqual({ user: false, emp: false });
      });

      it('a string "true" is treated as true (refused too)', async () => {
        const res = await patchUser(biz, owner, inactiveUser, { is_active: 'true' });
        expect(res.status).toBe(403);
        expect(await flags(inactiveUser)).toEqual({ user: false, emp: false });
      });

      it('a user with no employee row is not touched by the employee limit', async () => {
        const res = await patchUser(biz, owner, loneUser, { is_active: true });
        expect(res.status).toBe(200);
        expect((await userRow(loneUser))!.is_active).toBe(true);
      });

      it('succeeds below the limit and activates both rows', async () => {
        await query(`UPDATE employees SET is_active = false WHERE id = (SELECT id FROM employees WHERE business_id = $1 AND is_active AND id <> $2 LIMIT 1)`, [biz, inactiveUser]);
        clearSubscriptionCache(biz);
        const res = await patchUser(biz, owner, inactiveUser, { is_active: true });
        expect(res.status).toBe(200);
        expect(await flags(inactiveUser)).toEqual({ user: true, emp: true });
      });
    });

    describe('attendance limit on punch, face recognition and regularisation', () => {
      let biz: string, owner: string, filler: string, newcomer: string;
      beforeAll(async () => {
        // The disposable DB can lag migration 130 (notifications.user_id), which the push trigger reads.
        await query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE`);
        ({ biz, owner } = await newBusinessWithOwner('billing_growth', { hr: true, label: 'att-limit' }));
        await setPlan(biz, 'hr', 'hr_starter'); // face recognition needs the staff app feature; Starter: 1,600 per month
        filler = await addEmployee(biz);
        newcomer = await addEmployee(biz);
        await fillAttendance(filler, 1600);
        clearSubscriptionCache(biz);
      });

      it('a backdated attendance row counts this month (by created_at)', async () => {
        const b = await newBusinessWithOwner('billing_growth', { hr: true, label: 'att-backdate' });
        const emp = await addEmployee(b.biz);
        await query(`INSERT INTO employee_attendance (employee_id, date, status) VALUES ($1, '2020-01-01', 'present')`, [emp]);
        clearSubscriptionCache(b.biz);
        expect((await checkLimit(b.biz, 'attendance')).current).toBe(1);
      });

      it('the new-row check-in via the route is refused with the standard reply', async () => {
        const res = await callRoute(checkInRoute as unknown as RouteHandler, {
          biz, userId: newcomer, method: 'POST', path: '/api/employees/attendance/check-in', body: {},
        });
        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        expect(body.limit_type).toBe('attendance');
        expect(await count('employee_attendance WHERE employee_id = $1', [newcomer])).toBe(0);
      });

      it('recordCheckIn (kiosk / staff app) throws the typed limit error for a new row', async () => {
        await expect(
          recordCheckIn({ employeeId: newcomer, businessId: biz, method: 'staff_app' }),
        ).rejects.toBeInstanceOf(AttendanceLimitError);
      });

      it('face recognition does not insert a new row at the limit', async () => {
        const enc = new Float32Array(128).fill(0.5);
        await query(`INSERT INTO employee_face_data (employee_id, face_encoding) VALUES ($1, $2)`, [newcomer, serializeFaceEncoding(enc)]);
        const res = await callRoute(faceRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: '/api/employees/attendance/face-recognition',
          body: { face_encoding: serializeFaceEncoding(enc), action: 'check_in' },
        });
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        expect(await count('employee_attendance WHERE employee_id = $1', [newcomer])).toBe(0);
      });

      it('regularisation approval that would add a row is refused and stays pending', async () => {
        const manager = await addEmployee(biz);
        const reqId = randomUUID();
        await query(
          `INSERT INTO attendance_regularization_requests
             (id, business_id, employee_id, attendance_date, request_type, reason, requested_check_in, approver_user_id)
           VALUES ($1, $2, $3, CURRENT_DATE - 2000, 'missing_check_in', 'forgot', (CURRENT_DATE - 2000) + TIME '09:00', $4)`,
          [reqId, biz, newcomer, manager],
        );
        const r = await decideRegularizationRequest({
          requestId: reqId, businessId: biz, managerEmployeeId: manager, action: 'approve',
        });
        expect(r.ok).toBe(false);
        expect((r as { limit_exceeded?: unknown }).limit_exceeded).toBeDefined();
        const row = await queryOne<{ status: string }>(`SELECT status FROM attendance_regularization_requests WHERE id = $1`, [reqId]);
        expect(row!.status).toBe('pending');
        expect(await count('employee_attendance WHERE employee_id = $1', [newcomer])).toBe(0);
      });

      it('a check-in that updates the existing row for the day, and a check-out, are never refused', async () => {
        // The routes record the day in attendanceDateYmd() (IST), not the database's CURRENT_DATE.
        await query(`INSERT INTO employee_attendance (employee_id, date, status) VALUES ($1, $2::date, 'absent')`, [newcomer, attendanceDateYmd()]);
        const inRes = await callRoute(checkInRoute as unknown as RouteHandler, {
          biz, userId: newcomer, method: 'POST', path: '/api/employees/attendance/check-in', body: {},
        });
        expect(inRes.status).toBe(200);
        const outRes = await callRoute(checkOutRoute as unknown as RouteHandler, {
          biz, userId: newcomer, method: 'POST', path: '/api/employees/attendance/check-out', body: {},
        });
        expect(outRes.status).toBe(200);
      });

      it('regularisation onto an existing row for the day is not refused at the limit', async () => {
        // Own employee and own row, so the test passes when run alone (-t) and at any time of day.
        const day = attendanceDateYmd();
        const worker = await addEmployee(biz);
        await query(`INSERT INTO employee_attendance (employee_id, date, status) VALUES ($1, $2::date, 'absent')`, [worker, day]);
        const manager = await addEmployee(biz);
        const reqId = randomUUID();
        await query(
          `INSERT INTO attendance_regularization_requests
             (id, business_id, employee_id, attendance_date, request_type, reason, requested_check_in, approver_user_id)
           VALUES ($1, $2, $3, $4::date, 'override_check_in', 'fix', $4::date + TIME '09:00', $5)`,
          [reqId, biz, worker, day, manager],
        );
        const r = await decideRegularizationRequest({
          requestId: reqId, businessId: biz, managerEmployeeId: manager, action: 'approve',
        });
        expect(r.ok).toBe(true);
      });

      it('a refused punch tells the employee to tell the manager (not to upgrade) and notifies the business once per day', async () => {
        const b = await newBusinessWithOwner('billing_growth', { hr: true, label: 'att-msg' });
        await setPlan(b.biz, 'hr', 'hr_starter');
        const fill = await addEmployee(b.biz);
        await fillAttendance(fill, 1600);
        const e1 = await addEmployee(b.biz);
        const e2 = await addEmployee(b.biz);
        clearSubscriptionCache(b.biz);
        const notices = () =>
          count(`notifications WHERE business_id = $1 AND reference_type = 'attendance_limit'`, [b.biz]);

        const res1 = await callRoute(checkInRoute as unknown as RouteHandler, {
          biz: b.biz, userId: e1, method: 'POST', path: '/api/employees/attendance/check-in', body: {},
        });
        expect(res1.status).toBe(403);
        const body1 = await res1.json();
        expect(body1.code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        expect(body1.error).toBe(ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE);
        expect(body1.error).toBe(
          "Attendance could not be recorded: your employer's plan has reached its monthly attendance limit. Please tell your manager.",
        );
        expect(body1.error).not.toMatch(/upgrade/i);
        expect(await notices()).toBe(1);

        await expect(recordCheckIn({ employeeId: e2, businessId: b.biz, method: 'staff_app' })).rejects.toMatchObject({
          message: ATTENDANCE_LIMIT_EMPLOYEE_MESSAGE, code: 'limit_exceeded', status: 403,
        });
        expect(await notices()).toBe(1); // second refusal on the same day: no second notification
        const n = await queryOne<{ title: string; message: string; type: string }>(
          `SELECT title, message, type FROM notifications WHERE business_id = $1 AND reference_type = 'attendance_limit'`, [b.biz]);
        expect(n).toEqual({
          type: 'general',
          title: 'Monthly attendance limit reached',
          message: "Staff could not check in today because your plan's monthly attendance limit is used up. Upgrade your HR plan to continue.",
        });
      });
    });

    describe('payroll monthly count by entry time', () => {
      it('a backdated salary payment counts this month (by created_at)', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { hr: true, label: 'payroll-backdate' });
        const emp = await addEmployee(biz);
        await query(
          `INSERT INTO salary_payments (business_id, employee_id, salary_month, from_date, to_date, payment_date,
             basic_salary, total_earnings, gross_salary, net_salary)
           VALUES ($1, $2, '2020-01', '2020-01-01', '2020-01-31', '2020-01-31', 1, 1, 1, 1)`,
          [biz, emp],
        );
        clearSubscriptionCache(biz);
        expect((await checkLimit(biz, 'payroll')).current).toBe(1);
      });
    });

    describe('migration 478: HR plan structure limits', () => {
      const sql = () => readFileSync('database/migrations/478_hr_plan_structure_limits.sql', 'utf8');
      const limitFor = async (planId: string, key: string) =>
        (await queryOne<{ limit_value: number }>(
          `SELECT limit_value FROM subscription_plan_limits WHERE plan_id = $1 AND limit_key = $2`, [planId, key],
        ))?.limit_value;

      it('gives HR Pro and HR Trial unlimited, Starter and Lite the stated caps, and is idempotent', async () => {
        await query(sql());
        await query(sql());
        for (const k of ['max_holidays', 'max_shifts', 'max_designations', 'max_departments']) {
          expect(await limitFor('hr_pro', k)).toBe(-1);
          expect(await limitFor('hr_trial', k)).toBe(-1);
        }
        for (const plan of ['hr_starter', 'hr_staff_lite']) {
          expect(await limitFor(plan, 'max_holidays')).toBe(30);
          expect(await limitFor(plan, 'max_shifts')).toBe(10);
          expect(await limitFor(plan, 'max_designations')).toBe(20);
          expect(await limitFor(plan, 'max_departments')).toBe(10);
        }
      });

      it('HR Pro has unlimited shifts after the migration', async () => {
        await query(sql());
        const { biz } = await newBusinessWithOwner('billing_growth', { hr: true, label: 'mig478' });
        await setPlan(biz, 'hr', 'hr_pro');
        expect((await checkLimit(biz, 'shifts')).limit).toBe(-1);
        expect((await checkLimit(biz, 'departments')).limit).toBe(-1);
      });
    });
  });

  describe('SUB-21: routes on gated features check the role permission and the plan', () => {
    type Group = 'leave' | 'ledger' | 'hub';
    type Row = {
      name: string;
      group: Group;
      method: string;
      handler: RouteHandler;
      path: (biz: string) => string;
      body?: (biz: string) => Record<string, unknown>;
      params?: { id: string };
      /** Statuses that prove the guard was passed (the handler ran to its own answer). */
      passed: number[];
    };
    const ghost = randomUUID();
    const tplBody = () => ({
      name: `T-${randomUUID().slice(0, 6)}`,
      lines: [
        { account_id: randomUUID(), debit: 10, credit: 0 },
        { account_id: randomUUID(), debit: 0, credit: 10 },
      ],
    });
    const h = (fn: unknown) => fn as RouteHandler;

    const rows: Row[] = [
      // Leave types: GET /api/leave-types already authorizes the session user, so only the writes are listed.
      { name: 'POST leave-types', group: 'leave', method: 'POST', handler: h(postLeaveType), path: () => '/api/leave-types',
        body: () => ({ leave_name: 'X', leave_code: `X${randomUUID().slice(0, 4)}` }), passed: [201] },
      { name: 'PATCH leave-types/[id]', group: 'leave', method: 'PATCH', handler: h(patchLeaveType),
        path: () => `/api/leave-types/${ghost}`, params: { id: ghost }, body: () => ({ leave_name: 'Y' }), passed: [404] },
      { name: 'DELETE leave-types/[id]', group: 'leave', method: 'DELETE', handler: h(deleteLeaveType),
        path: () => `/api/leave-types/${ghost}`, params: { id: ghost }, passed: [404] },
      // Journal templates (path /api/journal-entries maps to advanced_ledger).
      { name: 'GET journal templates', group: 'ledger', method: 'GET', handler: h(listJournalTemplates),
        path: () => '/api/journal-entries/templates', passed: [200] },
      { name: 'POST journal templates', group: 'ledger', method: 'POST', handler: h(postJournalTemplate),
        path: () => '/api/journal-entries/templates', body: tplBody, passed: [201] },
      { name: 'GET journal templates/[id]', group: 'ledger', method: 'GET', handler: h(getJournalTemplate),
        path: () => `/api/journal-entries/templates/${ghost}`, params: { id: ghost }, passed: [404] },
      { name: 'PATCH journal templates/[id]', group: 'ledger', method: 'PATCH', handler: h(patchJournalTemplate),
        path: () => `/api/journal-entries/templates/${ghost}`, params: { id: ghost }, body: () => ({ name: 'Z' }), passed: [404] },
      { name: 'DELETE journal templates/[id]', group: 'ledger', method: 'DELETE', handler: h(deleteJournalTemplate),
        path: () => `/api/journal-entries/templates/${ghost}`, params: { id: ghost }, passed: [404] },
      // Supplier Hub: stock requests.
      { name: 'GET stock-requests', group: 'hub', method: 'GET', handler: h(listStockRequests),
        path: () => '/api/stock-requests', passed: [200] },
      { name: 'POST stock-requests', group: 'hub', method: 'POST', handler: h(postStockRequests),
        path: () => '/api/stock-requests', body: () => ({ requests: [] }), passed: [400] },
      { name: 'PATCH stock-requests/[id]', group: 'hub', method: 'PATCH', handler: h(patchStockRequest),
        path: () => `/api/stock-requests/${ghost}`, params: { id: ghost }, body: () => ({ responder_item_id: ghost }), passed: [404] },
      { name: 'GET stock-requests/summary', group: 'hub', method: 'GET', handler: h(stockRequestSummary),
        path: () => '/api/stock-requests/summary', passed: [200] },
      { name: 'GET stock-requests/reorder-suggestions', group: 'hub', method: 'GET', handler: h(stockReorderSuggestions),
        path: () => '/api/stock-requests/reorder-suggestions', passed: [200] },
      { name: 'GET stock-requests/[id]/events', group: 'hub', method: 'GET', handler: h(stockRequestEvents),
        path: () => `/api/stock-requests/${ghost}/events`, params: { id: ghost }, passed: [404] },
      { name: 'POST stock-requests/[id]/link', group: 'hub', method: 'POST', handler: h(linkStockRequest),
        path: () => `/api/stock-requests/${ghost}/link`, params: { id: ghost }, body: () => ({ purchase_order_id: ghost }), passed: [404] },
      { name: 'POST stock-requests/[id]/respond', group: 'hub', method: 'POST', handler: h(respondStockRequest),
        path: () => `/api/stock-requests/${ghost}/respond`, params: { id: ghost }, body: () => ({ status: 'declined' }), passed: [404] },
      { name: 'POST stock-requests/[id]/spawn-upstream', group: 'hub', method: 'POST', handler: h(spawnUpstreamStockRequest),
        path: () => `/api/stock-requests/${ghost}/spawn-upstream`, params: { id: ghost },
        body: () => ({ upstream_business_id: ghost, requested_qty: 1 }), passed: [404] },
      // Supplier Hub: dashboards and lookups.
      { name: 'GET suppliers/dashboard', group: 'hub', method: 'GET', handler: h(supplierDashboard),
        path: () => '/api/suppliers/dashboard', passed: [200] },
      { name: 'GET suppliers/dashboard/analytics', group: 'hub', method: 'GET', handler: h(supplierDashboardAnalytics),
        path: () => '/api/suppliers/dashboard/analytics', passed: [200] },
      { name: 'GET suppliers/requests', group: 'hub', method: 'GET', handler: h(supplierRequests),
        path: () => '/api/suppliers/requests', passed: [200] },
      { name: 'GET suppliers/lookup-customer', group: 'hub', method: 'GET', handler: h(supplierLookupCustomer),
        path: (biz) => `/api/suppliers/lookup-customer?supplier_business_id=${biz}&customer_name=nobody`, passed: [404] },
      { name: 'GET suppliers/thresholds', group: 'hub', method: 'GET', handler: h(supplierThresholdsGet),
        path: () => '/api/suppliers/thresholds', passed: [200] },
      { name: 'POST suppliers/thresholds', group: 'hub', method: 'POST', handler: h(supplierThresholdsPost),
        path: () => '/api/suppliers/thresholds', body: () => ({}), passed: [410] },
      { name: 'DELETE suppliers/thresholds', group: 'hub', method: 'DELETE', handler: h(supplierThresholdsDelete),
        path: () => `/api/suppliers/thresholds?id=${ghost}`, passed: [404] },
      { name: 'POST suppliers/dashboard/dismiss-alert', group: 'hub', method: 'POST', handler: h(dismissLowStockAlert),
        path: () => `/api/suppliers/dashboard/dismiss-alert?alert_id=${ghost}`, passed: [404] },
    ];

    const fx = {} as Record<Group, {
      low: { biz: string; owner: string };
      full: { biz: string; owner: string };
      noPerm: string;
    }>;

    beforeAll(async () => {
      const mk = async (g: Group, lowPlan: string, fullPlan: string, hr = false) => {
        const low = hr
          ? await newBusinessWithOwner('billing_growth', { hr: true, label: `s21-${g}-low` })
          : await newBusinessWithOwner(lowPlan, { label: `s21-${g}-low` });
        const full = hr
          ? await newBusinessWithOwner('billing_growth', { hr: true, label: `s21-${g}-full` })
          : await newBusinessWithOwner(fullPlan, { label: `s21-${g}-full` });
        if (hr) {
          await setPlan(low.biz, 'hr', lowPlan);
          await setPlan(full.biz, 'hr', fullPlan);
        }
        const roleId = await makeRole(full.biz, 'no_permissions');
        const noPerm = await addUser(full.biz, { roleId });
        fx[g] = { low, full, noPerm };
      };
      await mk('leave', 'hr_starter', 'hr_pro', true);
      await mk('ledger', 'billing_starter', 'billing_growth');
      await mk('hub', 'free', 'billing_starter');
    });

    const call = (r: Row, biz: string, userId: string, sessionVersion?: number) =>
      callRoute(r.handler, {
        biz, userId, method: r.method, path: r.path(biz), body: r.body?.(biz), params: r.params, sessionVersion,
      });

    describe.each(rows.map((r) => [r.name, r] as const))('%s', (_n, r) => {
      it('is refused on a plan without the feature (FEATURE_NOT_IN_PLAN)', async () => {
        const { low } = fx[r.group];
        const res = await call(r, low.biz, low.owner);
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
      });

      it('is refused (403) for a user whose role lacks the permission, on a plan that has the feature', async () => {
        const { full, noPerm } = fx[r.group];
        const res = await call(r, full.biz, noPerm, 1);
        expect(res.status).toBe(403);
        expect((await res.json()).code).not.toBe('FEATURE_NOT_IN_PLAN');
      });

      it('passes the guard for the owner on a plan with the feature', async () => {
        const { full } = fx[r.group];
        const res = await call(r, full.biz, full.owner);
        expect(r.passed).toContain(res.status);
      });
    });

    describe('leave types: the seeded HR Admin shape (view, add, modify; no delete) can manage them', () => {
      const leaveModuleInsertedByTest = { v: false };
      afterAll(async () => {
        // Put the shared permission_modules seed back as it was before this block.
        if (!leaveModuleInsertedByTest.v) return;
        try {
          await query(
            `DELETE FROM role_permissions WHERE module_key = 'leave_requests'
               AND role_id IN (SELECT id FROM user_roles WHERE role_key IN ('lt_viewer', 'lt_hr_admin'))`,
          );
          await query(`DELETE FROM permission_modules WHERE module_key = 'leave_requests'`);
        } catch {
          /* still referenced by another role: leave it */
        }
      });
      const asRole = async (viewOnly: boolean) => {
        const { full } = fx.leave;
        const roleId = await makeRole(full.biz, viewOnly ? 'lt_viewer' : 'lt_hr_admin');
        const insertedModule = await queryOne<{ module_key: string }>(
          `INSERT INTO permission_modules (module_key, module_name, is_active) VALUES ('leave_requests', 'leave_requests', true)
           ON CONFLICT (module_key) DO NOTHING RETURNING module_key`,
        );
        if (insertedModule) leaveModuleInsertedByTest.v = true; // shared seed row: removed again in afterAll
        await query(`DELETE FROM role_permissions WHERE role_id = $1`, [roleId]);
        await query(
          `INSERT INTO role_permissions (role_id, module_key, can_view, can_add, can_modify, can_delete, can_share)
           VALUES ($1, 'leave_requests', true, $2, $2, false, false)`,
          [roleId, !viewOnly],
        );
        return { biz: full.biz, user: await addUser(full.biz, { roleId }) };
      };
      const doAll = async (biz: string, user: string) => {
        const codeA = `HA${randomUUID().slice(0, 4)}`;
        const post = await callRoute(postLeaveType as unknown as RouteHandler, {
          biz, userId: user, method: 'POST', path: '/api/leave-types', sessionVersion: 1,
          body: { leave_name: 'HA', leave_code: codeA },
        });
        const id = post.status === 201 ? (await post.json()).leave_type.id : randomUUID();
        const patch = await callRoute(patchLeaveType as unknown as RouteHandler, {
          biz, userId: user, method: 'PATCH', path: `/api/leave-types/${id}`, params: { id }, sessionVersion: 1,
          body: { leave_name: 'HA2' },
        });
        const del = await callRoute(deleteLeaveType as unknown as RouteHandler, {
          biz, userId: user, method: 'DELETE', path: `/api/leave-types/${id}`, params: { id }, sessionVersion: 1,
        });
        return [post.status, patch.status, del.status];
      };
      it('HR Admin: create, edit and delete all succeed', async () => {
        const { biz, user } = await asRole(false);
        expect(await doAll(biz, user)).toEqual([201, 200, 200]);
      });
      it('a view-only role gets 403 on all three', async () => {
        const { biz, user } = await asRole(true);
        expect(await doAll(biz, user)).toEqual([403, 403, 403]);
      });
    });

    it('a refused leave-type create writes nothing', async () => {
      const { low } = fx.leave;
      await callRoute(postLeaveType as unknown as RouteHandler, {
        biz: low.biz, userId: low.owner, method: 'POST', path: '/api/leave-types',
        body: { leave_name: 'Nope', leave_code: 'NOPE' },
      });
      expect(await count('leave_types WHERE business_id = $1', [low.biz])).toBe(0);
    });

    it('a refused journal template create writes nothing', async () => {
      const { low } = fx.ledger;
      await callRoute(postJournalTemplate as unknown as RouteHandler, {
        biz: low.biz, userId: low.owner, method: 'POST', path: '/api/journal-entries/templates', body: tplBody(),
      });
      expect(await count('journal_entry_templates WHERE business_id = $1', [low.biz])).toBe(0);
    });

    it('a hub route returns 404 FEATURE_HIDDEN while the platform Supplier Hub switch is off', async () => {
      const { full } = fx.hub;
      jest.mocked(isSupplierHubVisible).mockResolvedValueOnce(false);
      const res = await callRoute(supplierDashboard as unknown as RouteHandler, {
        biz: full.biz, userId: full.owner, method: 'GET', path: '/api/suppliers/dashboard',
      });
      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe('FEATURE_HIDDEN');
    });

    describe('stock requests between businesses A (requester), B (responder) and C (not a party)', () => {
      let A: { biz: string; owner: string }, B: { biz: string; owner: string }, C: { biz: string; owner: string };
      let requestId: string;
      beforeAll(async () => {
        A = await newBusinessWithOwner('billing_starter', { label: 's21-A' });
        B = await newBusinessWithOwner('billing_starter', { label: 's21-B' });
        C = await newBusinessWithOwner('billing_starter', { label: 's21-C' });
        const itemId = randomUUID();
        await query(
          `INSERT INTO items (id, business_id, name, item_type, unit, selling_price, purchase_price, tax_rate, current_stock)
           VALUES ($1, $2, 'Widget', 'goods', 'PCS', 10, 5, 0, 0)`,
          [itemId, A.biz],
        );
        requestId = randomUUID();
        await query(
          `INSERT INTO quantity_requests (id, requester_business_id, responder_business_id, item_id, requested_qty, status)
           VALUES ($1, $2, $3, $4, 5, 'pending')`,
          [requestId, A.biz, B.biz, itemId],
        );
      });
      afterAll(async () => {
        await query(`DELETE FROM quantity_requests WHERE id = $1`, [requestId]).catch(() => undefined);
      });

      it('C cannot read the request events', async () => {
        const res = await callRoute(stockRequestEvents as unknown as RouteHandler, {
          biz: C.biz, userId: C.owner, method: 'GET', path: `/api/stock-requests/${requestId}/events`, params: { id: requestId },
        });
        expect(res.status).toBe(403);
      });

      it('C does not see it in the list', async () => {
        const res = await callRoute(listStockRequests as unknown as RouteHandler, {
          biz: C.biz, userId: C.owner, method: 'GET', path: '/api/stock-requests',
        });
        expect(res.status).toBe(200);
        expect((await res.json()).requests.map((x: { id: string }) => x.id)).not.toContain(requestId);
      });

      it('C cannot respond, and the request stays pending', async () => {
        const res = await callRoute(respondStockRequest as unknown as RouteHandler, {
          biz: C.biz, userId: C.owner, method: 'POST', path: `/api/stock-requests/${requestId}/respond`,
          params: { id: requestId }, body: { status: 'declined' },
        });
        expect(res.status).toBe(403);
        const row = await queryOne<{ status: string }>(`SELECT status FROM quantity_requests WHERE id = $1`, [requestId]);
        expect(row!.status).toBe('pending');
      });

      it('A (requester) cannot respond to its own request', async () => {
        const res = await callRoute(respondStockRequest as unknown as RouteHandler, {
          biz: A.biz, userId: A.owner, method: 'POST', path: `/api/stock-requests/${requestId}/respond`,
          params: { id: requestId }, body: { status: 'declined' },
        });
        expect(res.status).toBe(403);
      });

      it('B (responder, on its own plan) can see and decline it', async () => {
        const ev = await callRoute(stockRequestEvents as unknown as RouteHandler, {
          biz: B.biz, userId: B.owner, method: 'GET', path: `/api/stock-requests/${requestId}/events`, params: { id: requestId },
        });
        expect(ev.status).toBe(200);
        const res = await callRoute(respondStockRequest as unknown as RouteHandler, {
          biz: B.biz, userId: B.owner, method: 'POST', path: `/api/stock-requests/${requestId}/respond`,
          params: { id: requestId }, body: { status: 'declined' },
        });
        expect(res.status).toBeLessThan(300);
      });

      it('the plan checked is the caller\'s own: B on Free is refused although A has the hub', async () => {
        await setPlan(B.biz, 'billing', 'free');
        const res = await callRoute(stockRequestEvents as unknown as RouteHandler, {
          biz: B.biz, userId: B.owner, method: 'GET', path: `/api/stock-requests/${requestId}/events`, params: { id: requestId },
        });
        expect(res.status).toBe(403);
        expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
        // A's own access is untouched.
        const a = await callRoute(stockRequestEvents as unknown as RouteHandler, {
          biz: A.biz, userId: A.owner, method: 'GET', path: `/api/stock-requests/${requestId}/events`, params: { id: requestId },
        });
        expect(a.status).toBe(200);
      });
    });
  });

  describe('SUB-20: automation checks the plan when it runs', () => {
    describe('recurring invoices', () => {
      it('a due schedule is skipped after the plan drops below Growth; its due period is dropped and nothing back-fills when the plan returns', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { label: 'rec1' });
        const sched = await makeDueSchedule(biz);
        await setPlan(biz, 'billing', 'billing_starter');
        const r1 = await runRecurring();
        expect(r1.skippedNoPlan).toBeGreaterThanOrEqual(1);
        expect(r1.summaries.find((r) => r.recurring_invoice_id === sched)).toMatchObject({
          skippedNoPlan: true, created: [], droppedThrough: '2026-07-01',
        });
        expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(0);
        // only next_run_date moved (2026-06-01 -> 2026-07-01); still active, no run, no error, no history
        expect(await scheduleRow(sched)).toEqual({
          next_run_date: '2026-07-01', last_run_date: null, is_active: true, last_error: null,
        });
        expect(await count(`recurring_invoice_history WHERE recurring_invoice_id = $1`, [sched])).toBe(0);

        await setPlan(biz, 'billing', 'billing_growth');
        const r2 = await runRecurring();
        const ran = r2.summaries.find((r) => r.recurring_invoice_id === sched);
        expect(ran).toBeUndefined(); // not due yet: no back-fill of the dropped period
        expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(0);

        await query(`UPDATE recurring_invoices SET next_run_date = $2::date WHERE id = $1`, [sched, RECURRING_RUN_DAY]);
        const r3 = await runRecurring();
        const s3 = r3.summaries.find((r) => r.recurring_invoice_id === sched)!;
        expect(s3.skippedNoPlan).toBe(false);
        expect(s3.error).toBeUndefined();
        expect(s3.created).toHaveLength(1);
        expect(await count(`invoices WHERE business_id = $1 AND invoice_date = $2::date`, [biz, RECURRING_RUN_DAY])).toBe(1);
        expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(1);
      });

      it('an expired-but-not-yet-graced paying customer loses nothing: schedule untouched, then generated once grace is stamped', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { label: 'recGrace' });
        const sched = await makeDueSchedule(biz);
        // paid period ended yesterday; the nightly job has not stamped grace_period_end yet
        await setPlan(biz, 'billing', 'billing_growth', { end_date: '-1 day' });
        const before = await scheduleRow(sched);
        const r1 = await runRecurring();
        const s1 = r1.summaries.find((x) => x.recurring_invoice_id === sched)!;
        expect(s1).toMatchObject({ skippedSubscriptionInactive: true, skippedNoPlan: false, created: [] });
        expect(s1.droppedThrough).toBeUndefined();
        expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(0);
        expect(await scheduleRow(sched)).toEqual(before);
        expect(await count(`recurring_invoice_history WHERE recurring_invoice_id = $1`, [sched])).toBe(0);

        await setPlan(biz, 'billing', 'billing_growth', { end_date: '-1 day', grace_period_end: '+6 days' });
        const r2 = await runRecurring();
        const s2 = r2.summaries.find((x) => x.recurring_invoice_id === sched)!;
        expect(s2.skippedSubscriptionInactive).toBeUndefined();
        expect(s2.created).toHaveLength(1);
        expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(1);
      });

      it('a disabled billing module (plan has the feature) never drops periods', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { hr: true, label: 'recModOff' }); // another product must stay enabled, as /api/modules/disable requires
        const sched = await makeDueSchedule(biz);
        await query(`UPDATE business_modules SET enabled = false WHERE business_id = $1 AND module_key = 'billing'`, [biz]);
        clearSubscriptionCache(biz);
        clearModuleSubscriptionCache(biz);
        const before = await scheduleRow(sched);
        const s1 = (await runRecurring()).summaries.find((x) => x.recurring_invoice_id === sched)!;
        expect(s1).toMatchObject({ skippedSubscriptionInactive: true, skippedNoPlan: false, created: [] });
        expect(await scheduleRow(sched)).toEqual(before);
      });

      it('a calendar-expired trial (entitlement falls to free) is still dropped', async () => {
        const { biz } = await newBusinessWithOwner('trial', { label: 'recTrialExp' });
        const sched = await makeDueSchedule(biz);
        await query(
          `UPDATE business_module_subscriptions SET status = 'trial', trial_end_date = CURRENT_DATE - 3
            WHERE business_id = $1 AND module_key = 'billing'`, [biz]);
        clearSubscriptionCache(biz);
        clearModuleSubscriptionCache(biz);
        const s1 = (await runRecurring()).summaries.find((x) => x.recurring_invoice_id === sched)!;
        expect(s1.skippedNoPlan).toBe(true);
        expect((await scheduleRow(sched))!.next_run_date).toBe('2026-07-01');
      });

      it('an operational plan whose feature matrix is empty is not proof: schedule untouched', async () => {
        const planId = `tmp_empty_${randomUUID().slice(0, 8)}`;
        const tmpl = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM subscription_plans WHERE id = 'billing_starter'`);
        expect(tmpl!.n).toBe('1');
        // A throwaway plan row copied from Starter, with no subscription_plan_features rows. Removed in finally.
        await query(
          `INSERT INTO subscription_plans SELECT (json_populate_record(null::subscription_plans,
             (to_jsonb(p) || jsonb_build_object('id', $1::text))::json)).* FROM subscription_plans p WHERE p.id = 'billing_starter'`,
          [planId]);
        try {
          const { biz } = await newBusinessWithOwner('billing_starter', { label: 'recEmpty' });
          await setPlan(biz, 'billing', planId);
          const sched = await makeDueSchedule(biz);
          const before = await scheduleRow(sched);
          const errLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
          let s1;
          try {
            s1 = (await runRecurring()).summaries.find((x) => x.recurring_invoice_id === sched)!;
          } finally {
            errLog.mockRestore();
          }
          expect(s1.skippedNoPlan).toBe(false);
          expect(await scheduleRow(sched)).toEqual(before);
        } finally {
          await query(`DELETE FROM business_module_subscriptions WHERE plan_id = $1`, [planId]);
          await query(`DELETE FROM subscription_plans WHERE id = $1`, [planId]);
        }
      });

      it('a monthly schedule six months overdue on a plan without the feature jumps to the first date after today', async () => {
        const { biz } = await newBusinessWithOwner('billing_starter', { label: 'rec1b' });
        const sched = await makeDueSchedule(biz, { start: '2025-12-01' });
        const r = await runRecurring();
        expect(r.summaries.find((x) => x.recurring_invoice_id === sched)).toMatchObject({
          skippedNoPlan: true, droppedThrough: '2026-07-01',
        });
        expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(0);
        expect((await scheduleRow(sched))!.next_run_date).toBe('2026-07-01');
        expect(await count(`recurring_invoice_history WHERE recurring_invoice_id = $1`, [sched])).toBe(0);
      });

      it('a failing plan check for one business does not abort the run: it is skipped unchanged, the other generates', async () => {
        const A = await newBusinessWithOwner('billing_growth', { label: 'recErrA' });
        const B = await newBusinessWithOwner('billing_growth', { label: 'recErrB' });
        const sa = await makeDueSchedule(A.biz);
        const sb = await makeDueSchedule(B.biz);
        const before = await scheduleRow(sa);
        const original = featureAccess.assertFeatureAccess;
        const spy = jest.spyOn(featureAccess, 'assertFeatureAccess').mockImplementation(async (biz, key) => {
          if (biz === A.biz) throw new Error('transient db error');
          return original(biz, key);
        });
        const errLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
          const r = await runRecurring();
          const byId = (id: string) => r.summaries.find((x) => x.recurring_invoice_id === id)!;
          expect(byId(sa)).toMatchObject({ skippedPlanCheckFailed: true, skippedNoPlan: false, created: [] });
          expect(byId(sb).created).toHaveLength(1);
        } finally {
          spy.mockRestore();
          errLog.mockRestore();
        }
        expect(await count(`invoices WHERE business_id = $1`, [A.biz])).toBe(0);
        expect(await scheduleRow(sa)).toEqual(before); // next_run_date unchanged
        expect(await count(`invoices WHERE business_id = $1`, [B.biz])).toBe(1);
      });

      describe('manual run now', () => {
        const runNow = (biz: string, userId: string, id: string) =>
          callRoute(postRecurringRoute as unknown as RouteHandler, {
            biz, userId, method: 'POST', path: `/api/recurring-invoices/${id}`, params: { id },
            body: { action: 'run_now' },
          });

        it('is refused with FEATURE_NOT_IN_PLAN on a plan without the feature, and creates nothing', async () => {
          const { biz, owner } = await newBusinessWithOwner('billing_starter', { label: 'rn1' });
          const sched = await makeDueSchedule(biz);
          const res = await runNow(biz, owner, sched);
          expect(res.status).toBe(403);
          expect((await res.json()).code).toBe('FEATURE_NOT_IN_PLAN');
          expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(0);
          expect((await scheduleRow(sched))!.next_run_date).toBe(RECURRING_START);
        });

        it('passes the plan gate on a plan with the feature', async () => {
          const { biz, owner } = await newBusinessWithOwner('billing_growth', { label: 'rn2' });
          const sched = await makeDueSchedule(biz);
          const res = await runNow(biz, owner, sched);
          expect(res.status).not.toBe(403);
          const body = await res.json();
          expect(body.skippedNoPlan).not.toBe(true);
        });
      });

      it('a business on Free is skipped too', async () => {
        const { biz } = await newBusinessWithOwner('free', { label: 'rec2' });
        const sched = await makeDueSchedule(biz);
        const r = await runRecurring();
        expect(r.summaries.find((x) => x.recurring_invoice_id === sched)?.skippedNoPlan).toBe(true);
        expect(await count(`invoices WHERE business_id = $1`, [biz])).toBe(0);
      });

      it('a business whose plan has the feature generates in the same run in which another is skipped', async () => {
        const A = await newBusinessWithOwner('billing_growth', { label: 'recA' });
        const B = await newBusinessWithOwner('billing_starter', { label: 'recB' });
        const sa = await makeDueSchedule(A.biz);
        const sb = await makeDueSchedule(B.biz);
        const sb2 = await makeDueSchedule(B.biz);
        const r = await runRecurring();
        const byId = (id: string) => r.summaries.find((x) => x.recurring_invoice_id === id)!;
        expect(byId(sa)).toMatchObject({ skippedNoPlan: false });
        expect(byId(sa).created).toHaveLength(1);
        expect(byId(sb).skippedNoPlan).toBe(true);
        expect(byId(sb2).skippedNoPlan).toBe(true);
        expect(await count(`invoices WHERE business_id = $1`, [A.biz])).toBe(1);
        expect(await count(`invoices WHERE business_id = $1`, [B.biz])).toBe(0);
      });
    });

    describe('WhatsApp campaigns', () => {
      beforeEach(() => jest.mocked(sendWhatsAppMessage).mockClear());

      it('a campaign does not send after Connect lapses, and stays running', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { label: 'camp1' });
        await enableConnect(biz);
        const campaign = await makeScheduledCampaign(biz);
        await setPlan(biz, 'connect', 'connect_free');
        const r = await processCampaign(campaign);
        expect(r.sent).toBe(0);
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
        const row = await campaignRow(campaign);
        expect(row).toMatchObject({ status: 'running', sent_count: 0, pending_count: 2, completed_at: null });
        expect(await count(`whatsapp_campaign_recipients WHERE campaign_id = $1 AND status = 'pending'`, [campaign])).toBe(2);
      });

      it('a lapse takes effect at once although the Connect entitlement was cached', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { label: 'camp1b' });
        await enableConnect(biz);
        const { hasWhatsAppBotAddon } = await import('@/lib/subscription');
        expect(await hasWhatsAppBotAddon(biz)).toBe(true); // fills the cache
        const campaign = await makeScheduledCampaign(biz);
        await query(`UPDATE business_module_subscriptions SET plan_id = 'connect_free' WHERE business_id = $1 AND module_key = 'connect'`, [biz]);
        await processCampaign(campaign);
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
      });

      it('a campaign stops at the daily WhatsApp cap and stays running', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { label: 'camp2' });
        await enableConnect(biz);
        const campaign = await makeScheduledCampaign(biz);
        await fillWhatsAppQuota(biz);
        await processCampaign(campaign);
        expect(sendWhatsAppMessage).not.toHaveBeenCalled();
        expect((await campaignRow(campaign))!.status).toBe('running');
      });

      it('with one message of quota left and two recipients exactly one is sent and the campaign is not completed', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { label: 'camp3' });
        await enableConnect(biz);
        const campaign = await makeScheduledCampaign(biz, 2);
        await leaveWhatsAppQuota(biz, 1);
        const r = await processCampaign(campaign);
        expect(r.sent).toBe(1);
        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(1);
        const row = await campaignRow(campaign);
        expect(row).toMatchObject({ status: 'running', sent_count: 1, pending_count: 1 });
        expect(await count(`whatsapp_campaign_recipients WHERE campaign_id = $1 AND status = 'pending'`, [campaign])).toBe(1);
      });

      it('with Connect active and quota free the campaign sends to both recipients and completes', async () => {
        const { biz } = await newBusinessWithOwner('billing_growth', { label: 'camp4' });
        await enableConnect(biz);
        const campaign = await makeScheduledCampaign(biz, 2);
        const r = await processCampaign(campaign);
        expect(r.sent).toBe(2);
        expect(sendWhatsAppMessage).toHaveBeenCalledTimes(2);
        expect((await campaignRow(campaign))!.status).toBe('completed');
      });
    });
  });
  describe('final fix wave', () => {
    describe('backup restore never reactivates users (item 2)', () => {
      it('keeps a deactivated user inactive, reports it, and still applies the other restored fields', async () => {
        const { biz, owner } = await newBusinessWithOwner('billing_growth', { label: 'restore' });
        const inactive = await addUser(biz, { isActive: false });
        const active = await addUser(biz, { isActive: true });
        const empRow = await addEmployee(biz, { isActive: false });
        const custId = randomUUID();
        const res = await callRoute(restoreBackupRoute as unknown as RouteHandler, {
          biz, userId: owner, method: 'POST', path: '/api/backup/restore',
          body: {
            restore_mode: 'merge_smart',
            backup: {
              version: '1', business_id: biz,
              users: [
                { id: inactive, name: 'Restored Name', phone: '9000000001', role: 'user', is_active: true },
                { id: active, name: 'Still Here', phone: '9000000002', role: 'user', is_active: false },
              ],
              employees: [{ id: empRow, is_active: true }],
              customers: [{ id: custId, name: 'Restored cust' }],
            },
          },
        });
        const body = await res.json();
        expect([res.status, body.error ?? '']).toEqual([200, '']);
        expect((await userRow(inactive))!.is_active).toBe(false);
        expect((await userRow(active))!.is_active).toBe(true);
        expect((await userRow(inactive))!.name).toBe('Restored Name'); // other fields still restored
        expect(await count(`customers WHERE id = $1 AND business_id = $2`, [custId, biz])).toBe(1);
        expect(body.users_state_differs).toEqual(
          expect.arrayContaining([
            { id: inactive, name: 'Restored Name', backup_is_active: true, current_is_active: false },
            { id: active, name: 'Still Here', backup_is_active: false, current_is_active: true },
          ]),
        );
        expect(body.users_state_differs).toHaveLength(2);
        expect(body.employees_state_differs).toEqual([{ id: empRow, backup_is_active: true, current_is_active: false }]);
        const e = await queryOne<{ is_active: boolean }>(`SELECT is_active FROM employees WHERE id = $1`, [empRow]);
        expect(e!.is_active).toBe(false);
      });
    });

    describe('POST /api/employees seat check for an inactive user that still holds a role (item 3)', () => {
      async function setup(label: string, fullSeats: boolean) {
        const { biz, owner } = await newBusinessWithOwner('billing_starter', { hr: true, label });
        const role = await makeRole(biz, 'cashier');
        // Starter: 3 console seats. owner + (fullSeats ? 2 : 1) role users.
        await addUser(biz, { roleId: role });
        if (fullSeats) await addUser(biz, { roleId: role });
        const inactive = await addUser(biz, { roleId: role, isActive: false });
        await addEmployee(biz, { userId: inactive, accessType: 'full', isActive: false });
        const phoneRow = await queryOne<{ phone: string }>(`SELECT phone FROM users WHERE id = $1`, [inactive]);
        clearSubscriptionCache(biz);
        return { biz, owner, role, inactive, phoneNumber: phoneRow!.phone };
      }
      const link = (s: { biz: string; owner: string; role: string; phoneNumber: string }) =>
        callRoute(postEmployeeRoute as unknown as RouteHandler, {
          biz: s.biz, userId: s.owner, method: 'POST', path: '/api/employees',
          body: { name: 'Returning', phone: s.phoneNumber, role_id: s.role, password: 'Passw0rdX1' },
        });

      it('is refused at 3 of 3 seats and the user stays inactive', async () => {
        const s = await setup('emp-seat-full', true);
        expect((await queryOne<{ count: number }>(CONSOLE_SEAT_COUNT_SQL, [s.biz]))!.count).toBe(3);
        const res = await link(s);
        expect(res.status).toBe(403);
        const body = await res.json();
        // The login-seat refusal of this route (not the generic limit reply) is USER_SEAT_LIMIT.
        expect(body.code).toBe('USER_SEAT_LIMIT');
        expect((await userRow(s.inactive))!.is_active).toBe(false);
      });

      it('succeeds with a free seat and reactivates the user', async () => {
        const s = await setup('emp-seat-free', false);
        const res = await link(s);
        const body = await res.json();
        expect([res.status, body.error ?? '']).toEqual([201, '']);
        expect((await userRow(s.inactive))!.is_active).toBe(true);
      });
    });

    describe('adding a business needs an owner row for the session business (item 5)', () => {
      it('refuses a user who has no owner row for the session business, and creates nothing', async () => {
        const { biz } = await newBusinessWithOwner('billing_business', { label: 'addbiz-owner' });
        const staff = await addUser(biz, { roleId: await makeRole(biz, 'cashier') });
        const before = await count(`user_businesses WHERE user_id = $1`, [staff]);
        const res = await callRoute(postBusinessRoute as unknown as RouteHandler, {
          biz, userId: staff, method: 'POST', path: '/api/businesses', sessionVersion: 1,
          body: { businessType: 'retail', industry: 'other', businessName: 'Sneaky shop' },
        });
        expect(res.status).toBe(403);
        expect((await res.json()).error).toBe('Only the business owner can add another business');
        expect(await count(`user_businesses WHERE user_id = $1`, [staff])).toBe(before);
      });
    });

    describe('reactivating an attendance-only user through the settings users route (item 6)', () => {
      it('is not refused at the seat limit when the user takes no seat; a user with a role still is', async () => {
        const { biz, owner } = await newBusinessWithOwner('billing_starter', { hr: true, label: 'react-seat' });
        const role = await makeRole(biz, 'cashier');
        await addUser(biz, { roleId: role });
        await addUser(biz, { roleId: role }); // 3 of 3 seats
        const attendanceOnly = await addUser(biz, { accessType: 'attendance_only', isActive: false });
        await query(`UPDATE employees SET is_active = false WHERE id = $1`, [attendanceOnly]);
        const withRole = await addUser(biz, { roleId: role, isActive: false });
        clearSubscriptionCache(biz);

        const refused = await patchUser(biz, owner, withRole, { is_active: true });
        expect(refused.status).toBe(403);
        expect((await refused.json()).code).toBe('SUBSCRIPTION_LIMIT_EXCEEDED');
        expect((await userRow(withRole))!.is_active).toBe(false);

        const ok = await patchUser(biz, owner, attendanceOnly, { is_active: true });
        expect(ok.status).toBe(200);
        expect((await userRow(attendanceOnly))!.is_active).toBe(true);
      });
    });

    describe('candidate conversion is one transaction (item 7)', () => {
      it('a failing employee insert leaves no new users row', async () => {
        const { biz, owner } = await newBusinessWithOwner('billing_growth', { label: 'convert-tx' });
        await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'hr', true, 'test')`, [biz]);
        await setPlan(biz, 'hr', 'hr_pro');
        const taken = await addEmployee(biz);
        await query(`UPDATE employees SET employee_code = 'DUP-1' WHERE id = $1`, [taken]);
        const job = randomUUID();
        await query(`INSERT INTO recruitment_jobs (id, business_id, title) VALUES ($1, $2, 'Clerk')`, [job, biz]);
        const candidateId = randomUUID();
        await query(
          `INSERT INTO recruitment_candidates (id, business_id, job_id, full_name, email, phone, status)
           VALUES ($1, $2, $3, 'Tx Cand', 'txcand@example.com', '9123456781', 'offer_accepted')`,
          [candidateId, biz, job],
        );
        await query(
          `INSERT INTO recruitment_offer_letters (business_id, candidate_id, designation, joining_date, status, accepted_at, basic_salary)
           VALUES ($1, $2, 'Clerk', CURRENT_DATE, 'accepted', CURRENT_TIMESTAMP, 20000)`,
          [biz, candidateId],
        );
        clearSubscriptionCache(biz);
        const usersBefore = await count('users WHERE business_id = $1', [biz]);
        const errLog = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        let res: Response;
        try {
          res = await callRoute(convertCandidateRoute as unknown as RouteHandler, {
            biz, userId: owner, method: 'POST', path: `/api/hr/recruitment/candidates/${candidateId}/convert`,
            body: { physical_documents_verified: true, employee_code: 'DUP-1' }, params: { id: candidateId },
          });
        } finally {
          errLog.mockRestore();
        }
        expect(res.status).toBe(400);
        expect(await count('users WHERE business_id = $1', [biz])).toBe(usersBefore);
        expect(await count(`users WHERE business_id = $1 AND email = 'txcand@example.com'`, [biz])).toBe(0);
        const c = await queryOne<{ employee_id: string | null; status: string }>(
          `SELECT employee_id, status FROM recruitment_candidates WHERE id = $1`, [candidateId]);
        expect(c).toEqual({ employee_id: null, status: 'offer_accepted' });
      });
    });
  });
});
