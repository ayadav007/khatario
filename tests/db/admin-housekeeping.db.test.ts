/**
 * Plan 6, Task 5 (admin and housekeeping) against real PostgreSQL. Disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/admin-housekeeping.db.test.ts --runInBand --forceExit
 * Covers: plan edits (confirmation + audit), admin subscription dates in SQL, archived receipts,
 * refund "mark reviewed", migration 482, and the recurring-invoice job's usability check.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

const enabled = !!process.env.PHASE2_TEST_DATABASE_URL;
if (enabled) process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;

jest.mock('@/lib/platform-request-auth', () => ({ requirePlatformRequest: jest.fn() }));
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
jest.mock('@/lib/platform-push', () => ({ sendPlatformAdminPush: jest.fn(async () => undefined) }));
jest.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: jest.fn(async () => undefined) }));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  setSessionCookies: jest.fn(),
  signAccessToken: jest.fn(async () => 'access-token'),
  signRefreshToken: jest.fn(async () => 'refresh-token'),
}));
jest.mock('@/lib/rag/queue', () => ({ scheduleKbReindex: jest.fn() }));
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { NextRequest } from 'next/server';
import { getPool, query, queryOne, closePool } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { adminUpdateSubscription } from '@/lib/admin-business-ops';
import { archiveBusinessBillingTransactions } from '@/lib/platform-billing-archive';
import { loadReceipt, renderReceiptHtml } from '@/lib/platform-receipt';
import { findRefundsNeedingReview } from '@/lib/subscription/reconcile-payments';
import { runRecurringInvoices } from '@/lib/invoices/recurring';
import { GET as getPlanLimits, POST as postPlanLimits } from '@/app/api/admin/plans/[planId]/limits/route';
import { GET as getPlanFeatures, POST as postPlanFeatures } from '@/app/api/admin/plans/[planId]/features/route';
import { GET as getAdminReceipt } from '@/app/api/admin/businesses/[id]/billing/[txId]/receipt/route';
import { POST as postRefundReview } from '@/app/api/admin/businesses/[id]/billing/[txId]/refund/review/route';

const run = enabled ? describe : describe.skip;

run('admin and housekeeping (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const businesses: string[] = [];
  const plans: string[] = [];
  let adminId = '';
  const phone = () => `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`;

  const asAdmin = () =>
    (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: adminId, role: 'super_admin' } });
  const req = (path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  async function newBusiness(name = 'Housekeeping'): Promise<string> {
    const biz = randomUUID();
    businesses.push(biz);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [biz, `${name} ${biz.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [biz]);
    return biz;
  }

  async function newPlan(): Promise<string> {
    const id = `hk_${randomUUID().slice(0, 8)}`;
    plans.push(id);
    await query(
      `INSERT INTO subscription_plans (id, name, display_name, description, price_monthly, price_yearly, price_3year, currency, features, is_active, sort_order, product_line)
       VALUES ($1, $1, 'HK test', 'x', 100, 1000, 0, 'INR', '{}'::jsonb, true, 99, 'billing')`,
      [id],
    );
    return id;
  }

  async function putOnPlan(biz: string, planId: string, status = 'active') {
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date)
       VALUES ($1, 'billing', $2, $3, CURRENT_DATE)
       ON CONFLICT (business_id, module_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = EXCLUDED.status`,
      [biz, planId, status],
    );
  }

  beforeAll(async () => {
    adminId = randomUUID();
    await query(
      `INSERT INTO platform_admins (id, name, email, password_hash, role) VALUES ($1, 'HK admin', $2, 'x', 'super_admin')`,
      [adminId, `hk-${adminId}@example.test`],
    );
    asAdmin();
  });

  afterAll(async () => {
    if (enabled) {
      await new Promise((r) => setTimeout(r, 300));
      for (const id of businesses) {
        await query(`DELETE FROM billing_transactions WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM billing_transactions_archive WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM recurring_invoice_history WHERE recurring_invoice_id IN (SELECT id FROM recurring_invoices WHERE business_id = $1)`, [id]).catch(() => undefined);
        await query(`DELETE FROM recurring_invoices WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM invoice_items WHERE invoice_id IN (SELECT id FROM invoices WHERE business_id = $1)`, [id]).catch(() => undefined);
        await query(`DELETE FROM invoices WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM customers WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM user_businesses WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM users WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      for (const id of plans) {
        await query(`DELETE FROM business_module_subscriptions WHERE plan_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM subscription_plan_limits WHERE plan_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM subscription_plan_features WHERE plan_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM subscription_plans WHERE id = $1`, [id]).catch(() => undefined);
      }
      await query(`DELETE FROM platform_admin_logs WHERE admin_id = $1`, [adminId]).catch(() => undefined);
      await query(`DELETE FROM platform_admins WHERE id = $1`, [adminId]).catch(() => undefined);
      await closePool();
    }
  });

  // -------------------------------------------------------------------------------------------
  describe('plan edits (SUB-35)', () => {
    it('GET returns how many businesses are on the plan (active and trial only)', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan, 'active');
      await putOnPlan(await newBusiness(), plan, 'trial');
      await putOnPlan(await newBusiness(), plan, 'expired');
      for (const get of [getPlanLimits, getPlanFeatures]) {
        const res = await get(req(`/api/admin/plans/${plan}/x`), { params: { planId: plan } });
        expect(res.status).toBe(200);
        expect((await res.json()).affected_businesses).toBe(2);
      }
    });

    it('limits: a save without the right count is refused with 409 and the count, and changes nothing', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      for (const body of [{ limits: { max_customers: 5 } }, { limits: { max_customers: 5 }, confirm_affected_count: 0 }, { limits: { max_customers: 5 }, confirm_affected_count: '1' }]) {
        const res = await postPlanLimits(req(`/api/admin/plans/${plan}/limits`, body), { params: { planId: plan } });
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'CONFIRMATION_REQUIRED', affected_businesses: 1 });
      }
      expect(await queryOne(`SELECT 1 FROM subscription_plan_limits WHERE plan_id = $1`, [plan])).toBeNull();
      expect(await queryOne(`SELECT 1 FROM platform_admin_logs WHERE details->>'plan_id' = $1`, [plan])).toBeNull();
    });

    it('limits: with the right count the change is saved and logged with before, after and the admin', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      const def = await queryOne<{ default_value: number }>(`SELECT default_value FROM platform_limits WHERE limit_key = 'max_customers'`);
      const res = await postPlanLimits(
        req(`/api/admin/plans/${plan}/limits`, { limits: { max_customers: 77 }, confirm_affected_count: 1 }),
        { params: { planId: plan } },
      );
      expect(res.status).toBe(200);
      expect(await queryOne(`SELECT limit_value FROM subscription_plan_limits WHERE plan_id = $1 AND limit_key = 'max_customers'`, [plan])).toMatchObject({ limit_value: 77 });
      const log = await queryOne<{ admin_id: string; action: string; details: any }>(
        `SELECT admin_id::text, action, details FROM platform_admin_logs WHERE details->>'plan_id' = $1`, [plan]);
      expect(log).toMatchObject({ admin_id: adminId, action: 'update_plan_limits' });
      expect(log!.details.before).toEqual({ max_customers: Number(def!.default_value) });
      expect(log!.details.after).toEqual({ max_customers: 77 });
      expect(log!.details.affected_businesses).toBe(1);
    });

    it('features: wrong count is 409; right count saves and logs added and removed features', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      const feats = (await query(`SELECT id FROM platform_features WHERE is_active = true ORDER BY id LIMIT 2`)).rows.map((r: any) => r.id as string);
      const bad = await postPlanFeatures(
        req(`/api/admin/plans/${plan}/features`, { features: { [feats[0]]: true }, confirm_affected_count: 9 }),
        { params: { planId: plan } },
      );
      expect(bad.status).toBe(409);
      expect((await bad.json()).affected_businesses).toBe(1);
      expect(await queryOne(`SELECT 1 FROM subscription_plan_features WHERE plan_id = $1`, [plan])).toBeNull();

      const ok = await postPlanFeatures(
        req(`/api/admin/plans/${plan}/features`, { features: { [feats[0]]: true }, confirm_affected_count: 1 }),
        { params: { planId: plan } },
      );
      expect(ok.status).toBe(200);
      const swap = await postPlanFeatures(
        req(`/api/admin/plans/${plan}/features`, { features: { [feats[1]]: true }, confirm_affected_count: 1 }),
        { params: { planId: plan } },
      );
      expect(swap.status).toBe(200);
      const logs = (await query(
        `SELECT details FROM platform_admin_logs WHERE details->>'plan_id' = $1 AND action = 'update_plan_features' ORDER BY created_at`, [plan])).rows;
      expect(logs).toHaveLength(2);
      expect(logs[0].details).toMatchObject({ before: { enabled_features: [] }, after: { enabled_features: [feats[0]] } });
      expect(logs[1].details).toMatchObject({ added: [feats[1]], removed: [feats[0]] });
    });

    it('a save that changes nothing writes no log row', async () => {
      const plan = await newPlan();
      const res = await postPlanLimits(
        req(`/api/admin/plans/${plan}/limits`, { limits: {}, confirm_affected_count: 0 }),
        { params: { planId: plan } },
      );
      expect(res.status).toBe(200);
      expect(await queryOne(`SELECT 1 FROM platform_admin_logs WHERE details->>'plan_id' = $1`, [plan])).toBeNull();
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('admin subscription editor: dates come from the database', () => {
    it('a monthly and a yearly active save end one month / one year after the database date', async () => {
      const m = await newBusiness();
      await adminUpdateSubscription({ businessId: m, adminId, moduleKey: 'billing', planId: 'growth', status: 'active', billingCycle: 'monthly' });
      const y = await newBusiness();
      await adminUpdateSubscription({ businessId: y, adminId, moduleKey: 'billing', planId: 'growth', status: 'active', billingCycle: 'yearly' });
      const rows = await query(
        `SELECT business_id::text AS b, end_date::text AS e,
                (CURRENT_DATE + make_interval(months => 1))::date::text AS m1, (CURRENT_DATE + make_interval(months => 12))::date::text AS m12
         FROM business_module_subscriptions WHERE business_id = ANY($1::uuid[]) AND module_key = 'billing'`,
        [[m, y]],
      );
      const by = Object.fromEntries(rows.rows.map((r: any) => [r.b, r]));
      expect(by[m].e).toBe(by[m].m1);
      expect(by[y].e).toBe(by[y].m12);
    });

    it('an existing future end date is kept; a past one is replaced; an explicit one is used', async () => {
      const biz = await newBusiness();
      await query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
         VALUES ($1, 'billing', 'growth', 'active', CURRENT_DATE - 5, CURRENT_DATE + 20, 'monthly')`, [biz]);
      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', planId: 'growth', status: 'active' });
      expect(await queryOne(`SELECT (end_date = CURRENT_DATE + 20) AS same FROM business_module_subscriptions WHERE business_id = $1`, [biz])).toMatchObject({ same: true });

      await query(`UPDATE business_module_subscriptions SET end_date = CURRENT_DATE - 3 WHERE business_id = $1`, [biz]);
      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', planId: 'growth', status: 'active' });
      expect(await queryOne(`SELECT (end_date = CURRENT_DATE + make_interval(months => 1)) AS fresh FROM business_module_subscriptions WHERE business_id = $1`, [biz])).toMatchObject({ fresh: true });

      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', planId: 'growth', status: 'active', endDate: '2031-01-15' });
      expect(await queryOne(`SELECT end_date::text AS e FROM business_module_subscriptions WHERE business_id = $1`, [biz])).toMatchObject({ e: '2031-01-15' });
    });

    it('trial: a new trial gets the signup length and an extension counts from the later of today and the old end', async () => {
      const biz = await newBusiness();
      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', planId: 'trial' });
      const first = await queryOne<{ days: number }>(`SELECT (trial_end_date - CURRENT_DATE)::int AS days FROM business_module_subscriptions WHERE business_id = $1`, [biz]);
      expect(first!.days).toBeGreaterThanOrEqual(14);
      await query(`UPDATE business_module_subscriptions SET trial_end_date = CURRENT_DATE - 10 WHERE business_id = $1`, [biz]);
      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', extendTrialDays: 5 });
      expect(await queryOne(`SELECT (trial_end_date - CURRENT_DATE)::int AS days FROM business_module_subscriptions WHERE business_id = $1`, [biz])).toMatchObject({ days: 5 });
    });

    it('the source no longer computes period dates in JavaScript', () => {
      const src = readFileSync(join(process.cwd(), 'lib/admin-business-ops.ts'), 'utf8');
      expect(src).not.toMatch(/computeSubscriptionPeriodEnd/);
      expect(src).toMatch(/make_interval\(months/);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('archived receipts', () => {
    async function archivedPayment(businessName: string): Promise<{ biz: string; tx: string }> {
      const biz = randomUUID();
      businesses.push(biz);
      await query(`INSERT INTO businesses (id, name, gstin, state_code, primary_module) VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'billing')`, [biz, businessName]);
      const tx = randomUUID();
      await query(
        `INSERT INTO billing_transactions (id, business_id, type, status, amount, total_amount, plan_id, payment_method, payment_reference, description)
         VALUES ($1, $2, 'payment', 'completed', 499, 499, 'growth', 'razorpay', 'pay_<b>ref', 'Growth plan')`,
        [tx, biz],
      );
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await archiveBusinessBillingTransactions(client, biz, 'business_deleted');
        await client.query(`DELETE FROM billing_transactions WHERE business_id = $1`, [biz]);
        await client.query(`DELETE FROM businesses WHERE id = $1`, [biz]);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
      return { biz, tx };
    }

    it('a platform admin can open it; a customer lookup (any business id) and the default lookup cannot', async () => {
      const { biz, tx } = await archivedPayment('Gone <script>alert(1)</script> Traders');
      expect(await loadReceipt(tx, null)).toBeNull();
      expect(await loadReceipt(tx, biz)).toBeNull();
      expect(await loadReceipt(tx, biz, { includeArchived: true })).toBeNull();
      const r = await loadReceipt(tx, null, { includeArchived: true });
      expect(r).not.toBeNull();
      expect(r!.buyer.name).toContain('Gone');
      const html = renderReceiptHtml(r!);
      expect(html).not.toContain('<script>alert(1)</script>');
      expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
      expect(html).not.toContain('pay_<b>ref');
      expect(html).toContain('pay_&lt;b&gt;ref');
    });

    it('the admin route serves it for the right business id and answers 404 for another', async () => {
      const { biz, tx } = await archivedPayment('Archived Co');
      const ok = await getAdminReceipt(req(`/x`), { params: { id: biz, txId: tx } });
      expect(ok.status).toBe(200);
      expect(await ok.text()).toContain('Archived Co');
      const other = await getAdminReceipt(req(`/x`), { params: { id: randomUUID(), txId: tx } });
      expect(other.status).toBe(404);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('flagged refunds: mark reviewed', () => {
    async function flaggedRefund(flag = true): Promise<{ biz: string; payment: string; refund: string }> {
      const biz = await newBusiness();
      const payment = randomUUID();
      const refund = randomUUID();
      await query(
        `INSERT INTO billing_transactions (id, business_id, type, status, amount, total_amount, plan_id, payment_method)
         VALUES ($1, $2, 'payment', 'completed', 100, 100, 'growth', 'razorpay')`, [payment, biz]);
      await query(
        `INSERT INTO billing_transactions (id, business_id, type, status, amount, total_amount, plan_id, payment_method, metadata)
         VALUES ($1, $2, 'refund', 'completed', 100, 100, 'growth', 'razorpay', $3::jsonb)`,
        [refund, biz, JSON.stringify({ refund_of: payment, ...(flag ? { needs_review: true, review_reasons: ['coupon_kept'] } : {}) })]);
      return { biz, payment, refund };
    }
    const review = (biz: string, payment: string, body: unknown) =>
      postRefundReview(req(`/x`, body), { params: { id: biz, txId: payment } });

    it('records who and when, and the reconcile finder stops listing it', async () => {
      const { biz, payment, refund } = await flaggedRefund();
      expect((await findRefundsNeedingReview()).some((r) => r.refund_id === refund)).toBe(true);
      const res = await review(biz, payment, { refund_id: refund });
      expect(res.status).toBe(200);
      const row = await queryOne<{ metadata: any }>(`SELECT metadata FROM billing_transactions WHERE id = $1`, [refund]);
      expect(row!.metadata.reviewed_by).toBe(adminId);
      expect(new Date(row!.metadata.reviewed_at).getTime()).toBeGreaterThan(Date.now() - 60_000);
      expect(row!.metadata.needs_review).toBe(true); // the flag stays as history
      expect((await findRefundsNeedingReview()).some((r) => r.refund_id === refund)).toBe(false);
      expect(await queryOne(`SELECT 1 FROM platform_admin_logs WHERE action = 'review_refund' AND entity_id = $1`, [refund])).not.toBeNull();
      const again = await review(biz, payment, { refund_id: refund });
      expect(again.status).toBe(200);
      expect((await again.json()).already_reviewed).toBe(true);
    });

    it('refuses a refund of another payment or business, an unflagged refund and a bad id', async () => {
      const a = await flaggedRefund();
      const b = await flaggedRefund();
      expect((await review(a.biz, b.payment, { refund_id: a.refund })).status).toBe(404);
      expect((await review(b.biz, a.payment, { refund_id: a.refund })).status).toBe(404);
      const plain = await flaggedRefund(false);
      expect((await review(plain.biz, plain.payment, { refund_id: plain.refund })).status).toBe(404);
      expect((await review(a.biz, a.payment, { refund_id: 'nope' })).status).toBe(400);
      const row = await queryOne<{ metadata: any }>(`SELECT metadata FROM billing_transactions WHERE id = $1`, [a.refund]);
      expect(row!.metadata.reviewed_at).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('migration 482 (HR Lite description)', () => {
    it('states what is true, changes only the text, and is safe to run twice', async () => {
      const sql = readFileSync(join(process.cwd(), 'database/migrations/482_hr_lite_description.sql'), 'utf8');
      const before = await queryOne<any>(`SELECT price_monthly::text AS p, is_active, product_line, features FROM subscription_plans WHERE id = 'hr_staff_lite'`);
      expect(before).not.toBeNull();
      const client = await getPool().connect();
      try {
        for (let i = 0; i < 2; i++) {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query('COMMIT');
        }
      } finally {
        client.release();
      }
      const after = await queryOne<any>(`SELECT description, price_monthly::text AS p, is_active, product_line, features FROM subscription_plans WHERE id = 'hr_staff_lite'`);
      expect(after.description).toMatch(/Billing Starter/);
      expect(after.description).not.toMatch(/every Billing plan/i);
      expect({ p: after.p, is_active: after.is_active, product_line: after.product_line, features: after.features }).toEqual(before);
    });

    it('migration 360 no longer downgrades a paying Connect subscription on a second run', () => {
      const sql = readFileSync(join(process.cwd(), 'database/migrations/360_plan_catalog_v2.sql'), 'utf8');
      const tail = sql.slice(sql.indexOf('old free Connect plan'));
      expect(tail).toMatch(/NOT EXISTS[\s\S]*billing_transactions[\s\S]*module_key = 'connect'/);
      expect(tail).toMatch(/end_date IS NULL OR end_date < CURRENT_DATE/);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('recurring invoices use the shared usability rule', () => {
    const RUN_DAY = '2026-06-15';
    async function businessWithSchedule(daysPastEnd: number): Promise<{ biz: string; sched: string }> {
      const biz = await newBusiness('Recurring');
      const owner = randomUUID();
      await query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin, auth_session_version) VALUES ($1, $2, 'Owner', $3, true, 1)`, [owner, biz, phone()]);
      await query(`INSERT INTO user_businesses (user_id, business_id, role) VALUES ($1, $2, 'owner')`, [owner, biz]);
      await query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
         VALUES ($1, 'billing', 'billing_growth', 'active', CURRENT_DATE - 400, CURRENT_DATE - $2::int)`,
        [biz, daysPastEnd],
      );
      clearSubscriptionCache(biz);
      clearModuleSubscriptionCache(biz);
      const customer = randomUUID();
      await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Rec cust', $3)`, [customer, biz, phone()]);
      const sched = randomUUID();
      await query(
        `INSERT INTO recurring_invoices (id, business_id, customer_id, frequency, interval_value, start_date, next_run_date, items, created_by, auto_finalize)
         VALUES ($1, $2, $3, 'monthly', 1, '2026-06-01', '2026-06-01', $4::jsonb, $5, false)`,
        [sched, biz, customer, JSON.stringify([{ item_name: 'Monthly service', quantity: 1, unit_price: 1000, tax_rate: 18 }]), owner],
      );
      return { biz, sched };
    }
    const invoices = async (biz: string) =>
      Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM invoices WHERE business_id = $1`, [biz]))!.n);

    it('8 days past the end, not yet processed by the subscription job: no invoice and the schedule is untouched', async () => {
      const { biz, sched } = await businessWithSchedule(8);
      const out = (await runRecurringInvoices(getPool(), { today: RUN_DAY, businessId: biz })).find((r) => r.recurring_invoice_id === sched)!;
      expect(out.skippedSubscriptionInactive).toBe(true);
      expect(out.created).toHaveLength(0);
      expect(await invoices(biz)).toBe(0);
      expect(await queryOne(`SELECT next_run_date::text AS d FROM recurring_invoices WHERE id = $1`, [sched])).toMatchObject({ d: '2026-06-01' });
    });

    it('3 days past the end (inside grace): the invoice is generated', async () => {
      const { biz, sched } = await businessWithSchedule(3);
      const out = (await runRecurringInvoices(getPool(), { today: RUN_DAY, businessId: biz })).find((r) => r.recurring_invoice_id === sched)!;
      expect(out.error).toBeUndefined();
      expect(out.created).toHaveLength(1);
      expect(await invoices(biz)).toBe(1);
    });
  });
});
