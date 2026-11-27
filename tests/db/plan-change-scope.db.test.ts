/**
 * Plan 7 (plan changes for new or existing customers) against real PostgreSQL. Disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/plan-change-scope.db.test.ts --runInBand --forceExit
 * Covers "Apply to everyone now" / "Only new customers" for a feature, a limit and a price, the pin that
 * keeps a business on its old terms, every writer that clears the pin, renewal through real checkout
 * creation, moving everyone to the current terms, a plan priced at Rs 1, and migration 485.
 */
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

process.env.PLATFORM_RAZORPAY_KEY_ID = 'rzp_test_plan';
process.env.PLATFORM_RAZORPAY_KEY_SECRET = 'k';
process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET = 'whsec_plan';

const enabled = !!process.env.PHASE2_TEST_DATABASE_URL;
if (enabled) process.env.DATABASE_URL = process.env.PHASE2_TEST_DATABASE_URL;

jest.mock('@/lib/platform-auth', () => ({ logAdminAction: jest.fn() }));
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
import { query, queryOne, closePool } from '@/lib/db';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { clearSubscriptionCache, getBusinessSubscription, checkLimit } from '@/lib/subscription';
import { clearModuleSubscriptionCache, upsertModuleSubscription } from '@/lib/subscription/module-subscriptions';
import { assertFeatureAccess } from '@/lib/subscription/feature-access';
import { FeatureKeys } from '@/lib/featureKeys';
import { resolveBusinessLimit } from '@/lib/subscription/resolve-limit';
import { applyModuleSubscriptionPlanChange } from '@/lib/subscription/apply-module-plan-change';
import { moveModuleSubscriptionToFree } from '@/lib/subscription/module-plan-lifecycle';
import { processExpiredModuleSubscriptions } from '@/lib/subscription/lifecycle';
import { adminUpdateSubscription } from '@/lib/admin-business-ops';
import { createSubscriptionCheckout, completeSubscriptionCheckoutPaymentDetailed } from '@/lib/platform-subscription-checkout';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { POST as postFeatures, GET as getFeatures } from '@/app/api/admin/plans/[planId]/features/route';
import { POST as postLimits, GET as getLimits } from '@/app/api/admin/plans/[planId]/limits/route';
import { POST as postPrices, GET as getPrices } from '@/app/api/admin/plans/[planId]/prices/route';
import { POST as postTerms, GET as getTerms } from '@/app/api/admin/plans/[planId]/terms/route';
import { GET as previewGet } from '@/app/api/subscriptions/checkout/preview/route';
import { GET as currentGet } from '@/app/api/subscriptions/current/route';
import { POST as upgradePost } from '@/app/api/subscriptions/upgrade/route';
import { POST as adminPlanUpsert } from '@/app/api/admin/subscriptions/plans/route';
import { sendRenewalReminders } from '@/lib/subscription/notifications';
import { khatarioMonthlyQuota } from '@/lib/ai-agent/billing';
import { planEnabledFeaturesQuery } from '@/lib/subscription/plan-terms';
import { readdirSync, statSync } from 'fs';

const run = enabled ? describe : describe.skip;

// Two registry features that exist on every database and map to feature keys the access check knows.
const F_BARCODE = 'advanced_barcode';
const F_BRANDING = 'advanced_custom_branding';

run('plan changes: everyone now / only new customers (kh_phase2_test)', () => {
  jest.setTimeout(90000);
  const MIGRATION = readFileSync(join(process.cwd(), 'database/migrations/485_plan_terms.sql'), 'utf8');
  const businesses: string[] = [];
  const plans: string[] = [];
  const owner = new Map<string, string>();
  let adminId = '';

  const asAdmin = () =>
    (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: adminId, role: 'super_admin' } });
  const req = (path: string, body?: unknown) =>
    new NextRequest(`http://localhost${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  type Scope = 'everyone' | 'new_customers';
  const ctx = (plan: string) => ({ params: { planId: plan } });
  const postF = (plan: string, features: Record<string, boolean>, confirm: unknown, scope?: unknown) =>
    postFeatures(req(`/api/admin/plans/${plan}/features`, { features, confirm_affected_count: confirm, ...(scope === undefined ? {} : { scope }) }), ctx(plan));
  const postL = (plan: string, limits: Record<string, number>, confirm: unknown, scope?: unknown) =>
    postLimits(req(`/api/admin/plans/${plan}/limits`, { limits, confirm_affected_count: confirm, ...(scope === undefined ? {} : { scope }) }), ctx(plan));
  const postP = (plan: string, prices: Record<string, unknown>, confirm: unknown, scope?: unknown) =>
    postPrices(req(`/api/admin/plans/${plan}/prices`, { prices, confirm_affected_count: confirm, ...(scope === undefined ? {} : { scope }) }), ctx(plan));

  async function newBusiness(label = 'pcs'): Promise<string> {
    const id = randomUUID();
    businesses.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Scope ${label} ${id.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [id]);
    const uid = randomUUID();
    owner.set(id, uid);
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [uid, id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
    );
    return id;
  }

  /** A billing plan with the given prices (rupees), the barcode feature and a customers cap of 77. */
  async function newPlan(opts: { monthly?: number; yearly?: number; features?: string[]; customers?: number } = {}): Promise<string> {
    const id = `pcs_${randomUUID().slice(0, 8)}`;
    plans.push(id);
    await query(
      `INSERT INTO subscription_plans (id, name, display_name, description, price_monthly, price_yearly, price_3year, currency, features, is_active, sort_order, product_line)
       VALUES ($1, $1, 'Scope test', 'x', $2, $3, 0, 'INR', '{}'::jsonb, true, 99, 'billing')`,
      [id, opts.monthly ?? 100, opts.yearly ?? 1000],
    );
    for (const f of opts.features ?? [F_BARCODE, F_BRANDING]) {
      await query(`INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES ($1, $2, true)`, [id, f]);
    }
    await query(`INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, 'max_customers', $2)`, [id, opts.customers ?? 77]);
    return id;
  }

  async function putOnPlan(biz: string, planId: string, status = 'active') {
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
       VALUES ($1, 'billing', $2, $3, CURRENT_DATE - 5, CURRENT_DATE + 20, 'monthly')
       ON CONFLICT (business_id, module_key) DO UPDATE SET plan_id = EXCLUDED.plan_id, status = EXCLUDED.status,
         end_date = EXCLUDED.end_date, plan_terms_id = NULL`,
      [biz, planId, status],
    );
    clearSubscriptionCache(biz);
    clearModuleSubscriptionCache(biz);
  }

  const pinOf = async (biz: string) =>
    (await queryOne<{ plan_terms_id: string | null }>(
      `SELECT plan_terms_id::text FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz]))!.plan_terms_id;
  const snapshotsOf = async (plan: string) =>
    (await query(`SELECT * FROM subscription_plan_terms WHERE plan_id = $1 ORDER BY created_at, id`, [plan])).rows;
  const hasFeature = async (biz: string, key: string) => {
    try { await assertFeatureAccess(biz, key); return true; } catch { return false; }
  };
  const capOf = async (biz: string) => (await resolveBusinessLimit(biz, 'customers', 'max_customers')).maxLimit;
  const livePrice = async (plan: string, col = 'price_monthly') =>
    Number((await queryOne<{ p: string }>(`SELECT ${col}::text AS p FROM subscription_plans WHERE id = $1`, [plan]))!.p);
  const logsOf = async (plan: string, action?: string) =>
    (await query(
      `SELECT action, details FROM platform_admin_logs WHERE details->>'plan_id' = $1 ${action ? `AND action = '${action}'` : ''} ORDER BY created_at`, [plan])).rows;

  async function checkoutAmount(biz: string, planId: string, cycle: 'monthly' | 'yearly' = 'monthly') {
    const spy = jest
      .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
      .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + randomUUID().slice(0, 8), paymentUrl: 'https://rzp.io/x' });
    try {
      const r = await createSubscriptionCheckout({ businessId: biz, planId, billingCycle: cycle });
      const row = await queryOne<{ total_amount: string; amount: string }>(
        `SELECT total_amount::text, amount::text FROM billing_transactions WHERE id = $1`, [r.billingTransactionId]);
      return { id: r.billingTransactionId, amount: Number(r.amount), stored: Number(row!.total_amount) };
    } finally {
      spy.mockRestore();
    }
  }

  beforeAll(async () => {
    if (!enabled) return;
    await query(MIGRATION);
    await query(MIGRATION);
    adminId = randomUUID();
    await query(
      `INSERT INTO platform_admins (id, name, email, password_hash, role) VALUES ($1, 'PCS admin', $2, 'x', 'super_admin')`,
      [adminId, `pcs-${adminId}@example.test`],
    );
    asAdmin();
  });

  afterAll(async () => {
    if (enabled) {
      await new Promise((r) => setTimeout(r, 300));
      for (const id of businesses) {
        await query(`DELETE FROM billing_transactions WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM subscription_events WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM users WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      for (const id of plans) {
        await query(`DELETE FROM business_module_subscriptions WHERE plan_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM subscription_plan_terms WHERE plan_id = $1`, [id]).catch(() => undefined);
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
  describe('migration 485', () => {
    it('ran twice without error; adds the terms table and a nullable pin column; no row is pinned', async () => {
      await query(MIGRATION);
      const cols = (await query(`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name = 'subscription_plan_terms'`)).rows.map((r: any) => r.column_name);
      for (const c of ['id', 'plan_id', 'features', 'limits', 'price_monthly', 'price_yearly', 'price_3year', 'created_at', 'created_by', 'reason']) {
        expect(cols).toContain(c);
      }
      expect(await queryOne(`SELECT is_nullable FROM information_schema.columns WHERE table_name = 'business_module_subscriptions' AND column_name = 'plan_terms_id'`))
        .toMatchObject({ is_nullable: 'YES' });
      expect(await queryOne(`SELECT 1 FROM business_module_subscriptions WHERE plan_terms_id IS NOT NULL AND plan_id NOT LIKE 'pcs\\_%'`)).toBeNull();
    });

    it('is written in the house style (short lock timeout, idempotent, a notice)', () => {
      expect(MIGRATION).toMatch(/SET LOCAL lock_timeout/);
      expect(MIGRATION).toMatch(/IF NOT EXISTS/i);
      expect(MIGRATION).toMatch(/RAISE NOTICE '485:/);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('no save made: nothing changes', () => {
    it('a business on a plan has no pin, no snapshot exists, and features and limit are the live ones', async () => {
      const plan = await newPlan();
      const biz = await newBusiness();
      await putOnPlan(biz, plan);
      expect(await pinOf(biz)).toBeNull();
      expect(await snapshotsOf(plan)).toHaveLength(0);
      expect(await hasFeature(biz, FeatureKeys.BARCODE_SCANNING)).toBe(true);
      expect(await capOf(biz)).toBe(77);
      expect((await checkLimit(biz, 'customers')).limit).toBe(77);
      expect((await checkoutAmount(biz, plan)).amount).toBe(100);
    });

    it('a save that changes nothing, with "only new customers", makes no snapshot and pins nobody', async () => {
      const plan = await newPlan();
      const biz = await newBusiness();
      await putOnPlan(biz, plan);
      const res = await postL(plan, { max_customers: 77 }, 1, 'new_customers');
      expect(res.status).toBe(200);
      expect(await snapshotsOf(plan)).toHaveLength(0);
      expect(await pinOf(biz)).toBeNull();
      expect(await logsOf(plan)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('the choice is required', () => {
    it('with businesses on the plan, a correct count but no scope is refused with SCOPE_REQUIRED and changes nothing', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      for (const call of [
        () => postF(plan, { [F_BARCODE]: true }, 1),
        () => postL(plan, { max_customers: 5 }, 1),
        () => postP(plan, { price_monthly: 25000 }, 1),
      ]) {
        const res = await call();
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ code: 'SCOPE_REQUIRED', affected_businesses: 1 });
      }
      expect(await capOf((await query(`SELECT business_id::text AS b FROM business_module_subscriptions WHERE plan_id = $1`, [plan])).rows[0].b)).toBe(77);
      expect(await livePrice(plan)).toBe(100);
      expect(await snapshotsOf(plan)).toHaveLength(0);
    });

    it('an unknown scope is a 400; the wrong count is still the 409 confirmation first', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      const bad = await postL(plan, { max_customers: 5 }, 1, 'later');
      expect(bad.status).toBe(400);
      expect(await bad.json()).toMatchObject({ code: 'INVALID_SCOPE' });
      const wrongCount = await postL(plan, { max_customers: 5 }, 9, 'everyone');
      expect(wrongCount.status).toBe(409);
      expect(await wrongCount.json()).toMatchObject({ code: 'CONFIRMATION_REQUIRED', affected_businesses: 1 });
    });

    it('with nobody on the plan no scope is needed', async () => {
      const plan = await newPlan();
      const res = await postL(plan, { max_customers: 5 }, 0);
      expect(res.status).toBe(200);
      expect(await snapshotsOf(plan)).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('a feature', () => {
    it('only new customers: the business on the plan keeps a removed feature; a business that joins later does not get it', async () => {
      const plan = await newPlan();
      const old = await newBusiness();
      await putOnPlan(old, plan);
      const res = await postF(plan, { [F_BARCODE]: true }, 1, 'new_customers'); // removes custom branding
      expect(res.status).toBe(200);
      expect(await hasFeature(old, FeatureKeys.CUSTOM_BRANDING)).toBe(true);
      expect(await hasFeature(old, FeatureKeys.BARCODE_SCANNING)).toBe(true);
      const fresh = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: fresh, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      expect(await pinOf(fresh)).toBeNull();
      expect(await hasFeature(fresh, FeatureKeys.CUSTOM_BRANDING)).toBe(false);
      expect(await hasFeature(fresh, FeatureKeys.BARCODE_SCANNING)).toBe(true);
      // Live matrix has the change; the snapshot has the old set.
      expect((await query(`SELECT feature_id FROM subscription_plan_features WHERE plan_id = $1`, [plan])).rows.map((r: any) => r.feature_id)).toEqual([F_BARCODE]);
      const [snap] = await snapshotsOf(plan);
      expect([...snap.features].sort()).toEqual([F_BARCODE, F_BRANDING].sort());
      expect(await pinOf(old)).toBe(snap.id);
    });

    it('only new customers: a feature added to the plan does not reach the business already on it', async () => {
      const plan = await newPlan({ features: [F_BARCODE] });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      expect((await postF(plan, { [F_BARCODE]: true, [F_BRANDING]: true }, 1, 'new_customers')).status).toBe(200);
      expect(await hasFeature(old, FeatureKeys.CUSTOM_BRANDING)).toBe(false);
      const fresh = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: fresh, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      expect(await hasFeature(fresh, FeatureKeys.CUSTOM_BRANDING)).toBe(true);
    });

    it('everyone now: the business on the plan loses the feature at once, and nobody is pinned', async () => {
      const plan = await newPlan();
      const old = await newBusiness();
      await putOnPlan(old, plan);
      expect(await hasFeature(old, FeatureKeys.CUSTOM_BRANDING)).toBe(true);
      expect((await postF(plan, { [F_BARCODE]: true }, 1, 'everyone')).status).toBe(200);
      expect(await hasFeature(old, FeatureKeys.CUSTOM_BRANDING)).toBe(false);
      expect(await pinOf(old)).toBeNull();
      expect(await snapshotsOf(plan)).toHaveLength(0);
    });

    it('the log row carries before, after, the choice, the snapshot and how many were pinned', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      await putOnPlan(await newBusiness(), plan);
      await postF(plan, { [F_BARCODE]: true }, 2, 'new_customers');
      const [log] = await logsOf(plan, 'update_plan_features');
      const [snap] = await snapshotsOf(plan);
      expect(log.details).toMatchObject({
        scope: 'new_customers',
        affected_businesses: 2,
        businesses_pinned: 2,
        terms_id: snap.id,
        removed: [F_BRANDING],
        after: { enabled_features: [F_BARCODE] },
      });
      expect([...log.details.before.enabled_features].sort()).toEqual([F_BARCODE, F_BRANDING].sort());
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('a limit', () => {
    it('only new customers: the pinned business keeps its old limit (resolver, checkLimit, subscription row); new ones get the new one', async () => {
      const plan = await newPlan();
      const old = await newBusiness();
      await putOnPlan(old, plan);
      expect((await postL(plan, { max_customers: 5 }, 1, 'new_customers')).status).toBe(200);
      expect(await capOf(old)).toBe(77);
      expect((await checkLimit(old, 'customers')).limit).toBe(77);
      expect((await getBusinessSubscription(old, true))!.features.limits.max_customers).toBe(77);
      const fresh = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: fresh, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      expect(await capOf(fresh)).toBe(5);
      expect((await checkLimit(fresh, 'customers')).limit).toBe(5);
      expect(await livePrice(plan)).toBe(100);
    });

    it('everyone now: the limit changes for the business on the plan', async () => {
      const plan = await newPlan();
      const old = await newBusiness();
      await putOnPlan(old, plan);
      expect(await capOf(old)).toBe(77);
      expect((await postL(plan, { max_customers: 5 }, 1, 'everyone')).status).toBe(200);
      expect(await capOf(old)).toBe(5);
      expect(await pinOf(old)).toBeNull();
    });

    it('the subscription cache is cleared by the save: a cached subscription shows the new limit at once', async () => {
      const plan = await newPlan();
      const old = await newBusiness();
      await putOnPlan(old, plan);
      expect((await getBusinessSubscription(old))!.features.limits.max_customers).toBe(77); // primes the cache
      await postL(plan, { max_customers: 5 }, 1, 'everyone');
      expect((await getBusinessSubscription(old))!.features.limits.max_customers).toBe(5);
    });

    it('a plan default (no row of its own) is snapshotted too: the pinned business keeps it when the platform default is overridden by the plan', async () => {
      const plan = await newPlan();
      const old = await newBusiness();
      await putOnPlan(old, plan);
      const dflt = Number((await queryOne<{ d: number }>(`SELECT default_value AS d FROM platform_limits WHERE limit_key = 'max_items'`))!.d);
      expect((await resolveBusinessLimit(old, 'items', 'max_items')).maxLimit).toBe(dflt);
      await postL(plan, { max_items: dflt + 500 }, 1, 'new_customers');
      expect((await resolveBusinessLimit(old, 'items', 'max_items')).maxLimit).toBe(dflt);
      const log = (await logsOf(plan, 'update_plan_limits'))[0];
      expect(log.details).toMatchObject({ scope: 'new_customers', before: { max_items: dflt }, after: { max_items: dflt + 500 } });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('a price', () => {
    it('only new customers: renewal by a pinned business is created at the old price; a new customer is charged the new one', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 1000 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      const res = await postP(plan, { price_monthly: 25000, price_yearly: 250000 }, 1, 'new_customers'); // Rs 250 / Rs 2500
      expect(res.status).toBe(200);
      expect(await livePrice(plan)).toBe(250);
      expect(await livePrice(plan, 'price_yearly')).toBe(2500);
      const renew = await checkoutAmount(old, plan);
      expect(renew.amount).toBe(100);
      expect(renew.stored).toBe(100);
      expect((await checkoutAmount(old, plan, 'yearly')).amount).toBe(1000);
      const fresh = await newBusiness();
      expect((await checkoutAmount(fresh, plan)).amount).toBe(250);
    });

    it('the preview shows what checkout stores, for a pinned business and for a new one', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 1000 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      await postP(plan, { price_monthly: 25000 }, 1, 'new_customers');
      const preview = async (b: string) =>
        (await (await previewGet(new NextRequest(`http://localhost/api/subscriptions/checkout/preview?plan_id=${plan}&billing_cycle=monthly`, {
          headers: { 'x-authenticated-business-id': b, 'x-authenticated-user-id': owner.get(b)! },
        }))).json());
      const pBody = await preview(old);
      expect(JSON.stringify(pBody)).toContain('100');
      expect((await checkoutAmount(old, plan)).stored).toBe(100);
      const fresh = await newBusiness();
      expect((await checkoutAmount(fresh, plan)).stored).toBe(250);
    });

    it('paying the pinned renewal keeps the pin, extends the period and the paid amount check passes against the stored row', async () => {
      const plan = await newPlan({ monthly: 100 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      await postP(plan, { price_monthly: 25000 }, 1, 'new_customers');
      const before = await pinOf(old);
      expect(before).not.toBeNull();
      const co = await checkoutAmount(old, plan);
      const done = await completeSubscriptionCheckoutPaymentDetailed({
        businessId: old, planId: plan, billingCycle: 'monthly', billingTransactionId: co.id, providerPaymentId: 'pay_' + randomUUID().slice(0, 8), amount: co.stored,
      });
      expect(done.completion).toBeTruthy();
      expect(await pinOf(old)).toBe(before);
      expect(await queryOne(`SELECT (end_date > CURRENT_DATE + 20) AS extended FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [old])).toMatchObject({ extended: true });
      // A payment of the new price for the old row is refused: the stored amount is the old price.
      const co2 = await checkoutAmount(old, plan);
      await expect(
        completeSubscriptionCheckoutPaymentDetailed({ businessId: old, planId: plan, billingCycle: 'monthly', billingTransactionId: co2.id, providerPaymentId: 'pay_' + randomUUID().slice(0, 8), amount: 250 }),
      ).rejects.toThrow(/AMOUNT_MISMATCH/);
    });

    it('a percentage coupon is worked out on the price the pinned business pays, in the preview and in the stored checkout', async () => {
      const plan = await newPlan({ monthly: 200 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      await postP(plan, { price_monthly: 100000 }, 1, 'new_customers'); // Rs 1000 for new customers
      const code = `PCS${randomUUID().slice(0, 8).toUpperCase()}`;
      await query(`INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, 'percentage', 50, 5)`, [code]);
      try {
        const spy = jest
          .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
          .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + randomUUID().slice(0, 8), paymentUrl: 'https://rzp.io/x' });
        try {
          const r = await createSubscriptionCheckout({ businessId: old, planId: plan, billingCycle: 'monthly', couponCode: code });
          expect(r.amount).toBe(100); // 50% of the Rs 200 the pinned business pays, not of Rs 1000
          const row = await queryOne<{ total_amount: string; discount_amount: string }>(
            `SELECT total_amount::text, discount_amount::text FROM billing_transactions WHERE id = $1`, [r.billingTransactionId]);
          expect(Number(row!.discount_amount)).toBe(100);
          expect(Number(row!.total_amount)).toBe(100);
          const fresh = await newBusiness();
          const r2 = await createSubscriptionCheckout({ businessId: fresh, planId: plan, billingCycle: 'monthly', couponCode: code });
          expect(r2.amount).toBe(500);
          const row2 = await queryOne<{ total_amount: string }>(`SELECT total_amount::text FROM billing_transactions WHERE id = $1`, [r2.billingTransactionId]);
          expect(Number(row2!.total_amount)).toBe(500);
        } finally {
          spy.mockRestore();
        }
      } finally {
        await query(`DELETE FROM coupon_redemptions WHERE coupon_id IN (SELECT id FROM coupons WHERE code = $1)`, [code]).catch(() => undefined);
        await query(`UPDATE billing_transactions SET coupon_id = NULL WHERE coupon_id IN (SELECT id FROM coupons WHERE code = $1)`, [code]).catch(() => undefined);
        await query(`DELETE FROM coupons WHERE code = $1`, [code]).catch(() => undefined);
      }
    });

    it('everyone now: the pinned business also pays the new price', async () => {
      const plan = await newPlan({ monthly: 100 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      const plain = await newBusiness();
      await putOnPlan(plain, plan);
      await postP(plan, { price_monthly: 25000 }, 2, 'everyone');
      expect((await checkoutAmount(old, plan)).amount).toBe(250);
      expect((await checkoutAmount(plain, plan)).amount).toBe(250);
      expect(await pinOf(old)).toBeNull();
    });

    it('the log row has before and after prices in paise, the choice and the snapshot; prices are stored in rupees', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 1000 });
      await putOnPlan(await newBusiness(), plan);
      await postP(plan, { price_monthly: 12345 }, 1, 'new_customers');
      expect(await livePrice(plan)).toBe(123.45);
      const [log] = await logsOf(plan, 'update_plan_prices');
      const [snap] = await snapshotsOf(plan);
      expect(log.details).toMatchObject({
        scope: 'new_customers', affected_businesses: 1, businesses_pinned: 1, terms_id: snap.id,
        before: { price_monthly: 10000 }, after: { price_monthly: 12345 },
      });
      expect(Number(snap.price_monthly)).toBe(100);
      expect(Number(snap.price_yearly)).toBe(1000);
    });

    it('a price save needs the count and a scope like the others, and platform admin only', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      const wrong = await postP(plan, { price_monthly: 25000 }, 0, 'everyone');
      expect(wrong.status).toBe(409);
      expect(await wrong.json()).toMatchObject({ code: 'CONFIRMATION_REQUIRED', affected_businesses: 1 });
      expect(await livePrice(plan)).toBe(100);
      (requirePlatformRequest as jest.Mock).mockResolvedValueOnce({ ok: false, response: new (require('next/server').NextResponse)(null, { status: 403 }) });
      const denied = await postP(plan, { price_monthly: 25000 }, 1, 'everyone');
      expect(denied.status).toBe(403);
      expect(await livePrice(plan)).toBe(100);
      expect(requirePlatformRequest).toHaveBeenLastCalledWith(expect.anything(), 'viewer', 'can_manage_plans');
    });

    it('GET returns the current prices in paise, the count and how many are on older terms', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 1000 });
      await putOnPlan(await newBusiness(), plan);
      await postP(plan, { price_monthly: 25000 }, 1, 'new_customers');
      const res = await getPrices(req(`/api/admin/plans/${plan}/prices`), ctx(plan));
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({
        planId: plan, affected_businesses: 1, on_older_terms: 1,
        prices: { price_monthly: 25000, price_yearly: 100000, price_3year: 0 },
      });
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('price validation (integer paise, at least Rs 1 or 0, never negative)', () => {
    it.each([
      ['below one rupee', { price_monthly: 99 }],
      ['negative', { price_monthly: -100 }],
      ['fractional paise', { price_monthly: 150.5 }],
      ['a string', { price_monthly: '15000' }],
      ['not a number', { price_monthly: Number.NaN }],
      ['null', { price_monthly: null }],
      ['too large for the column', { price_monthly: 10 ** 12 }],
      ['an unknown cycle', { price_weekly: 15000 }],
      ['yearly below one rupee', { price_monthly: 15000, price_yearly: 50 }],
      ['monthly 0 on a plan that sells yearly', { price_monthly: 0, price_yearly: 100000 }],
    ])('%s is refused with 400 and nothing changes', async (_name, prices) => {
      const plan = await newPlan({ monthly: 100, yearly: 1000 });
      const res = await postP(plan, prices as Record<string, unknown>, 0, 'everyone');
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_PRICE' });
      expect(await livePrice(plan)).toBe(100);
      expect(await livePrice(plan, 'price_yearly')).toBe(1000);
      expect(await logsOf(plan)).toHaveLength(0);
    });

    it('an empty price object is a 400', async () => {
      const plan = await newPlan();
      expect((await postP(plan, {}, 0, 'everyone')).status).toBe(400);
    });

    it('a plan priced at Rs 1 is accepted, charges Rs 1 at checkout and can complete', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 1000 });
      expect((await postP(plan, { price_monthly: 100, price_yearly: 0 }, 0, 'everyone')).status).toBe(200);
      expect(await livePrice(plan)).toBe(1);
      const biz = await newBusiness();
      const co = await checkoutAmount(biz, plan);
      expect(co.amount).toBe(1);
      expect(co.stored).toBe(1);
      const done = await completeSubscriptionCheckoutPaymentDetailed({
        businessId: biz, planId: plan, billingCycle: 'monthly', billingTransactionId: co.id, providerPaymentId: 'pay_' + randomUUID().slice(0, 8), amount: 1,
      });
      expect(done.completion).toBeTruthy();
      expect(await queryOne(`SELECT plan_id FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz])).toMatchObject({ plan_id: plan });
    });

    it('a pinned business on a Rs 1 plan keeps paying Rs 1 after the plan is raised for new customers', async () => {
      const plan = await newPlan({ monthly: 1, yearly: 0 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      await postP(plan, { price_monthly: 50000 }, 1, 'new_customers');
      expect((await checkoutAmount(old, plan)).amount).toBe(1);
      expect((await checkoutAmount(await newBusiness(), plan)).amount).toBe(500);
    });

    it('free plans: all prices 0 is accepted', async () => {
      const plan = await newPlan({ monthly: 0, yearly: 0 });
      const res = await postP(plan, { price_monthly: 0, price_yearly: 0, price_3year: 0 }, 0, 'everyone');
      expect(res.status).toBe(200);
      expect(await livePrice(plan)).toBe(0);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('more than one save', () => {
    it('a later "only new customers" save leaves earlier-pinned businesses on their own snapshot', async () => {
      const plan = await newPlan({ customers: 77 });
      const a = await newBusiness();
      await putOnPlan(a, plan);
      await postL(plan, { max_customers: 30 }, 1, 'new_customers'); // snapshot S1 = 77, A pinned
      const b = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: b, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' }); // gets 30
      const s1 = await pinOf(a);
      expect(s1).not.toBeNull();
      expect(await pinOf(b)).toBeNull();
      await postL(plan, { max_customers: 10 }, 2, 'new_customers'); // snapshot S2 = 30, B pinned, A stays on S1
      const c = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: c, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      expect(await pinOf(a)).toBe(s1);
      expect(await pinOf(b)).not.toBe(s1);
      expect(await pinOf(b)).not.toBeNull();
      expect(await pinOf(c)).toBeNull();
      expect(await capOf(a)).toBe(77);
      expect(await capOf(b)).toBe(30);
      expect(await capOf(c)).toBe(10);
      expect(await snapshotsOf(plan)).toHaveLength(2);
    });

    it('"everyone now" reaches pinned businesses on every snapshot, only for the keys it changes', async () => {
      const plan = await newPlan({ customers: 77 });
      const a = await newBusiness();
      await putOnPlan(a, plan);
      await postL(plan, { max_customers: 30 }, 1, 'new_customers'); // A pinned at customers 77
      const b = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: b, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      await postL(plan, { max_customers: 10 }, 2, 'new_customers'); // B pinned at customers 30
      // Everyone: a different limit changes; the customers limit is untouched by this save.
      const dflt = Number((await queryOne<{ d: number }>(`SELECT default_value AS d FROM platform_limits WHERE limit_key = 'max_items'`))!.d);
      await postL(plan, { max_items: dflt + 40 }, 2, 'everyone');
      expect((await resolveBusinessLimit(a, 'items', 'max_items')).maxLimit).toBe(dflt + 40);
      expect((await resolveBusinessLimit(b, 'items', 'max_items')).maxLimit).toBe(dflt + 40);
      expect(await capOf(a)).toBe(77);
      expect(await capOf(b)).toBe(30);
      // The same key, changed for everyone: both pinned businesses get it.
      await postL(plan, { max_customers: 99 }, 2, 'everyone');
      expect(await capOf(a)).toBe(99);
      expect(await capOf(b)).toBe(99);
      expect(await pinOf(a)).not.toBeNull(); // still on their snapshot, which now carries 99
    });

    it('everyone now: a feature removed reaches pinned businesses; a price change reaches their renewal', async () => {
      const plan = await newPlan({ monthly: 100 });
      const a = await newBusiness();
      await putOnPlan(a, plan);
      await postL(plan, { max_customers: 5 }, 1, 'new_customers'); // pins A
      await postP(plan, { price_monthly: 20000 }, 1, 'new_customers'); // A is on the older snapshot already; still 100
      expect((await checkoutAmount(a, plan)).amount).toBe(100);
      await postF(plan, { [F_BARCODE]: true }, 1, 'everyone');
      expect(await hasFeature(a, FeatureKeys.CUSTOM_BRANDING)).toBe(false);
      await postP(plan, { price_monthly: 30000 }, 1, 'everyone');
      expect((await checkoutAmount(a, plan)).amount).toBe(300);
      expect(await capOf(a)).toBe(77);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('changing plan clears the pin, in the same statement', () => {
    async function pinned(): Promise<{ plan: string; other: string; biz: string }> {
      const plan = await newPlan();
      const other = await newPlan({ monthly: 500 });
      const biz = await newBusiness();
      await putOnPlan(biz, plan);
      await postL(plan, { max_customers: 5 }, 1, 'new_customers');
      expect(await pinOf(biz)).not.toBeNull();
      return { plan, other, biz };
    }

    it('applyModuleSubscriptionPlanChange: another plan clears it; the same plan (renewal) keeps it', async () => {
      const { plan, other, biz } = await pinned();
      const pin = await pinOf(biz);
      await applyModuleSubscriptionPlanChange({ businessId: biz, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      expect(await pinOf(biz)).toBe(pin);
      await applyModuleSubscriptionPlanChange({ businessId: biz, moduleKey: 'billing', planId: other, billingCycle: 'monthly' });
      expect(await pinOf(biz)).toBeNull();
      // Coming back gets the current terms, not the old snapshot.
      await applyModuleSubscriptionPlanChange({ businessId: biz, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      expect(await pinOf(biz)).toBeNull();
      expect(await capOf(biz)).toBe(5);
    });

    it('a paid upgrade through checkout clears it', async () => {
      const { other, biz } = await pinned();
      const co = await checkoutAmount(biz, other);
      await completeSubscriptionCheckoutPaymentDetailed({
        businessId: biz, planId: other, billingCycle: 'monthly', billingTransactionId: co.id, providerPaymentId: 'pay_' + randomUUID().slice(0, 8), amount: co.stored,
      });
      expect(await pinOf(biz)).toBeNull();
    });

    it('moveModuleSubscriptionToFree clears it', async () => {
      const { plan, biz } = await pinned();
      await moveModuleSubscriptionToFree(biz, 'billing', plan, 'cancelled');
      expect(await pinOf(biz)).toBeNull();
      expect(await queryOne(`SELECT plan_id FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz])).toMatchObject({ plan_id: 'free' });
    });

    it('the admin subscription editor: another plan clears it, the same plan keeps it', async () => {
      const { plan, other, biz } = await pinned();
      const pin = await pinOf(biz);
      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', planId: plan, status: 'active' });
      expect(await pinOf(biz)).toBe(pin);
      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', planId: other, status: 'active' });
      expect(await pinOf(biz)).toBeNull();
    });

    it('upsertModuleSubscription (signup, add module): another plan clears it, the same plan keeps it', async () => {
      const { plan, other, biz } = await pinned();
      const pin = await pinOf(biz);
      await upsertModuleSubscription({ query }, biz, 'billing', plan, 'active', null);
      expect(await pinOf(biz)).toBe(pin);
      await upsertModuleSubscription({ query }, biz, 'billing', other, 'active', null);
      expect(await pinOf(biz)).toBeNull();
    });

    it('a scheduled downgrade that comes due clears it', async () => {
      const { plan, other, biz } = await pinned();
      await query(`UPDATE business_module_subscriptions SET plan_id = $2, scheduled_plan_id = $3, end_date = CURRENT_DATE - 1 WHERE business_id = $1`, [biz, other, plan]);
      // Pin the row to the other plan's snapshot too, so we see it cleared by the downgrade.
      await postL(other, { max_customers: 3 }, 1, 'new_customers');
      expect(await pinOf(biz)).not.toBeNull();
      await processExpiredModuleSubscriptions();
      expect(await queryOne(`SELECT plan_id, plan_terms_id FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz])).toMatchObject({ plan_id: plan, plan_terms_id: null });
    });

    it('every statement in lib/ and app/ that writes business_module_subscriptions.plan_id also sets plan_terms_id', () => {
      const walk = (dir: string): string[] =>
        readdirSync(dir).flatMap((n) => {
          const f = join(dir, n);
          if (statSync(f).isDirectory()) return n === 'node_modules' ? [] : walk(f);
          return /\.(ts|tsx)$/.test(n) ? [f] : [];
        });
      const files = [...walk(join(process.cwd(), 'lib')), ...walk(join(process.cwd(), 'app'))];
      const writers: string[] = [];
      for (const f of files) {
        const src = readFileSync(f, 'utf8');
        for (const stmt of src.split('`')) {
          if (!/(INSERT INTO|UPDATE)\s+business_module_subscriptions/.test(stmt)) continue;
          // An INSERT ... ON CONFLICT DO UPDATE SET plan_id = ..., or an UPDATE ... SET ... plan_id = <anything>.
          const setPart = stmt.split(/\bSET\b/).slice(1).join(' SET ').split(/\bWHERE\b/)[0];
          if (!/(^|[\s,])plan_id\s*=/.test(setPart)) continue;
          writers.push(f);
          expect({ file: f, pinCleared: /plan_terms_id/.test(stmt) }).toEqual({ file: f, pinCleared: true });
        }
      }
      expect(writers.length).toBeGreaterThanOrEqual(8);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('move businesses to the current terms', () => {
    it('GET shows how many are on older terms; a wrong count is refused; the right count moves them all, logged', async () => {
      const plan = await newPlan({ customers: 77 });
      const a = await newBusiness();
      const b = await newBusiness();
      await putOnPlan(a, plan);
      await putOnPlan(b, plan);
      await postL(plan, { max_customers: 5 }, 2, 'new_customers');
      const got = await getTerms(req(`/api/admin/plans/${plan}/terms`), ctx(plan));
      expect(await got.json()).toMatchObject({ planId: plan, on_older_terms: 2, affected_businesses: 2 });

      const bad = await postTerms(req(`/api/admin/plans/${plan}/terms`, { action: 'move_to_current', confirm_older_terms_count: 1 }), ctx(plan));
      expect(bad.status).toBe(409);
      expect(await bad.json()).toMatchObject({ code: 'CONFIRMATION_REQUIRED', on_older_terms: 2 });
      expect(await capOf(a)).toBe(77);

      const ok = await postTerms(req(`/api/admin/plans/${plan}/terms`, { action: 'move_to_current', confirm_older_terms_count: 2 }), ctx(plan));
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ success: true, moved: 2 });
      expect(await pinOf(a)).toBeNull();
      expect(await pinOf(b)).toBeNull();
      expect(await capOf(a)).toBe(5);
      expect(await capOf(b)).toBe(5);
      const [log] = await logsOf(plan, 'move_plan_businesses_to_current_terms');
      expect(log.details).toMatchObject({ moved_businesses: 2 });
      expect(await getTerms(req(`/api/admin/plans/${plan}/terms`), ctx(plan)).then((r) => r.json())).toMatchObject({ on_older_terms: 0 });
    });

    it('an unknown action is a 400 and a non-admin is refused', async () => {
      const plan = await newPlan();
      expect((await postTerms(req(`/api/admin/plans/${plan}/terms`, { action: 'nope' }), ctx(plan))).status).toBe(400);
      (requirePlatformRequest as jest.Mock).mockResolvedValueOnce({ ok: false, response: new (require('next/server').NextResponse)(null, { status: 403 }) });
      expect((await postTerms(req(`/api/admin/plans/${plan}/terms`, { action: 'move_to_current', confirm_older_terms_count: 0 }), ctx(plan))).status).toBe(403);
    });

    it('only that plan\'s businesses move', async () => {
      const p1 = await newPlan();
      const p2 = await newPlan();
      const a = await newBusiness();
      const b = await newBusiness();
      await putOnPlan(a, p1);
      await putOnPlan(b, p2);
      await postL(p1, { max_customers: 5 }, 1, 'new_customers');
      await postL(p2, { max_customers: 5 }, 1, 'new_customers');
      await postTerms(req(`/api/admin/plans/${p1}/terms`, { action: 'move_to_current', confirm_older_terms_count: 1 }), ctx(p1));
      expect(await pinOf(a)).toBeNull();
      expect(await pinOf(b)).not.toBeNull();
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('is the current plan paid: the business\'s own prices decide', () => {
    async function paidThenFreeForNewCustomers() {
      const plan = await newPlan({ monthly: 499, yearly: 0 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      await query(`UPDATE business_module_subscriptions SET end_date = CURRENT_DATE + 3 WHERE business_id = $1`, [old]);
      clearSubscriptionCache(old); clearModuleSubscriptionCache(old);
      expect((await postP(plan, { price_monthly: 0 }, 1, 'new_customers')).status).toBe(200);
      return { plan, old };
    }

    it('after a paid plan is made Rs 0 for new customers, a pinned renewal extends from its end date and pays its old price', async () => {
      const { plan, old } = await paidThenFreeForNewCustomers();
      const co = await checkoutAmount(old, plan);
      expect(co.amount).toBe(499);
      const prev = (await queryOne<{ e: string }>(`SELECT end_date::text AS e FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [old]))!.e;
      const preview = await (await previewGet(new NextRequest(`http://localhost/api/subscriptions/checkout/preview?plan_id=${plan}&billing_cycle=monthly`, {
        headers: { 'x-authenticated-business-id': old, 'x-authenticated-user-id': owner.get(old)! },
      }))).json();
      expect(preview.period_kind).toBe('renewal');
      await completeSubscriptionCheckoutPaymentDetailed({
        businessId: old, planId: plan, billingCycle: 'monthly', billingTransactionId: co.id, providerPaymentId: 'pay_' + randomUUID().slice(0, 8), amount: co.stored,
      });
      const after = await queryOne<{ ok: boolean }>(
        `SELECT (end_date = ($1::date + make_interval(months => 1))::date) AS ok FROM business_module_subscriptions WHERE business_id = $2 AND module_key = 'billing'`, [prev, old]);
      expect(after!.ok).toBe(true);
    });

    it('/api/subscriptions/upgrade does not move a pinned paying business to Free as if it were unpaid; an unpinned business on the Rs 0 plan can', async () => {
      const { plan, old } = await paidThenFreeForNewCustomers();
      const post = (b: string) => upgradePost(new NextRequest('http://localhost/api/subscriptions/upgrade', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-authenticated-business-id': b, 'x-authenticated-user-id': owner.get(b)! },
        body: JSON.stringify({ plan_id: 'free', module_key: 'billing' }),
      }));
      const res = await post(old);
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'USE_DOWNGRADE' });
      expect(await queryOne(`SELECT plan_id FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [old])).toMatchObject({ plan_id: plan });
      const fresh = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: fresh, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      expect(await pinOf(fresh)).toBeNull();
      const ok = await post(fresh);
      expect(ok.status).toBe(200);
    });

    it('a pinned business still gets renewal reminders; an unpinned one on the Rs 0 plan does not', async () => {
      const { plan, old } = await paidThenFreeForNewCustomers();
      const fresh = await newBusiness();
      await applyModuleSubscriptionPlanChange({ businessId: fresh, moduleKey: 'billing', planId: plan, billingCycle: 'monthly' });
      await query(`UPDATE business_module_subscriptions SET end_date = CURRENT_DATE + 3 WHERE business_id = $1`, [fresh]);
      for (const b of [old, fresh]) await query(`UPDATE businesses SET email = $2 WHERE id = $1`, [b, `pcs-${b.slice(0, 8)}@example.test`]);
      await sendRenewalReminders();
      const n = async (b: string) => Number((await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM subscription_notifications WHERE business_id = $1 AND notification_type LIKE 'renewal_reminder_%'`, [b]))!.n);
      expect(await n(old)).toBe(1);
      expect(await n(fresh)).toBe(0);
      await query(`DELETE FROM subscription_notifications WHERE business_id = ANY($1::uuid[])`, [[old, fresh]]);
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('review fixes', () => {
    it('a save and "move to current terms" clear the module-subscription cache: getBusinessSubscription shows the right terms at once', async () => {
      const plan = await newPlan({ customers: 77 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      expect((await getBusinessSubscription(old))!.features.limits.max_customers).toBe(77); // primes both caches
      await postL(plan, { max_customers: 5 }, 1, 'new_customers');
      expect((await getBusinessSubscription(old))!.features.limits.max_customers).toBe(77);
      await postTerms(req(`/api/admin/plans/${plan}/terms`, { action: 'move_to_current', confirm_older_terms_count: 1 }), ctx(plan));
      expect((await getBusinessSubscription(old))!.features.limits.max_customers).toBe(5);
    });

    it('the AI reply quota follows the pin immediately after a save', async () => {
      const plan = `pcsc_${randomUUID().slice(0, 8)}`;
      plans.push(plan);
      await query(
        `INSERT INTO subscription_plans (id, name, display_name, description, price_monthly, price_yearly, price_3year, currency, features, is_active, sort_order, product_line)
         VALUES ($1, $1, 'Scope connect', 'x', 100, 1000, 0, 'INR', '{}'::jsonb, true, 99, 'connect')`, [plan]);
      await query(`INSERT INTO subscription_plan_features (plan_id, feature_id, enabled) VALUES ($1, 'integration_whatsapp_bot', true)`, [plan]);
      await query(`INSERT INTO subscription_plan_limits (plan_id, limit_key, limit_value) VALUES ($1, 'max_ai_replies_per_month', 500)`, [plan]);
      const biz = await newBusiness();
      await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'connect', true, 'test')`, [biz]);
      await query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
         VALUES ($1, 'connect', $2, 'active', CURRENT_DATE - 5, CURRENT_DATE + 20, 'monthly')`, [biz, plan]);
      expect(await khatarioMonthlyQuota(biz)).toBe(500); // primes the module-subscription cache
      expect((await postL(plan, { max_ai_replies_per_month: 50 }, 1, 'new_customers')).status).toBe(200);
      expect(await khatarioMonthlyQuota(biz)).toBe(500);
      const fresh = await newBusiness();
      await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'connect', true, 'test')`, [fresh]);
      await query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
         VALUES ($1, 'connect', $2, 'active', CURRENT_DATE, CURRENT_DATE + 20, 'monthly')`, [fresh, plan]);
      expect(await khatarioMonthlyQuota(fresh)).toBe(50);
    });

    it('"everyone" price save copies the whole price set into snapshots: no snapshot keeps a cycle the plan no longer sells', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 0 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      await postP(plan, { price_monthly: 20000, price_yearly: 200000 }, 1, 'new_customers'); // snapshot: 100 / 0 ; live 200 / 2000
      await postP(plan, { price_yearly: 0 }, 1, 'everyone'); // live: 200 / 0
      await postP(plan, { price_monthly: 0, price_yearly: 0 }, 1, 'everyone'); // free for everyone
      const [snap] = await snapshotsOf(plan);
      expect([Number(snap.price_monthly), Number(snap.price_yearly), Number(snap.price_3year)]).toEqual([0, 0, 0]);
    });

    it('a pin that belongs to another plan is ignored by the feature query: the live matrix is read', async () => {
      const a = await newPlan({ features: [F_BARCODE] });
      const b = await newPlan({ features: [F_BARCODE, F_BRANDING] });
      const biz = await newBusiness();
      await putOnPlan(biz, a);
      await postL(b, { max_customers: 1 }, 0, 'everyone');
      await putOnPlan(await newBusiness(), b);
      await postF(b, { [F_BARCODE]: true }, 1, 'new_customers');
      const foreign = (await snapshotsOf(b))[0].id as string;
      const q = planEnabledFeaturesQuery(a, foreign);
      const rows = (await query(q.sql, q.params)).rows.map((r: any) => r.id);
      expect(rows).toEqual([F_BARCODE]);
    });

    it('the admin editor marking a pinned row cancelled clears the pin', async () => {
      const plan = await newPlan();
      const biz = await newBusiness();
      await putOnPlan(biz, plan);
      await postL(plan, { max_customers: 5 }, 1, 'new_customers');
      expect(await pinOf(biz)).not.toBeNull();
      await adminUpdateSubscription({ businessId: biz, adminId, moduleKey: 'billing', planId: plan, status: 'cancelled' });
      expect(await pinOf(biz)).toBeNull();
    });

    it('POST /api/admin/subscriptions/plans: same prices pass, a different price on an existing plan is 409 and writes nothing, a new plan with Rs 0.50 is 400', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 1000 });
      const post = (body: Record<string, unknown>) =>
        adminPlanUpsert(req('/api/admin/subscriptions/plans', { id: plan, name: 'n', display_name: 'Renamed', description: 'd', price_monthly: 100, price_yearly: 1000, price_3year: 0, features: {}, ...body }));
      expect((await post({})).status).toBe(201);
      expect(await queryOne(`SELECT display_name FROM subscription_plans WHERE id = $1`, [plan])).toMatchObject({ display_name: 'Renamed' });
      const diff = await post({ price_monthly: 999, display_name: 'Nope' });
      expect(diff.status).toBe(409);
      expect(await diff.json()).toMatchObject({ code: 'USE_PRICE_ROUTE' });
      expect(await livePrice(plan)).toBe(100);
      expect(await queryOne(`SELECT display_name FROM subscription_plans WHERE id = $1`, [plan])).toMatchObject({ display_name: 'Renamed' });
      const newId = `pcs_${randomUUID().slice(0, 8)}`;
      plans.push(newId);
      const bad = await adminPlanUpsert(req('/api/admin/subscriptions/plans', { id: newId, name: 'n', display_name: 'New', price_monthly: 0.5, price_yearly: 0, features: {} }));
      expect(bad.status).toBe(400);
      expect(await queryOne(`SELECT 1 FROM subscription_plans WHERE id = $1`, [newId])).toBeNull();
    });
  });

  // -------------------------------------------------------------------------------------------
  describe('screens', () => {
    it('GET features and limits return affected_businesses and on_older_terms', async () => {
      const plan = await newPlan();
      await putOnPlan(await newBusiness(), plan);
      await postL(plan, { max_customers: 5 }, 1, 'new_customers');
      for (const get of [getFeatures, getLimits]) {
        const res = await get(req(`/api/admin/plans/${plan}/x`), ctx(plan));
        expect(await res.json()).toMatchObject({ affected_businesses: 1, on_older_terms: 1 });
      }
    });

    it('Plan & billing shows the limits and prices a pinned business actually has', async () => {
      const plan = await newPlan({ monthly: 100, yearly: 1000, customers: 77 });
      const old = await newBusiness();
      await putOnPlan(old, plan);
      await postL(plan, { max_customers: 5 }, 1, 'new_customers');
      await postP(plan, { price_monthly: 25000 }, 1, 'new_customers');
      const res = await currentGet(new NextRequest('http://localhost/api/subscriptions/current', {
        headers: { 'x-authenticated-business-id': old, 'x-authenticated-user-id': owner.get(old)! },
      }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.subscription.features.limits.max_customers).toBe(77);
      expect(Number(body.subscription.price_monthly)).toBe(100);
      expect(body.subscription.enabled_features.map((f: any) => f.id).sort()).toEqual([F_BARCODE, F_BRANDING].sort());
    });
  });
});
