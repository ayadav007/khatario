/**
 * Renewal, upgrade credit, refunds and GST line (plan 2026-11-27) against real PostgreSQL.
 * Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/renewal-refund-gst.db.test.ts --runInBand --forceExit
 * Other tasks of the plan add their own describe blocks and helpers to this file.
 */
import { createHmac, randomUUID } from 'crypto';

process.env.PLATFORM_RAZORPAY_KEY_ID = 'rzp_test_plan';
process.env.PLATFORM_RAZORPAY_KEY_SECRET = 'k';
process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET = 'whsec_plan';
process.env.PLATFORM_EASEBUZZ_KEY = 'PLATKEY';
process.env.PLATFORM_EASEBUZZ_SALT = 'PLATSALT';

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
jest.mock('@/lib/platform-push', () => ({ sendPlatformAdminPush: jest.fn(async () => undefined) }));
jest.mock('@/lib/whatsapp', () => ({ sendWhatsAppMessage: jest.fn(async () => undefined) }));
jest.mock('@/lib/jwt', () => ({
  clearSessionCookie: jest.fn(),
  setSessionCookies: jest.fn(),
  signAccessToken: jest.fn(async () => 'access-token'),
  signRefreshToken: jest.fn(async () => 'refresh-token'),
}));
// The recurring-invoice job and its feature check run with no request (cron): headers carry nothing.
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { query, queryOne, closePool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { processPlatformRazorpayWebhook, recordBillingTransaction } from '@/lib/platform-billing';
import { resolveNewPeriod } from '@/lib/subscription/period';
import { computeUpgradeCredit } from '@/lib/subscription/upgrade-credit';
import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';
import { createSubscriptionCheckout } from '@/lib/platform-subscription-checkout';
import { NextRequest } from 'next/server';
import { POST as checkoutPost } from '@/app/api/subscriptions/checkout/route';
import { refundableAmountPaise } from '@/lib/subscription/upgrade-credit';
import { findRejectedUpgradeCredits, reportBillingAnomalies } from '@/lib/subscription/reconcile-payments';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { processExpiredModuleSubscriptions } from '@/lib/subscription/lifecycle';
import { moveModuleSubscriptionToFree } from '@/lib/subscription/module-plan-lifecycle';
import {
  getModuleSubscription,
  getOperationalModuleSubscriptions,
  getEntitlementPlanIdForModuleSub,
} from '@/lib/subscription/module-subscriptions';
import { GRACE_DAYS, getSubscriptionUsability, getPaidGraceEndDate } from '@/lib/subscription/effective-plan';
import { sendPendingNotifications, sendRenewalReminders } from '@/lib/subscription/notifications';
import { GET as currentGet } from '@/app/api/subscriptions/current/route';
import { POST as cancelPost } from '@/app/api/subscriptions/cancel/route';
import { POST as cancelUndoPost } from '@/app/api/subscriptions/cancel/undo/route';
import { GET as modulesCurrentGet } from '@/app/api/subscriptions/modules/current/route';
import { runRecurringInvoices } from '@/lib/invoices/recurring';
import { getPool } from '@/lib/db';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BillingCycle } from '@/lib/subscription/apply-plan-change';

const run = enabled ? describe : describe.skip;

run('renewal, refund and GST (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  const coupons: string[] = [];
  let biz: string;
  const adminOf = new Map<string, string>();

  // ---- helpers shared by every task's tests in this file ----

  async function newBusiness(label = 'ren'): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Renewal ${label} ${id.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [id]);
    const adminId = randomUUID();
    adminOf.set(id, adminId);
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [adminId, id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
    );
    return id;
  }

  /** The database's CURRENT_DATE + n days / months, as text (so tests and SQL agree on "today"). */
  async function daysFromToday(n: number): Promise<string> {
    const r = await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [n]);
    return r!.d;
  }
  async function monthsFromToday(n: number): Promise<string> {
    const r = await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + make_interval(months => $1::int))::date::text AS d`, [n]);
    return r!.d;
  }
  async function addMonths(date: string, n: number): Promise<string> {
    const r = await queryOne<{ d: string }>(`SELECT ($1::date + make_interval(months => $2::int))::date::text AS d`, [date, n]);
    return r!.d;
  }

  /** Put the billing module row into a known state; dates are day offsets from the database's today. */
  async function setRow(
    businessId: string,
    planId: string,
    opts: {
      status?: string;
      startOffset?: number;
      endOffset?: number | null;
      graceOffset?: number | null;
      trialEndOffset?: number | null;
      cycle?: BillingCycle;
    } = {},
  ): Promise<void> {
    const off = (n: number | null | undefined) => (n === null || n === undefined ? null : n);
    await query(
      `INSERT INTO business_module_subscriptions
         (business_id, module_key, plan_id, status, start_date, end_date, grace_period_end, trial_end_date, billing_cycle)
       VALUES ($1, 'billing', $2, $3, CURRENT_DATE + $4::int,
               CASE WHEN $5::int IS NULL THEN NULL ELSE CURRENT_DATE + $5::int END,
               CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END,
               CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END,
               $8)
       ON CONFLICT (business_id, module_key) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date, grace_period_end = EXCLUDED.grace_period_end,
         trial_end_date = EXCLUDED.trial_end_date, billing_cycle = EXCLUDED.billing_cycle,
         scheduled_plan_id = NULL, updated_at = CURRENT_TIMESTAMP`,
      [
        businessId,
        planId,
        opts.status ?? 'active',
        opts.startOffset ?? 0,
        off(opts.endOffset),
        off(opts.graceOffset),
        off(opts.trialEndOffset),
        opts.cycle ?? 'monthly',
      ],
    );
    clearSubscriptionCache(businessId);
    clearModuleSubscriptionCache(businessId);
  }

  async function moduleRow(businessId: string) {
    return queryOne<{ plan_id: string; status: string; billing_cycle: string | null; start_date: string; end_date: string | null }>(
      `SELECT plan_id, status, billing_cycle, start_date::text, end_date::text
       FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`,
      [businessId],
    );
  }

  async function planPrice(planId: string, cycle: BillingCycle = 'monthly'): Promise<number> {
    const col = cycle === 'yearly' ? 'price_yearly' : cycle === 'three_year' ? 'price_3year' : 'price_monthly';
    const p = await queryOne<{ p: string }>(`SELECT ${col}::text AS p FROM subscription_plans WHERE id = $1`, [planId]);
    return Number(p!.p);
  }

  async function pendingCheckout(
    businessId: string,
    planId: string,
    amount: number,
    opts: { cycle?: BillingCycle; couponId?: string } = {},
  ): Promise<string> {
    const { id } = await recordBillingTransaction({
      businessId,
      planId,
      amount,
      couponId: opts.couponId,
      billingCycle: opts.cycle ?? 'monthly',
      paymentMethod: 'razorpay',
      status: 'pending',
      skipEmails: true,
    });
    await query(
      `UPDATE billing_transactions SET gateway_response = '{"checkout_type":"subscription","provider":"razorpay"}'::jsonb WHERE id = $1`,
      [id],
    );
    return id;
  }

  async function txRow(id: string) {
    return queryOne<{ status: string; period_start: string | null; period_end: string | null }>(
      `SELECT status, period_start::text, period_end::text FROM billing_transactions WHERE id = $1`,
      [id],
    );
  }

  function notesFor(businessId: string, tx: string, planId: string, cycle: BillingCycle = 'monthly') {
    return { business_id: businessId, billing_transaction_id: tx, plan_id: planId, billing_cycle: cycle };
  }

  /** Build, sign and deliver a Razorpay webhook to the real platform handler. */
  function hook(event: string, payId: string, payStatus: string, notes: Record<string, unknown>, amountPaise: number) {
    const raw = JSON.stringify({ event, payload: { payment: { entity: { id: payId, status: payStatus, amount: amountPaise, notes } } } });
    const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
    return processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': sig });
  }

  const sfx = () => randomUUID().slice(0, 10);

  /** One real payment through the signed webhook. Returns the billing transaction id. */
  async function paidAndActivated(
    businessId: string,
    planId: string,
    opts: { cycle?: BillingCycle; amount?: number; couponId?: string } = {},
  ): Promise<string> {
    const cycle = opts.cycle ?? 'monthly';
    const amount = opts.amount ?? (await planPrice(planId, cycle));
    const tx = await pendingCheckout(businessId, planId, amount, { cycle, couponId: opts.couponId });
    const r = await hook('payment.captured', 'pay_ren_' + sfx(), 'captured', notesFor(businessId, tx, planId, cycle), Math.round(amount * 100));
    expect(r).toMatchObject({ ok: true });
    return tx;
  }

  async function makeCoupon(type: 'free_months', value: number): Promise<string> {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, $2, $3, 1) RETURNING id`,
      [`RN${randomUUID().slice(0, 10).toUpperCase()}`, type, value],
    );
    coupons.push(r!.id);
    return r!.id;
  }

  beforeAll(async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
  });

  beforeEach(async () => {
    biz = await newBusiness();
    clearSubscriptionCache(biz);
    clearModuleSubscriptionCache(biz);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of created) {
        await query(`DELETE FROM platform_billing_webhook_events WHERE business_id = $1 OR payload::text LIKE $2`, [id, `%${id}%`]).catch(() => undefined);
        await query(`DELETE FROM subscription_events WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      for (const id of coupons) {
        await query(`DELETE FROM coupon_redemptions WHERE coupon_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM coupons WHERE id = $1`, [id]).catch(() => undefined);
      }
      await closePool();
    }
  });

  // ---- Task 1: renewing extends the paid period ----

  describe('renewal extends the paid period', () => {
    it('renewing 10 days early moves the end out one month from the old end and keeps the start', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -20, endOffset: 10 });
      const before = await moduleRow(biz);
      const tx = await paidAndActivated(biz, 'billing_growth');
      const after = await moduleRow(biz);
      expect(after!.start_date).toBe(before!.start_date);
      expect(after!.end_date).toBe(await addMonths(before!.end_date!, 1));
      expect(await txRow(tx)).toMatchObject({ period_start: before!.end_date, period_end: after!.end_date });
    });

    it('renewing on the last day follows the same rule', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -30, endOffset: 0 });
      const before = await moduleRow(biz);
      const tx = await paidAndActivated(biz, 'billing_growth');
      const after = await moduleRow(biz);
      expect(after!.start_date).toBe(before!.start_date);
      expect(after!.end_date).toBe(await addMonths(before!.end_date!, 1));
      expect(await txRow(tx)).toMatchObject({ period_start: before!.end_date, period_end: after!.end_date });
    });

    it('renewing the day after the end (in grace) starts a new period today', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -31, endOffset: -1, graceOffset: 3 });
      const tx = await paidAndActivated(biz, 'billing_growth');
      const after = await moduleRow(biz);
      expect(after!.start_date).toBe(await daysFromToday(0));
      expect(after!.end_date).toBe(await monthsFromToday(1));
      expect(await txRow(tx)).toMatchObject({ period_start: after!.start_date, period_end: after!.end_date });
    });

    it('a yearly purchase then a monthly renewal of the same plan adds one month to the yearly end', async () => {
      await paidAndActivated(biz, 'billing_growth', { cycle: 'yearly' });
      const afterYear = await moduleRow(biz);
      expect(afterYear!.end_date).toBe(await monthsFromToday(12));
      await paidAndActivated(biz, 'billing_growth', { cycle: 'monthly' });
      const afterMonth = await moduleRow(biz);
      expect(afterMonth!.end_date).toBe(await addMonths(afterYear!.end_date!, 1));
      expect(afterMonth!.start_date).toBe(afterYear!.start_date);
      expect(afterMonth!.billing_cycle).toBe('monthly');
    });

    it('a different plan is a change: it starts today, and coupon free months go after the base period', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -20, endOffset: 10 });
      const coupon = await makeCoupon('free_months', 2);
      const tx = await paidAndActivated(biz, 'billing_growth', { couponId: coupon });
      const after = await moduleRow(biz);
      expect(after!.plan_id).toBe('billing_growth');
      expect(after!.start_date).toBe(await daysFromToday(0));
      const base = await monthsFromToday(1);
      expect(after!.end_date).toBe(await addMonths(base, 2));
      expect(await txRow(tx)).toMatchObject({ period_start: after!.start_date, period_end: after!.end_date });
    });

    it('two checkouts completed at the same time each add their own month', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -20, endOffset: 10 });
      const before = await moduleRow(biz);
      const price = await planPrice('billing_growth');
      const a = await pendingCheckout(biz, 'billing_growth', price);
      const b = await pendingCheckout(biz, 'billing_growth', price);
      const results = await Promise.all(
        [a, b].map((tx) =>
          hook('payment.captured', 'pay_ren_' + sfx(), 'captured', notesFor(biz, tx, 'billing_growth'), Math.round(price * 100)),
        ),
      );
      results.forEach((r) => expect(r).toMatchObject({ ok: true }));
      const after = await moduleRow(biz);
      const e1 = await addMonths(before!.end_date!, 1);
      const e2 = await addMonths(before!.end_date!, 2);
      expect(after!.end_date).toBe(e2);
      const ra = await txRow(a);
      const rb = await txRow(b);
      expect([ra!.status, rb!.status]).toEqual(['completed', 'completed']);
      const periods = [ra!, rb!]
        .map((r) => ({ period_start: r.period_start, period_end: r.period_end }))
        .sort((x, y) => (x.period_start! < y.period_start! ? -1 : 1));
      expect(periods).toEqual([
        { period_start: before!.end_date, period_end: e1 },
        { period_start: e1, period_end: e2 },
      ]);
    });

    it('the upgrade event records the period kind', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -20, endOffset: 10 });
      await paidAndActivated(biz, 'billing_growth');
      const ev = await queryOne<{ details: Record<string, unknown> }>(
        `SELECT details FROM subscription_events WHERE business_id = $1 AND event_type = 'upgraded' ORDER BY created_at DESC LIMIT 1`,
        [biz],
      );
      expect(ev!.details).toMatchObject({ period_kind: 'renewal' });
    });
  });

  describe('resolveNewPeriod', () => {
    // Far-future dates keep these renewals "active, end today or later" whatever the real date is.
    const base = { plan_id: 'billing_growth', status: 'active', start_date: '2098-12-31', trial_end_date: null };

    it('31 January + 1 month ends on the last day of February', async () => {
      const p = await resolveNewPeriod({
        current: { ...base, end_date: '2099-01-31' }, targetPlanId: 'billing_growth', billingCycle: 'monthly', currentPlanIsPaid: true,
      });
      expect(p).toMatchObject({ kind: 'renewal', startDate: '2098-12-31', endDate: '2099-02-28' });
      const leap = await resolveNewPeriod({
        current: { ...base, end_date: '2096-01-31' }, targetPlanId: 'billing_growth', billingCycle: 'monthly', currentPlanIsPaid: true,
      });
      expect(leap.endDate).toBe('2096-02-29');
    });

    it('a free current plan is never a renewal, even for the same plan', async () => {
      const today = await daysFromToday(0);
      const p = await resolveNewPeriod({
        current: { ...base, plan_id: 'free', end_date: await daysFromToday(10) }, targetPlanId: 'free', billingCycle: 'monthly', currentPlanIsPaid: false,
      });
      expect(p.kind).toBe('change');
      expect(p.startDate).toBe(today);
    });

    it('no row is a fresh period starting at the database date', async () => {
      const p = await resolveNewPeriod({ current: null, targetPlanId: 'billing_growth', billingCycle: 'yearly', currentPlanIsPaid: false });
      expect(p).toMatchObject({ kind: 'fresh', startDate: await daysFromToday(0), endDate: await monthsFromToday(12) });
    });

    it('unused trial days are added after the cycle on a change', async () => {
      const p = await resolveNewPeriod({
        current: { plan_id: 'trial', status: 'trial', start_date: await daysFromToday(-5), end_date: null, trial_end_date: await daysFromToday(9) },
        targetPlanId: 'billing_growth', billingCycle: 'monthly', currentPlanIsPaid: false,
      });
      expect(p.kind).toBe('change');
      expect(p.trialDaysCarried).toBe(9);
      const expected = await queryOne<{ d: string }>(`SELECT ((CURRENT_DATE + make_interval(months => 1))::date + 9)::text AS d`);
      expect(p.endDate).toBe(expected!.d);
    });

    it('a trial that ended carries no days; a non-trial plan with a trial date carries none', async () => {
      const ended = await resolveNewPeriod({
        current: { plan_id: 'trial', status: 'trial', start_date: await daysFromToday(-30), end_date: null, trial_end_date: await daysFromToday(-2) },
        targetPlanId: 'billing_growth', billingCycle: 'monthly', currentPlanIsPaid: false,
      });
      expect(ended.trialDaysCarried).toBe(0);
      expect(ended.endDate).toBe(await monthsFromToday(1));
      const nonTrial = await resolveNewPeriod({
        current: { ...base, plan_id: 'billing_starter', end_date: await daysFromToday(3), trial_end_date: await daysFromToday(9) },
        targetPlanId: 'billing_growth', billingCycle: 'monthly', currentPlanIsPaid: true,
      });
      expect(nonTrial.trialDaysCarried).toBe(0);
    });

    it('a change period starts at the database CURRENT_DATE', async () => {
      const dbToday = await queryOne<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
      const p = await resolveNewPeriod({
        current: { ...base, plan_id: 'billing_starter', end_date: await daysFromToday(3) },
        targetPlanId: 'billing_growth', billingCycle: 'monthly', currentPlanIsPaid: true,
      });
      expect(p.kind).toBe('change');
      expect(p.startDate).toBe(dbToday!.d);
    });

    it('period code uses no JavaScript clock for period values', () => {
      for (const f of ['lib/subscription/period.ts', 'lib/subscription/apply-module-plan-change.ts']) {
        const src = readFileSync(join(process.cwd(), f), 'utf8');
        expect(src).not.toMatch(/new Date\(/);
        expect(src).not.toMatch(/Date\.now\(/);
      }
    });
  });

  // ---- Task 2: an upgrade gets credit for unused paid time ----

  describe('upgrade credit', () => {
    /** A completed payment with a recorded paid period (day offsets from the database's today). */
    async function insertPaid(
      businessId: string,
      planId: string,
      amount: number,
      startOff: number | null,
      endOff: number | null,
      opts: { status?: string; moduleKey?: string; cycle?: BillingCycle } = {},
    ): Promise<string> {
      const r = await queryOne<{ id: string }>(
        `INSERT INTO billing_transactions
           (business_id, type, status, amount, total_amount, plan_id, module_key, billing_cycle, payment_method,
            period_start, period_end, gateway_response)
         VALUES ($1, 'payment', $2, $3, $3, $4, $5, $6, 'razorpay',
                 CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END,
                 CASE WHEN $8::int IS NULL THEN NULL ELSE CURRENT_DATE + $8::int END,
                 '{"checkout_type":"subscription","provider":"razorpay"}'::jsonb)
         RETURNING id`,
        [businessId, opts.status ?? 'completed', amount, planId, opts.moduleKey ?? 'billing', opts.cycle ?? 'monthly', startOff, endOff],
      );
      return r!.id;
    }

    async function txMeta(id: string) {
      return queryOne<{ metadata: Record<string, any>; total_amount: string; status: string }>(
        `SELECT metadata, total_amount::text, status FROM billing_transactions WHERE id = $1`,
        [id],
      );
    }

    /** Start a real checkout with the gateway call stubbed; returns the pending row id and the quoted amount. */
    async function startCheckout(businessId: string, planId: string, couponCode?: string) {
      const spy = jest
        .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
        .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
      try {
        const r = await createSubscriptionCheckout({ businessId, planId, billingCycle: 'monthly', couponCode });
        const sent = (spy.mock.calls[0][0] as { amount: number }).amount;
        return { tx: r.billingTransactionId, amount: r.amount, sentToGateway: sent, result: r };
      } finally {
        spy.mockRestore();
      }
    }

    const priceStarter = 299;
    const priceGrowth = 499;

    it('Starter paid 10 days ago (30-day period) upgrading to Growth gets 20/30 of the payment back', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      const src = await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      const c = await computeUpgradeCredit(biz, 'billing', 'billing_growth');
      expect(c).toMatchObject({ amount: 199.33, fromTransactionId: src, unusedDays: 20, periodDays: 30 });
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
      expect(p).toMatchObject({ baseAmount: priceGrowth, creditApplied: 199.33, creditAvailable: 199.33, creditUnused: 0, creditFromTransactionId: src, finalAmount: 299.67 });
    });

    it('a yearly Business payment with 11 months left gives no credit towards another product (Connect)', async () => {
      await setRow(biz, 'billing_business', { startOffset: -30, endOffset: 335, cycle: 'yearly' });
      await insertPaid(biz, 'billing_business', 7199, -30, 335, { cycle: 'yearly' });
      const c = await computeUpgradeCredit(biz, 'connect', 'connect');
      expect(c.amount).toBe(0);
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'connect', billingCycle: 'monthly' });
      expect(p).toMatchObject({ creditApplied: 0, finalAmount: await planPrice('connect') });
    });

    it('credit larger than the new price charges Rs 1 and records credit = price - 1', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -1, endOffset: 29 });
      await insertPaid(biz, 'billing_starter', 5000, -1, 29);
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
      expect(p).toMatchObject({ finalAmount: 1, creditApplied: priceGrowth - 1, creditAvailable: 4833.33, creditUnused: 4335.33 });
      const { tx, amount, sentToGateway } = await startCheckout(biz, 'billing_growth');
      expect(amount).toBe(1);
      expect(sentToGateway).toBe(1);
      const row = await txMeta(tx);
      expect(Number(row!.total_amount)).toBe(1);
      expect(row!.metadata.upgrade_credit.amount).toBe(priceGrowth - 1);
    });

    it('a payment with no recorded period gives no credit', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_starter', priceStarter, null, null);
      expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(0);
    });

    it('a same-plan renewal and a downgrade get no credit', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_growth', priceGrowth, -10, 20);
      expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(0);
      expect((await computeUpgradeCredit(biz, 'billing', 'billing_starter')).amount).toBe(0);
    });

    it('tier decides, not price: a dearer plan of a lower tier gets no credit', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_growth', priceGrowth, -10, 20);
      await query(`UPDATE subscription_plans SET price_monthly = 9999 WHERE id = 'billing_starter'`);
      try {
        expect((await computeUpgradeCredit(biz, 'billing', 'billing_starter')).amount).toBe(0);
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'billing_starter'`, [priceStarter]);
      }
    });

    it('refunded, pending and failed payments give no credit', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      for (const status of ['refunded', 'pending', 'failed']) await insertPaid(biz, 'billing_starter', priceStarter, -10, 20, { status });
      expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(0);
    });

    it('every completed payment whose period is current or ahead counts, each by its own days', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 50 });
      const a = await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      const b = await insertPaid(biz, 'billing_starter', priceStarter, 20, 50);
      await insertPaid(biz, 'billing_starter', priceStarter, -40, -10); // already used up
      const c = await computeUpgradeCredit(biz, 'billing', 'billing_growth');
      expect(c.amount).toBe(498.33); // 199.33 + 299.00
      expect(c.unusedDays).toBe(50);
      expect(c.fromTransactionId).not.toBeNull();
      expect(c.fromTransactionIds.sort()).toEqual([a, b].sort());
    });

    it('a Rs 1 plan still checks out at Rs 1 even with credit available', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_growth'`);
      try {
        const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
        expect(p).toMatchObject({ baseAmount: 1, finalAmount: 1, creditApplied: 0 });
        const { amount } = await startCheckout(biz, 'billing_growth');
        expect(amount).toBe(1);
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'billing_growth'`, [priceGrowth]);
      }
    });

    it('coupon first, then credit: both reduce the charge', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      const code = `RC${randomUUID().slice(0, 10).toUpperCase()}`;
      const cp = await queryOne<{ id: string }>(
        `INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, 'percentage', 10, 1) RETURNING id`,
        [code],
      );
      coupons.push(cp!.id);
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', couponCode: code });
      expect(p.discountAmount).toBe(49.9);
      expect(p.creditApplied).toBe(199.33);
      expect(p.finalAmount).toBe(249.77); // 499 - 49.90 - 199.33
    });

    it('the amount check passes for the credited amount and fails for the uncredited one', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      const bad = await startCheckout(biz, 'billing_growth');
      expect(bad.amount).toBe(299.67);
      const full = await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, bad.tx, 'billing_growth'), priceGrowth * 100);
      expect(full).toMatchObject({ ok: false, error: 'Amount mismatch' });
      expect((await txRow(bad.tx))!.status).toBe('pending');
      expect((await moduleRow(biz))!.plan_id).toBe('billing_starter');
      const ok = await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, bad.tx, 'billing_growth'), 29967);
      expect(ok).toMatchObject({ ok: true });
      expect((await moduleRow(biz))!.plan_id).toBe('billing_growth');
    });

    it('a used credit source cannot be claimed again by a second upgrade', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      const src = await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      const first = await startCheckout(biz, 'billing_growth');
      expect(first.result.amount).toBe(299.67);
      await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, first.tx, 'billing_growth'), 29967);
      expect((await txMeta(src))!.metadata.credit_consumed_by).toBe(first.tx);
      // Growth is now the current plan; its own fresh payment is the only source for the next step.
      expect((await moduleRow(biz))!.plan_id).toBe('billing_growth');
      const next = await computeUpgradeCredit(biz, 'billing', 'billing_business');
      expect(next.fromTransactionIds).toEqual([first.tx]);
      expect(next.fromTransactionIds).not.toContain(src);
      // Even if the module row were put back on Starter, the consumed payment stays spent.
      await setRow(biz, 'billing_starter', { startOffset: -1, endOffset: 29 });
      expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(0);
    });

    it('no credit and no stored credit when none applies (charge unchanged)', async () => {
      await setRow(biz, 'free', { startOffset: -10, endOffset: null });
      const { tx, amount } = await startCheckout(biz, 'billing_growth');
      expect(amount).toBe(priceGrowth);
      const row = await txMeta(tx);
      expect(row!.metadata?.upgrade_credit).toBeUndefined();
      expect(Number(row!.total_amount)).toBe(priceGrowth);
    });

    // ---- fix round 1 ----

    function checkoutRoute(businessId: string, body: Record<string, unknown>) {
      return checkoutPost(
        new NextRequest('http://localhost/api/subscriptions/checkout', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-authenticated-business-id': businessId,
            'x-authenticated-user-id': adminOf.get(businessId)!,
          },
          body: JSON.stringify(body),
        }),
      );
    }

    /** Days a shortened payment buys: floor(full days x paid / (paid + credit)), from the database's dates. */
    async function expectedShortDays(from: 'today' | string, paidPaise: number, creditPaise: number): Promise<number> {
      const r = await queryOne<{ d: number }>(
        `WITH s AS (SELECT CASE WHEN $1::text = 'today' THEN CURRENT_DATE ELSE $1::date END AS d)
         SELECT floor(((s.d + make_interval(months => 1))::date - s.d)::numeric * $2 / ($2 + $3))::int AS d FROM s`,
        [from, paidPaise, creditPaise],
      );
      return r!.d;
    }

    it('the product comes from the plan: a paid HR plan gives no credit towards a Billing plan', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 }); // billing row, no credit source
      await query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
         VALUES ($1, 'hr', 'hr_starter', 'active', CURRENT_DATE - 10, CURRENT_DATE + 20, 'monthly')`,
        [biz],
      );
      await insertPaid(biz, 'hr_starter', 199, -10, 20, { moduleKey: 'hr' });
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
      expect(p).toMatchObject({ creditApplied: 0, finalAmount: priceGrowth });
    });

    it('the checkout route refuses a module_key that is not the plan\'s product', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      const res = await checkoutRoute(biz, { plan_id: 'billing_growth', billing_cycle: 'monthly', module_key: 'hr' });
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'MODULE_PLAN_MISMATCH' });
      await expect(
        createSubscriptionCheckout({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', moduleKey: 'hr' }),
      ).rejects.toThrow('MODULE_PLAN_MISMATCH');
      const n = await queryOne<{ c: string }>(`SELECT count(*)::text AS c FROM billing_transactions WHERE business_id = $1 AND status = 'pending'`, [biz]);
      expect(n!.c).toBe('0');
    });

    it('the checkout route returns the full breakdown', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      const spy = jest
        .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
        .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
      try {
        const res = await checkoutRoute(biz, { plan_id: 'billing_growth', billing_cycle: 'monthly', module_key: 'billing' });
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.breakdown).toEqual({
          listPrice: priceGrowth, couponDiscount: 0, creditApplied: 199.33, creditUnused: 0, creditAvailable: 199.33, amountToPay: 299.67,
        });
      } finally {
        spy.mockRestore();
      }
    });

    it('add-on payments are never credit sources', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      const addon = await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
      await query(`UPDATE billing_transactions SET gateway_response = '{"checkout_type":"whatsapp_addon"}'::jsonb WHERE id = $1`, [addon]);
      expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(0);
    });

    it('credit above the price: only the applied part is taken from the sources, oldest first', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 50 });
      const older = await insertPaid(biz, 'billing_starter', 400, -10, 20); // 400*20/30 = 266.66
      const newer = await insertPaid(biz, 'billing_starter', 600, 20, 50); // whole: 600.00
      const c = await computeUpgradeCredit(biz, 'billing', 'billing_growth');
      expect(c.amount).toBe(866.66);
      const q = await startCheckout(biz, 'billing_growth');
      expect(q.amount).toBe(1);
      const meta = (await txMeta(q.tx))!.metadata.upgrade_credit;
      expect(meta).toMatchObject({ amount: 498, available: 866.66, unused: 368.66, from_plan_id: 'billing_starter' });
      expect(meta.allocation).toEqual([{ id: older, paise: 26666 }, { id: newer, paise: 49800 - 26666 }]);
      expect(q.result).toMatchObject({ creditApplied: 498, creditUnused: 368.66, creditAvailable: 866.66 });
      await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, q.tx, 'billing_growth'), 100);
      const o = (await txMeta(older))!.metadata;
      const n = (await txMeta(newer))!.metadata;
      expect(o).toMatchObject({ credit_consumed_by: q.tx, credit_used_paise: 26666 });
      expect(n).toMatchObject({ credit_consumed_by: q.tx, credit_used_paise: 23134 });
    });

    it('refundableAmountPaise is the amount paid minus the credit taken from it, never below 0', () => {
      expect(refundableAmountPaise({ total_amount: '499.00', metadata: {} })).toBe(49900);
      expect(refundableAmountPaise({ total_amount: '499.00', metadata: { credit_used_paise: 26666 } })).toBe(23234);
      expect(refundableAmountPaise({ total_amount: 100, metadata: { credit_used_paise: 99999 } })).toBe(0);
      expect(refundableAmountPaise({ total_amount: '299.00', metadata: null })).toBe(29900);
    });

    describe('credit re-checked at completion', () => {
      it('two pendings from the same source: the first gets the full period, the second is shortened and flagged', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const src = await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
        const a = await startCheckout(biz, 'billing_growth');
        const b = await startCheckout(biz, 'billing_growth');
        expect([a.amount, b.amount]).toEqual([299.67, 299.67]);

        await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, a.tx, 'billing_growth'), 29967);
        const afterA = await moduleRow(biz);
        expect(afterA).toMatchObject({ plan_id: 'billing_growth', end_date: await monthsFromToday(1) });
        expect((await txMeta(src))!.metadata).toMatchObject({ credit_consumed_by: a.tx, credit_used_paise: 19933 });

        const days = await expectedShortDays(afterA!.end_date!, 29967, 19933);
        const r = await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, b.tx, 'billing_growth'), 29967);
        expect(r).toMatchObject({ ok: true });
        const afterB = await moduleRow(biz);
        const expectEnd = await queryOne<{ d: string }>(`SELECT ($1::date + $2::int)::text AS d`, [afterA!.end_date, days]);
        expect(afterB!.end_date).toBe(expectEnd!.d);
        const rb = await txMeta(b.tx);
        expect(rb!.status).toBe('completed');
        expect(rb!.metadata.upgrade_credit).toMatchObject({ rejected: 'plan_changed', shortened_days: days });
        expect(await txRow(b.tx)).toMatchObject({ period_start: afterA!.end_date, period_end: expectEnd!.d });
        // The source still belongs to the first checkout.
        expect((await txMeta(src))!.metadata.credit_consumed_by).toBe(a.tx);
        const flagged = await findRejectedUpgradeCredits();
        expect(flagged.map((f) => f.billing_transaction_id)).toContain(b.tx);
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const rep = await reportBillingAnomalies();
        err.mockRestore();
        expect(rep.rejectedCredits).toBeGreaterThanOrEqual(1);
      });

      it('a source refunded before the payment: the period is shortened', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const src = await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
        const q = await startCheckout(biz, 'billing_growth');
        await query(`UPDATE billing_transactions SET status = 'refunded' WHERE id = $1`, [src]);
        await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, q.tx, 'billing_growth'), 29967);
        const days = await expectedShortDays('today', 29967, 19933);
        const after = await moduleRow(biz);
        expect(after).toMatchObject({ plan_id: 'billing_growth', start_date: await daysFromToday(0), end_date: await daysFromToday(days) });
        const meta = (await txMeta(q.tx))!.metadata;
        expect(meta.upgrade_credit).toMatchObject({ rejected: 'source_unavailable', shortened_days: days });
        expect((await txMeta(src))!.metadata.credit_consumed_by).toBeUndefined();
        expect(await txRow(q.tx)).toMatchObject({ period_start: after!.start_date, period_end: after!.end_date });
      });

      it('the module moved to a higher plan before the payment: the period is shortened', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const src = await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
        const q = await startCheckout(biz, 'billing_growth');
        await setRow(biz, 'billing_business', { startOffset: 0, endOffset: 30 });
        await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, q.tx, 'billing_growth'), 29967);
        const meta = (await txMeta(q.tx))!.metadata;
        expect(meta.upgrade_credit.rejected).toBe('plan_changed');
        expect(meta.upgrade_credit.shortened_days).toBe(await expectedShortDays('today', 29967, 19933));
        expect((await txMeta(src))!.metadata.credit_consumed_by).toBeUndefined();
        expect((await moduleRow(biz))!.plan_id).toBe('billing_growth');
      });

      it('happy path: a valid credit gives the whole period and records nothing as rejected', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        await insertPaid(biz, 'billing_starter', priceStarter, -10, 20);
        const q = await startCheckout(biz, 'billing_growth');
        await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, q.tx, 'billing_growth'), 29967);
        expect((await moduleRow(biz))!.end_date).toBe(await monthsFromToday(1));
        expect((await txMeta(q.tx))!.metadata.upgrade_credit.rejected).toBeUndefined();
      });
    });

    it('credit code uses SQL date maths, never the JavaScript clock', () => {
      const src = readFileSync(join(process.cwd(), 'lib/subscription/upgrade-credit.ts'), 'utf8');
      expect(src).not.toMatch(/new Date\(/);
      expect(src).not.toMatch(/Date\.now\(/);
    });
  });

  // ---- Task 3: grace starts at expiry, not at the nightly job ----

  describe('grace period counts from the end date', () => {
    async function operational(b: string): Promise<boolean> {
      clearModuleSubscriptionCache(b);
      return (await getOperationalModuleSubscriptions(b, true)).some((r) => r.module_key === 'billing');
    }
    async function graceRow(b: string) {
      return queryOne<{ plan_id: string; grace_period_end: string | null; end_date: string | null }>(
        `SELECT plan_id, grace_period_end::text, end_date::text FROM business_module_subscriptions
          WHERE business_id = $1 AND module_key = 'billing'`,
        [b],
      );
    }
    async function eventTypes(b: string): Promise<string[]> {
      const r = await query(`SELECT event_type FROM subscription_events WHERE business_id = $1 ORDER BY created_at`, [b]);
      return r.rows.map((e: any) => e.event_type);
    }

    it('GRACE_DAYS is 7', () => {
      expect(GRACE_DAYS).toBe(7);
    });

    it('the day after the end date, with no stamp, the customer keeps the paid plan', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -31, endOffset: -1 });
      expect(await operational(biz)).toBe(true);
      const sub = (await getModuleSubscription(biz, 'billing', true))!;
      expect(getEntitlementPlanIdForModuleSub(sub)).toBe('billing_growth');
    });

    it('day 7 after the end date is still grace; day 8 is not (no stamp)', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -37, endOffset: -7 });
      expect(await operational(biz)).toBe(true);
      await setRow(biz, 'billing_growth', { startOffset: -38, endOffset: -8 });
      expect(await operational(biz)).toBe(false);
    });

    it('a stamp still decides: today or later is grace, yesterday is not', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -37, endOffset: -7, graceOffset: 0 });
      expect(await operational(biz)).toBe(true);
      await setRow(biz, 'billing_growth', { startOffset: -37, endOffset: -7, graceOffset: -1 });
      expect(await operational(biz)).toBe(false);
    });

    it('a cancelled-at-period-end row the day after its end is not usable (unchanged)', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -31, endOffset: -1 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true WHERE business_id = $1`, [biz]);
      expect(await operational(biz)).toBe(false);
    });

    it('a row with a scheduled downgrade the day after its end is not usable (unchanged)', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -31, endOffset: -1 });
      await query(`UPDATE business_module_subscriptions SET scheduled_plan_id = 'billing_starter' WHERE business_id = $1`, [biz]);
      expect(await operational(biz)).toBe(false);
    });

    it('free rows (no end date) and a running trial are unaffected', async () => {
      await setRow(biz, 'free', { endOffset: null });
      expect(await operational(biz)).toBe(true);
      await setRow(biz, 'trial', { status: 'trial', endOffset: null, trialEndOffset: 5 });
      expect(await operational(biz)).toBe(true);
    });

    it('a paid row with a past end date and a cancelled or expired status stays unusable', async () => {
      await setRow(biz, 'billing_growth', { status: 'expired', startOffset: -31, endOffset: -1 });
      expect(await operational(biz)).toBe(false);
    });

    it('the nightly job stamps end_date + 7, not run day + 7, so a missed run does not move the window', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      await processExpiredModuleSubscriptions();
      expect(await graceRow(biz)).toMatchObject({ plan_id: 'billing_growth', grace_period_end: await daysFromToday(4) });
      expect(await eventTypes(biz)).toContain('grace_started');
      expect(await operational(biz)).toBe(true);
    });

    it('day 8 with no stamp: not usable, and one job run moves the row to free', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -38, endOffset: -8 });
      expect(await operational(biz)).toBe(false);
      await processExpiredModuleSubscriptions();
      expect(await graceRow(biz)).toMatchObject({ plan_id: 'free', end_date: null, grace_period_end: null });
      expect(await eventTypes(biz)).toContain('grace_expired');
      expect(await operational(biz)).toBe(true); // the Free plan is usable
    });

    it('the job moves an unstamped day-8 row even when the stamping step does not run for it', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -38, endOffset: -8 });
      const moved = await moveModuleSubscriptionToFree(biz, 'billing', 'billing_growth', 'grace_expired', 'grace_expired');
      expect(moved).toBe(true);
      expect((await graceRow(biz))!.plan_id).toBe('free');
    });

    it('the move to free does nothing for a row still in grace (no stamp, day 3)', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      expect(await moveModuleSubscriptionToFree(biz, 'billing', 'billing_growth', 'grace_expired', 'grace_expired')).toBe(false);
      expect((await graceRow(biz))!.plan_id).toBe('billing_growth');
    });

    it('a payment that lands first wins: the day-8 move to free does nothing after a renewal', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -38, endOffset: -8 });
      await paidAndActivated(biz, 'billing_growth');
      expect(await moveModuleSubscriptionToFree(biz, 'billing', 'billing_growth', 'grace_expired', 'grace_expired')).toBe(false);
      expect(await graceRow(biz)).toMatchObject({ plan_id: 'billing_growth', end_date: await monthsFromToday(1) });
    });

    it('paying during grace starts a fresh period today and clears the stamp', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      await processExpiredModuleSubscriptions();
      expect((await graceRow(biz))!.grace_period_end).not.toBeNull();
      const tx = await paidAndActivated(biz, 'billing_growth');
      expect(await moduleRow(biz)).toMatchObject({ start_date: await daysFromToday(0), end_date: await monthsFromToday(1) });
      expect((await graceRow(biz))!.grace_period_end).toBeNull();
      expect(await txRow(tx)).toMatchObject({ period_start: await daysFromToday(0), period_end: await monthsFromToday(1) });
    });

    it('the recurring-invoice job generates for a business the day after its paid period ended', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -31, endOffset: -1 });
      const customerId = randomUUID();
      await query(`INSERT INTO customers (id, business_id, name, phone) VALUES ($1, $2, 'Recurring cust', $3)`, [
        customerId, biz, `8${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`,
      ]);
      const sched = randomUUID();
      await query(
        `INSERT INTO recurring_invoices
           (id, business_id, customer_id, frequency, interval_value, start_date, next_run_date, items, created_by, auto_finalize)
         VALUES ($1, $2, $3, 'monthly', 1, '2026-06-01', '2026-06-01', $4::jsonb, $5, false)`,
        [sched, biz, customerId,
         JSON.stringify([{ item_name: 'Monthly service', quantity: 1, unit_price: 1000, tax_rate: 18 }]),
         adminOf.get(biz)],
      );
      const out = await runRecurringInvoices(getPool(), { today: '2026-06-15', businessId: biz });
      const s = out.find((x) => x.recurring_invoice_id === sched)!;
      expect(s.skippedSubscriptionInactive).toBeUndefined();
      expect(s.error).toBeUndefined();
      expect(s.created).toHaveLength(1);
    });

    it('one function answers it: the lifecycle job and routes do not keep their own grace maths', () => {
      const route = readFileSync(join(process.cwd(), 'app/api/subscriptions/current/route.ts'), 'utf8');
      expect(route).toMatch(/getSubscriptionUsability/);
      const src = readFileSync(join(process.cwd(), 'lib/subscription/effective-plan.ts'), 'utf8');
      expect(src).not.toMatch(/Date\.now\(/);
    });
  });

  // ---- Task 3 fix round 1 ----

  describe('grace: one usability answer, DB clock, routes and notices', () => {
    async function getJson(handler: (r: NextRequest) => Promise<Response>, path: string, businessId: string) {
      const res = await handler(
        new NextRequest(`http://localhost${path}`, {
          headers: { 'x-authenticated-business-id': businessId, 'x-authenticated-user-id': adminOf.get(businessId)! },
        }),
      );
      expect(res.status).toBe(200);
      return res.json();
    }
    const billingModule = (j: any) => j.modules.find((m: any) => m.module_key === 'billing').subscription;

    it('the loaders select the database date with the row', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -31, endOffset: -1 });
      const sub = (await getModuleSubscription(biz, 'billing', true))!;
      expect(sub.db_today).toBe(await daysFromToday(0));
    });

    it('the usability function gives the boundary results for an explicit today, whatever the process clock says', () => {
      const row = { plan_id: 'billing_growth', status: 'active', end_date: '2026-03-10' };
      const checks = () => {
        expect(getSubscriptionUsability(row, '2026-03-10')).toMatchObject({ operational: true, graceActive: false });
        expect(getSubscriptionUsability(row, '2026-03-11')).toMatchObject({ operational: true, graceActive: true, graceDaysRemaining: 6 });
        expect(getSubscriptionUsability(row, '2026-03-17')).toMatchObject({ operational: true, graceActive: true, graceDaysRemaining: 0 });
        expect(getSubscriptionUsability(row, '2026-03-18')).toMatchObject({ operational: false, graceActive: false });
        expect(getSubscriptionUsability({ ...row, db_today: '2026-03-17' })).toMatchObject({ operational: true });
        expect(getSubscriptionUsability({ ...row, db_today: '2026-03-18' })).toMatchObject({ operational: false });
      };
      checks();
      jest.useFakeTimers().setSystemTime(new Date('2031-07-04T12:00:00Z'));
      try { checks(); } finally { jest.useRealTimers(); }
    });

    it('a cancelled-at-period-end row with a stamp is denied and reports no grace', () => {
      const r = getSubscriptionUsability(
        { plan_id: 'billing_growth', status: 'active', end_date: '2026-03-10', grace_period_end: '2026-03-17', cancel_at_period_end: true },
        '2026-03-12',
      );
      expect(r).toMatchObject({ operational: false, graceActive: false, graceEnd: null });
    });

    it('/subscriptions/current: 8 days past end is not operational', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -38, endOffset: -8 });
      const j = (await getJson(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(j.is_operational).toBe(false);
      expect(j.is_grace_period_active).toBe(false);
    });

    it('/subscriptions/current: 3 days past end is operational, in grace, with the right grace end', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      const j = (await getJson(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(j.is_operational).toBe(true);
      expect(j.is_grace_period_active).toBe(true);
      expect(j.grace_days_remaining).toBe(4);
      expect(await daysFromToday(4)).toBe(
        (await queryOne<{ d: string }>(`SELECT ((SELECT end_date FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing') + 7)::text AS d`, [biz]))!.d,
      );
    });

    it('/subscriptions/current: cancel-at-period-end past its end is not operational, even with a stamp', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3, graceOffset: 4 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true WHERE business_id = $1`, [biz]);
      const j = (await getJson(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(j.is_operational).toBe(false);
      expect(j.is_grace_period_active).toBe(false);
    });

    it('/subscriptions/modules/current follows the same rule', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -38, endOffset: -8 });
      expect(billingModule(await getJson(modulesCurrentGet, '/api/subscriptions/modules/current', biz))).toMatchObject({ is_operational: false, is_grace_period_active: false });
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      expect(billingModule(await getJson(modulesCurrentGet, '/api/subscriptions/modules/current', biz))).toMatchObject({
        is_operational: true, is_grace_period_active: true, grace_period_end: await daysFromToday(4), grace_days_remaining: 4,
      });
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true WHERE business_id = $1`, [biz]);
      expect(billingModule(await getJson(modulesCurrentGet, '/api/subscriptions/modules/current', biz))).toMatchObject({ is_operational: false, is_grace_period_active: false });
    });

    it('a NULL cancel_at_period_end flag counts as not cancelled: stamped in grace, moved to Free past grace', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = NULL WHERE business_id = $1`, [biz]);
      await processExpiredModuleSubscriptions();
      expect((await queryOne<any>(`SELECT grace_period_end::text AS g FROM business_module_subscriptions WHERE business_id = $1`, [biz]))!.g).toBe(await daysFromToday(4));

      const other = await newBusiness('nullflag');
      await setRow(other, 'billing_growth', { startOffset: -38, endOffset: -8 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = NULL WHERE business_id = $1`, [other]);
      expect(await moveModuleSubscriptionToFree(other, 'billing', 'billing_growth', 'grace_expired', 'grace_expired')).toBe(true);
      const third = await newBusiness('nullflag2');
      await setRow(third, 'billing_growth', { startOffset: -38, endOffset: -8 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = NULL WHERE business_id = $1`, [third]);
      await processExpiredModuleSubscriptions();
      expect((await queryOne<any>(`SELECT plan_id FROM business_module_subscriptions WHERE business_id = $1`, [third]))!.plan_id).toBe('free');
    });

    it('a trial plan id on an active row past its end gets no grace under the job or the function', async () => {
      await setRow(biz, 'trial', { startOffset: -33, endOffset: -3 });
      expect(getPaidGraceEndDate({ plan_id: 'trial', status: 'active', end_date: await daysFromToday(-3) })).toBeNull();
      await processExpiredModuleSubscriptions();
      const r = (await queryOne<any>(`SELECT plan_id, grace_period_end::text AS g FROM business_module_subscriptions WHERE business_id = $1`, [biz]))!;
      expect(r).toMatchObject({ plan_id: 'trial', g: null });
      clearModuleSubscriptionCache(biz);
      expect((await getOperationalModuleSubscriptions(biz, true)).some((x) => x.module_key === 'billing')).toBe(false);
    });

    it('the 3-days-left notice fires from end_date + 7 even when the job has not stamped, once only', async () => {
      await query(`UPDATE businesses SET email = $2 WHERE id = $1`, [biz, `grace-${biz.slice(0, 8)}@example.test`]);
      await setRow(biz, 'billing_growth', { startOffset: -34, endOffset: -4 });
      const sentFor = async () => Number((await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM subscription_notifications WHERE business_id = $1 AND notification_type = 'grace_expiring_3'`, [biz]))!.n);
      expect(await sentFor()).toBe(0);
      await sendPendingNotifications();
      expect(await sentFor()).toBe(1);
      await sendPendingNotifications();
      expect(await sentFor()).toBe(1);
    });

    it('no notice for a cancelled-at-period-end row or on another day', async () => {
      await query(`UPDATE businesses SET email = $2 WHERE id = $1`, [biz, `grace-${biz.slice(0, 8)}@example.test`]);
      await setRow(biz, 'billing_growth', { startOffset: -34, endOffset: -4 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true WHERE business_id = $1`, [biz]);
      await sendPendingNotifications();
      await setRow(biz, 'billing_growth', { startOffset: -35, endOffset: -5 });
      await sendPendingNotifications();
      expect(Number((await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM subscription_notifications WHERE business_id = $1 AND notification_type = 'grace_expiring_3'`, [biz]))!.n)).toBe(0);
    });
  });
  // ---- Task 4: renewal reminders, honest auto-renew flag, undo cancel ----

  describe('renewal reminders and undoing a cancellation', () => {
    const remindersFor = async (businessId: string, type?: string) =>
      Number((await queryOne<{ n: string }>(
        `SELECT COUNT(*)::text AS n FROM subscription_notifications
         WHERE business_id = $1 AND notification_type LIKE $2`,
        [businessId, type ?? 'renewal_%'],
      ))!.n);
    const withEmail = (businessId: string) =>
      query(`UPDATE businesses SET email = $2 WHERE id = $1`, [businessId, `renew-${businessId.slice(0, 8)}@example.test`]);

    function post(handler: (r: NextRequest) => Promise<Response>, path: string, businessId: string, body: Record<string, unknown> = {}, userId?: string) {
      return handler(
        new NextRequest(`http://localhost${path}`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-authenticated-business-id': businessId,
            'x-authenticated-user-id': userId ?? adminOf.get(businessId)!,
          },
          body: JSON.stringify(body),
        }),
      );
    }
    async function getSub(handler: (r: NextRequest) => Promise<Response>, path: string, businessId: string) {
      const res = await handler(new NextRequest(`http://localhost${path}`, {
        headers: { 'x-authenticated-business-id': businessId, 'x-authenticated-user-id': adminOf.get(businessId)! },
      }));
      expect(res.status).toBe(200);
      return res.json();
    }

    it.each([[7, '7'], [3, '3'], [1, '1'], [-1, 'lapsed']])(
      'a paid row %i days from its end gets the %s reminder once, however often the job runs',
      async (offset, bucket) => {
        await withEmail(biz);
        await setRow(biz, 'billing_growth', { startOffset: offset - 30, endOffset: offset });
        const first = await processExpiredModuleSubscriptions();
        expect(first.renewalRemindersSent).toBeGreaterThanOrEqual(1);
        const type = `renewal_reminder_${bucket}:billing:${await daysFromToday(offset)}`;
        expect(await remindersFor(biz, type)).toBe(1);
        expect(await remindersFor(biz)).toBe(1);
        await processExpiredModuleSubscriptions();
        expect(await remindersFor(biz)).toBe(1);
        const logged = (await queryOne<any>(
          `SELECT metadata FROM subscription_notifications WHERE business_id = $1 AND notification_type = $2`, [biz, type]))!.metadata;
        expect(logged).toMatchObject({ module_key: 'billing', period_end: await daysFromToday(offset), claimed: false });
        expect(logged.channels).toContain('in_app');
      },
    );

    it('a missed run loses nothing: 6 days out sends the 7 bucket with the real days and date, once, and never two buckets in one run', async () => {
      const { sendPlatformEmail } = jest.requireMock('@/lib/platform-email') as { sendPlatformEmail: jest.Mock };
      await withEmail(biz);
      sendPlatformEmail.mockClear();
      await setRow(biz, 'billing_growth', { startOffset: -24, endOffset: 6 });
      await processExpiredModuleSubscriptions();
      await processExpiredModuleSubscriptions();
      expect(await remindersFor(biz)).toBe(1);
      expect(await remindersFor(biz, `renewal_reminder_7:billing:${await daysFromToday(6)}`)).toBe(1);
      const mails = sendPlatformEmail.mock.calls.map((c) => c[0]).filter((m) => String(m.to).startsWith('renew-' + biz.slice(0, 8)));
      expect(mails).toHaveLength(1);
      expect(mails[0].subject).toContain('ends in 6 days');
      const bell = await queryOne<{ title: string }>(`SELECT title FROM notifications WHERE business_id = $1 AND reference_type = 'subscription'`, [biz]);
      expect(bell!.title).toContain('in 6 days');
    });

    it('two runs at the same moment send one reminder', async () => {
      const { sendPlatformEmail } = jest.requireMock('@/lib/platform-email') as { sendPlatformEmail: jest.Mock };
      await withEmail(biz);
      sendPlatformEmail.mockClear();
      await setRow(biz, 'billing_growth', { startOffset: -27, endOffset: 3 });
      await Promise.all([sendRenewalReminders(), sendRenewalReminders(), sendRenewalReminders()]);
      expect(await remindersFor(biz)).toBe(1);
      expect(sendPlatformEmail.mock.calls.map((c) => c[0]).filter((m) => String(m.to).startsWith('renew-' + biz.slice(0, 8)))).toHaveLength(1);
      expect(Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM notifications WHERE business_id = $1 AND reference_type = 'subscription'`, [biz]))!.n)).toBe(1);
    });

    it('two products of one business reminded on the same day each get their own reminder and log row', async () => {
      await withEmail(biz);
      await setRow(biz, 'billing_growth', { startOffset: -27, endOffset: 3 });
      await query(
        `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle)
         VALUES ($1, 'hr', 'hr_starter', 'active', CURRENT_DATE - 27, CURRENT_DATE + 3, 'monthly')`, [biz]);
      await processExpiredModuleSubscriptions();
      await processExpiredModuleSubscriptions();
      const end = await daysFromToday(3);
      expect(await remindersFor(biz, `renewal_reminder_3:billing:${end}`)).toBe(1);
      expect(await remindersFor(biz, `renewal_reminder_3:hr:${end}`)).toBe(1);
      const titles = (await query(`SELECT title FROM notifications WHERE business_id = $1 AND reference_type = 'subscription' ORDER BY title`, [biz])).rows.map((r: any) => r.title);
      expect(titles).toEqual(['Your Billing plan ends in 3 days', 'Your HR plan ends in 3 days']);
    });

    it('no reminder outside the window, for Free, trial or cancelled rows, or a scheduled move to a free-tier plan', async () => {
      await withEmail(biz);
      for (const [plan, status, end] of [
        ['billing_growth', 'active', 8], ['billing_growth', 'active', -2],
        ['free', 'active', 3], ['trial', 'active', 3], ['trial', 'trial', 3],
      ] as const) {
        await setRow(biz, plan, { status, startOffset: end - 30, endOffset: end, trialEndOffset: status === 'trial' ? end : null });
        await processExpiredModuleSubscriptions();
      }
      await setRow(biz, 'billing_growth', { startOffset: -27, endOffset: 3 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = NOW() WHERE business_id = $1`, [biz]);
      await processExpiredModuleSubscriptions();
      for (const free of ['free', 'hr_staff_lite']) {
        await setRow(biz, 'billing_growth', { startOffset: -27, endOffset: 3 });
        await query(`UPDATE business_module_subscriptions SET scheduled_plan_id = $2 WHERE business_id = $1`, [biz, free]);
        await sendRenewalReminders();
      }
      expect(await remindersFor(biz)).toBe(0);
    });

    it('a scheduled move to a cheaper PAID plan still gets a reminder that names the plan that will apply', async () => {
      const { sendPlatformEmail } = jest.requireMock('@/lib/platform-email') as { sendPlatformEmail: jest.Mock };
      await withEmail(biz);
      sendPlatformEmail.mockClear();
      await setRow(biz, 'billing_growth', { startOffset: -27, endOffset: 3 });
      await query(`UPDATE business_module_subscriptions SET scheduled_plan_id = 'billing_starter' WHERE business_id = $1`, [biz]);
      await sendRenewalReminders();
      expect(await remindersFor(biz, 'renewal_reminder_3:billing:%')).toBe(1);
      const mail = sendPlatformEmail.mock.calls.map((c) => c[0]).find((m) => String(m.to).startsWith('renew-' + biz.slice(0, 8)));
      const starter = (await queryOne<{ d: string }>(`SELECT display_name AS d FROM subscription_plans WHERE id = 'billing_starter'`))!.d;
      expect(mail.text).toContain(`You scheduled a change to ${starter}`);
      expect(mail.text).toContain('needs a payment');
    });

    it('a plan priced at 1 rupee still gets reminders (paid is decided by price, not plan id)', async () => {
      await withEmail(biz);
      const id = 'bill_one_' + sfx();
      await query(
        `INSERT INTO subscription_plans (id, name, display_name, price_monthly, price_yearly, features)
         VALUES ($1, $1, 'One Rupee', 1, 0, '{}'::jsonb)`, [id]);
      try {
        await setRow(biz, id, { startOffset: -27, endOffset: 3 });
        await processExpiredModuleSubscriptions();
        expect(await remindersFor(biz, 'renewal_reminder_3:billing:%')).toBe(1);
      } finally {
        await query(`DELETE FROM business_module_subscriptions WHERE business_id = $1`, [biz]);
        await query(`DELETE FROM subscription_plans WHERE id = $1`, [id]);
      }
    });

    it('a reminder recorded for an earlier period does not block the next period at the same bucket', async () => {
      await withEmail(biz);
      await query(
        `INSERT INTO subscription_notifications (business_id, notification_type, metadata, sent_at)
         VALUES ($1, 'renewal_reminder_7:billing:2020-01-01', $2, NOW() - interval '30 days')`,
        [biz, JSON.stringify({ module_key: 'billing', period_end: '2020-01-01' })],
      );
      await setRow(biz, 'billing_growth', { startOffset: -23, endOffset: 7 });
      await processExpiredModuleSubscriptions();
      expect(await remindersFor(biz, 'renewal_reminder_7:%')).toBe(2);
    });

    it('the reminder text names the product, the date and the computed grace end date (no hard-coded days)', async () => {
      const { sendPlatformEmail } = jest.requireMock('@/lib/platform-email') as { sendPlatformEmail: jest.Mock };
      await withEmail(biz);
      sendPlatformEmail.mockClear();
      await setRow(biz, 'billing_growth', { startOffset: -23, endOffset: 7 });
      await processExpiredModuleSubscriptions();
      const call = sendPlatformEmail.mock.calls.map((c) => c[0]).find((m) => String(m.to).startsWith('renew-' + biz.slice(0, 8)));
      expect(call).toBeDefined();
      const label = async (n: number) => (await queryOne<{ l: string }>(`SELECT to_char(CURRENT_DATE + $1::int, 'FMDD FMMonth YYYY') AS l`, [n]))!.l;
      expect(call.text).toContain(
        `plan for Renewal ${''}`.slice(0, 0) + `(Billing) ends on ${await label(7)}. Renew before then to keep your current period running without a break. If you do nothing, you keep full access until ${await label(14)} and then move to the Free plan. Your data stays safe.`,
      );
      expect(call.text).not.toContain('7 more days');
      expect(call.subject).toContain('Billing plan ends in 7 days');
      const bell = await queryOne<{ message: string }>(`SELECT message FROM notifications WHERE business_id = $1 AND reference_type = 'subscription'`, [biz]);
      expect(bell!.message).toContain('Your data stays safe.');
    });

    it('the grace date in the text equals the usability answer, including an admin-stamped grace end', async () => {
      const { sendPlatformEmail } = jest.requireMock('@/lib/platform-email') as { sendPlatformEmail: jest.Mock };
      await withEmail(biz);
      sendPlatformEmail.mockClear();
      await setRow(biz, 'billing_growth', { startOffset: -27, endOffset: 3, graceOffset: 20 });
      const row = (await getModuleSubscription(biz, 'billing', true))!;
      const g = getPaidGraceEndDate(row)!;
      await sendRenewalReminders();
      const call = sendPlatformEmail.mock.calls.map((c) => c[0]).find((m) => String(m.to).startsWith('renew-' + biz.slice(0, 8)));
      const expected = (await queryOne<{ l: string }>(
        `SELECT to_char($1::date, 'FMDD FMMonth YYYY') AS l`,
        [`${g.getFullYear()}-${String(g.getMonth() + 1).padStart(2, '0')}-${String(g.getDate()).padStart(2, '0')}`]))!.l;
      expect(call.text).toContain(`until ${expected} and then`);
    });

    it('undo restores a cancelled row inside the paid period and logs it', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      expect((await post(cancelPost, '/api/subscriptions/cancel', biz, { reason: 'test' })).status).toBe(200);
      expect(await queryOne<any>(`SELECT cancel_at_period_end AS c, cancelled_at IS NOT NULL AS at FROM business_module_subscriptions WHERE business_id = $1`, [biz])).toEqual({ c: true, at: true });

      const res = await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz);
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ success: true, module_key: 'billing', end_date: await daysFromToday(20) });
      expect(await queryOne<any>(`SELECT cancel_at_period_end AS c, cancelled_at IS NULL AS cleared, plan_id, end_date::text AS e FROM business_module_subscriptions WHERE business_id = $1`, [biz]))
        .toEqual({ c: false, cleared: true, plan_id: 'billing_growth', e: await daysFromToday(20) });
      expect(Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM subscription_events WHERE business_id = $1 AND event_type = 'cancellation_undone'`, [biz]))!.n)).toBe(1);
      // Undoing twice: nothing left to undo.
      const again = await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz);
      expect(again.status).toBe(400);
      expect(await again.json()).toMatchObject({ code: 'NOT_CANCELLED' });
    });

    it('undo works on the last day and is refused after the end, leaving the row as it was', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -30, endOffset: 0 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = NOW() WHERE business_id = $1`, [biz]);
      expect((await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz)).status).toBe(200);

      await setRow(biz, 'billing_growth', { startOffset: -31, endOffset: -1 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = NOW() WHERE business_id = $1`, [biz]);
      const res = await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'NOT_CANCELLED' });
      expect(await queryOne<any>(`SELECT cancel_at_period_end AS c, cancelled_at IS NOT NULL AS at FROM business_module_subscriptions WHERE business_id = $1`, [biz])).toEqual({ c: true, at: true });
    });

    it('undo on a row that was never cancelled is refused', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      const res = await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'NOT_CANCELLED' });
    });

    it('undo with an unknown module_key is a 400 and changes nothing (never the primary product)', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = NOW() WHERE business_id = $1`, [biz]);
      for (const bad of ['typo', 'HR', '', 5]) {
        const res = await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz, { module_key: bad });
        expect(res.status).toBe(400);
        expect(await res.json()).toMatchObject({ code: 'INVALID_MODULE' });
      }
      expect((await queryOne<any>(`SELECT cancel_at_period_end AS c FROM business_module_subscriptions WHERE business_id = $1`, [biz]))!.c).toBe(true);
      expect((await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz, { module_key: 'billing' })).status).toBe(200);
    });

    it('cancel then pay the same plan: the flag is cleared, the period extends from the old end, and the job at the old end date keeps the plan', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -30, endOffset: 5 });
      const before = await moduleRow(biz);
      expect((await post(cancelPost, '/api/subscriptions/cancel', biz, { reason: 'test' })).status).toBe(200);
      await paidAndActivated(biz, 'billing_growth');
      const row = (await queryOne<any>(
        `SELECT cancel_at_period_end AS c, cancelled_at IS NULL AS cleared, end_date::text AS e FROM business_module_subscriptions WHERE business_id = $1`, [biz]))!;
      expect(row).toEqual({ c: false, cleared: true, e: await addMonths(before!.end_date!, 1) });
      // The old end date has passed: the cancel-at-period-end move to Free must not touch the paid-up row.
      await query(`UPDATE business_module_subscriptions SET start_date = CURRENT_DATE - 40, end_date = CURRENT_DATE + 10 WHERE business_id = $1`, [biz]);
      await processExpiredModuleSubscriptions();
      expect((await moduleRow(biz))!.plan_id).toBe('billing_growth');
    });

    it('cancel then upgrade to another plan: the flag is cleared', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -20, endOffset: 10 });
      expect((await post(cancelPost, '/api/subscriptions/cancel', biz, {})).status).toBe(200);
      await paidAndActivated(biz, 'billing_growth');
      expect(await queryOne<any>(`SELECT plan_id, cancel_at_period_end AS c, cancelled_at IS NULL AS cleared FROM business_module_subscriptions WHERE business_id = $1`, [biz]))
        .toEqual({ plan_id: 'billing_growth', c: false, cleared: true });
    });

    it('cancel then a 0 rupee coupon activation of the same plan also clears the flag', async () => {
      const { applyModuleSubscriptionPlanChange } = await import('@/lib/subscription/apply-module-plan-change');
      await setRow(biz, 'billing_growth', { startOffset: -20, endOffset: 10 });
      expect((await post(cancelPost, '/api/subscriptions/cancel', biz, {})).status).toBe(200);
      await applyModuleSubscriptionPlanChange({ businessId: biz, moduleKey: 'billing', planId: 'billing_growth', billingCycle: 'monthly', paymentMethod: 'coupon' });
      expect(await queryOne<any>(`SELECT cancel_at_period_end AS c, cancelled_at IS NULL AS cleared FROM business_module_subscriptions WHERE business_id = $1`, [biz]))
        .toEqual({ c: false, cleared: true });
    });

    it('undo is owner only, and a business id in the body must match the session', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = NOW() WHERE business_id = $1`, [biz]);
      const staff = randomUUID();
      await query(`INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Staff', $3, false)`,
        [staff, biz, `8${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`]);
      expect((await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz, {}, staff)).status).toBe(403);
      const other = await newBusiness('undo-other');
      expect((await post(cancelUndoPost, '/api/subscriptions/cancel/undo', biz, { business_id: other })).status).toBe(403);
      expect((await queryOne<any>(`SELECT cancel_at_period_end AS c FROM business_module_subscriptions WHERE business_id = $1`, [biz]))!.c).toBe(true);
    });

    it('undo only touches the business of the session', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = NOW() WHERE business_id = $1`, [biz]);
      const other = await newBusiness('undo-bystander');
      await setRow(other, 'billing_growth', { startOffset: -10, endOffset: 20 });
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = NOW() WHERE business_id = $1`, [other]);
      expect((await post(cancelUndoPost, '/api/subscriptions/cancel/undo', other)).status).toBe(200);
      expect((await queryOne<any>(`SELECT cancel_at_period_end AS c FROM business_module_subscriptions WHERE business_id = $1`, [biz]))!.c).toBe(true);
    });

    it('both current routes report no auto-renew, the end date and grace in grace', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      const expectedGrace = await daysFromToday(4);
      const one = (await getSub(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(one).toMatchObject({
        auto_renew: false, renews_on: null, ends_on: await daysFromToday(-3),
        grace_ends_on: expectedGrace, in_grace: true, can_renew: true,
      });
      const mod = (await getSub(modulesCurrentGet, '/api/subscriptions/modules/current', biz)).modules
        .find((m: any) => m.module_key === 'billing').subscription;
      expect(mod).toMatchObject({
        auto_renew: false, renews_on: null, ends_on: await daysFromToday(-3),
        grace_ends_on: expectedGrace, in_grace: true, can_renew: true,
      });
    });

    it('inside the period: not in grace and can renew; a cancelled row can renew (no grace); Free and past-grace rows cannot', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -10, endOffset: 20 });
      let s = (await getSub(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(s).toMatchObject({ in_grace: false, can_renew: true, auto_renew: false, ends_on: await daysFromToday(20) });
      expect(s.grace_ends_on).toBe(await daysFromToday(27));

      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true WHERE business_id = $1`, [biz]);
      clearSubscriptionCache(biz); clearModuleSubscriptionCache(biz);
      s = (await getSub(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(s).toMatchObject({ can_renew: true, in_grace: false, grace_ends_on: null });
      const m = (await getSub(modulesCurrentGet, '/api/subscriptions/modules/current', biz)).modules.find((x: any) => x.module_key === 'billing').subscription;
      expect(m).toMatchObject({ can_renew: true, in_grace: false, grace_ends_on: null, cancel_at_period_end: true });

      await setRow(biz, 'free');
      await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = false WHERE business_id = $1`, [biz]);
      clearSubscriptionCache(biz); clearModuleSubscriptionCache(biz);
      s = (await getSub(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(s).toMatchObject({ can_renew: false, in_grace: false, auto_renew: false, ends_on: null, grace_ends_on: null });

      await setRow(biz, 'billing_growth', { startOffset: -40, endOffset: -10 });
      clearSubscriptionCache(biz); clearModuleSubscriptionCache(biz);
      s = (await getSub(currentGet, '/api/subscriptions/current', biz)).subscription;
      expect(s).toMatchObject({ in_grace: false, can_renew: false });
    });
  });
});
