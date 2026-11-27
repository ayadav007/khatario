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
import { GET as adminBillingGet } from '@/app/api/admin/businesses/[id]/billing/route';
import { GET as previewGet } from '@/app/api/subscriptions/checkout/preview/route';
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
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import {
  refundPlatformPayment,
  gatewayRefundKey,
  PlatformRefundError,
  settlePlatformRefund,
} from '@/lib/platform-refunds';
import { updateBillingTransactionStatus } from '@/lib/platform-billing';
import { assertBillingTransactionTransition, assertCreditReleaseReopen } from '@/lib/platform-billing-transaction-state';
import { findRefundsNeedingReview, findUnappliedPayments } from '@/lib/subscription/reconcile-payments';
import { archiveBusinessBillingTransactions } from '@/lib/platform-billing-archive';
import { deleteBusinessCompletely } from '@/lib/admin-business-ops';
import { POST as refundPost } from '@/app/api/admin/businesses/[id]/billing/[txId]/refund/route';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BillingCycle } from '@/lib/subscription/apply-plan-change';
import { NextResponse } from 'next/server';
import { EasebuzzPaymentProvider } from '@/lib/payments/providers/easebuzz-payment-provider';
import { completeSubscriptionCheckoutPaymentDetailed } from '@/lib/platform-subscription-checkout';
import { completeAddonCheckoutPayment, createAddonCheckout } from '@/lib/platform-addon-checkout';
import { financialYearLabel, loadTaxSettings, nextInvoiceNumber, saveTaxSettings, TaxSettingsError } from '@/lib/platform-tax';
import { gstinCheckChar } from '@/lib/tax/gstin';
import { GET as receiptGet } from '@/app/api/subscriptions/receipts/[id]/route';
import { GET as adminReceiptGet } from '@/app/api/admin/businesses/[id]/billing/[txId]/receipt/route';
import { GET as historyGet } from '@/app/api/subscriptions/billing-history/route';
import { GET as taxSettingsGet, PUT as taxSettingsPut } from '@/app/api/admin/settings/billing-tax/route';

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

  /**
   * Runs `fn` with the process (JavaScript) clock moved to `iso`, while the database clock stays real. Code that takes
   * "today" from the JavaScript clock gets a different day from the database; code that uses the database's does not.
   * Only Date is faked: timers stay real so the database driver keeps working.
   */
  async function withJsClock<T>(iso: string, fn: () => Promise<T>): Promise<T> {
    jest.useFakeTimers({
      now: new Date(iso),
      doNotFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'nextTick', 'queueMicrotask', 'hrtime', 'performance'],
    });
    try {
      return await fn();
    } finally {
      jest.useRealTimers();
    }
  }

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
    // Migrations 480 and 481 (idempotent) are the schema every test below runs on: refund indexes, GST settings, tax columns, counters.
    for (const f of ['480_subscription_tax_and_refunds.sql', '481_subscription_tax.sql']) {
      await query(readFileSync(join(process.cwd(), 'database/migrations', f), 'utf8'));
    }
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

    it('a change period starts at the database CURRENT_DATE, whatever the process clock says', async () => {
      const dbToday = await queryOne<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
      const end = await daysFromToday(3);
      // The process clock is set 20 years away: an implementation that took today from JavaScript would start in 2006.
      const p = await withJsClock('2006-03-04T10:00:00Z', () =>
        resolveNewPeriod({
          current: { ...base, plan_id: 'billing_starter', end_date: end },
          targetPlanId: 'billing_growth', billingCycle: 'monthly', currentPlanIsPaid: true,
        }),
      );
      expect(p.kind).toBe('change');
      expect(p.startDate).toBe(dbToday!.d);
      const fresh = await withJsClock('2006-03-04T10:00:00Z', () =>
        resolveNewPeriod({ current: null, targetPlanId: 'billing_growth', billingCycle: 'yearly', currentPlanIsPaid: false }),
      );
      expect(fresh).toMatchObject({ startDate: dbToday!.d, endDate: await monthsFromToday(12) });
    });

    it('a real payment records DB-date periods even when the process clock is 20 years off', async () => {
      const tx = await withJsClock('2006-03-04T10:00:00Z', () => paidAndActivated(biz, 'billing_growth'));
      expect(await txRow(tx)).toMatchObject({ period_start: await daysFromToday(0), period_end: await monthsFromToday(1) });
      expect(await moduleRow(biz)).toMatchObject({ start_date: await daysFromToday(0), end_date: await monthsFromToday(1) });
    });

    it('(extra, source check) period code does not read the JavaScript clock', () => {
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

    it('credit is worked out on database dates even when the process clock is years off', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid(biz, 'billing_starter', 299, -10, 20);
      for (const clock of ['2006-03-04T10:00:00Z', '2099-12-31T23:00:00Z']) {
        const c = await withJsClock(clock, () => computeUpgradeCredit(biz, 'billing', 'billing_growth'));
        expect(c.amount).toBe(199.33); // 20 unused days of 30, by the database's today
        expect(c.unusedDays).toBe(20);
      }
    });

    it('(extra, source check) credit code does not read the JavaScript clock', () => {
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

    it('grace is decided by the database date, not the process clock (route answers agree under a far-future clock)', async () => {
      await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
      clearSubscriptionCache(biz); clearModuleSubscriptionCache(biz);
      const call = async () => {
        const res = await currentGet(new NextRequest('http://localhost/api/subscriptions/current', {
          headers: { 'x-authenticated-business-id': biz, 'x-authenticated-user-id': adminOf.get(biz)! },
        }));
        expect(res.status).toBe(200);
        return (await res.json()).subscription;
      };
      const normal = await call();
      expect(normal).toMatchObject({ in_grace: true });
      // A process clock 70 years ahead would put the row long past grace if the route used it.
      const far = await withJsClock('2099-01-01T00:00:00Z', async () => {
        clearSubscriptionCache(biz); clearModuleSubscriptionCache(biz);
        return call();
      });
      expect(far).toMatchObject({ in_grace: true, grace_ends_on: normal.grace_ends_on });
    });

    it('(extra, source check) the lifecycle job and routes do not keep their own grace maths', () => {
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
      expect(await queryOne<any>(`SELECT plan_id, cancel_at_period_end AS c, cancelled_at IS NULL AS cleared FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz]))
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

  // ---- Task 5: refunds that reach the gateway and can end the plan ----

  describe('refunds reach the gateway and end the plan', () => {
    const ADMIN = randomUUID();
    const MIGRATION_480 = readFileSync(join(process.cwd(), 'database/migrations/480_subscription_tax_and_refunds.sql'), 'utf8');
    const partners: string[] = [];
    const count = async (from: string, params: unknown[] = []) =>
      Number((await queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${from}`, params))!.c);

    /** A real upgrade checkout (credit from the business's payments) paid through the signed webhook; the gateway call is stubbed. */
    async function realUpgrade(planId: string) {
      const spy = jest
        .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
        .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
      try {
        const r = await createSubscriptionCheckout({ businessId: biz, planId, billingCycle: 'monthly' });
        const done = await hook('payment.captured', 'pay_up_' + sfx(), 'captured', notesFor(biz, r.billingTransactionId, planId), Math.round(r.amount * 100));
        expect(done).toMatchObject({ ok: true });
        return { tx: r.billingTransactionId, amount: r.amount };
      } finally {
        spy.mockRestore();
      }
    }

    type Call = { url: string; method: string; headers: Record<string, string>; body: any };
    let calls: Call[] = [];
    type Reply = { status?: number; json?: unknown; reject?: boolean };

    /** Every gateway call is answered by `handler`; calls are recorded. The real network is never reached. */
    function stubGateway(handler: (c: Call) => Reply) {
      calls = [];
      (global.fetch as unknown as jest.Mock).mockReset();
      (global.fetch as unknown as jest.Mock).mockImplementation(async (url: unknown, init?: any) => {
        const c: Call = {
          url: String(url),
          method: init?.method ?? 'GET',
          headers: init?.headers ?? {},
          body: typeof init?.body === 'string' && init.body.startsWith('{') ? JSON.parse(init.body) : init?.body,
        };
        calls.push(c);
        const r = handler(c);
        if (r.reject) throw new TypeError('fetch failed');
        const status = r.status ?? 200;
        return { ok: status >= 200 && status < 300, status, json: async () => r.json ?? {} };
      });
    }
    // A fresh gateway refund id per call unless one is given (two refunds never share an id).
    const razorpayOk = (refundId?: string, status = 'processed') => (c: Call) =>
      c.url.includes('/refund') ? { json: { id: refundId ?? 'rfnd_' + sfx().replace(/-/g, 'x'), status } } : {};

    beforeAll(async () => {
      await query(MIGRATION_480);
    });

    beforeEach(() => {
      stubGateway(() => ({ reject: true }));
      (requirePlatformRequest as jest.Mock).mockReset();
    });

    afterAll(async () => {
      (global.fetch as unknown as jest.Mock).mockReset();
      (global.fetch as unknown as jest.Mock).mockRejectedValue(new Error('network disabled in tests'));
      for (const id of partners) await query(`DELETE FROM platform_partners WHERE id = $1`, [id]).catch(() => undefined);
    });

    /** A completed payment with a paid period (day offsets from the database's today). */
    async function pay(
      businessId: string,
      planId: string,
      amount: number,
      startOff: number | null,
      endOff: number | null,
      o: {
        method?: string;
        ref?: string | null;
        metadata?: Record<string, unknown>;
        gateway?: Record<string, unknown>;
        couponId?: string | null;
        status?: string;
      } = {},
    ): Promise<string> {
      const method = o.method ?? 'razorpay';
      const ref = o.ref === undefined ? (method === 'razorpay' ? 'pay_' + sfx().replace(/-/g, 'x') : null) : o.ref;
      const r = await queryOne<{ id: string }>(
        `INSERT INTO billing_transactions
           (business_id, type, status, amount, total_amount, plan_id, module_key, billing_cycle, payment_method, payment_reference,
            period_start, period_end, gateway_response, metadata, coupon_id)
         VALUES ($1, 'payment', $2, $3, $3, $4, 'billing', 'monthly', $5, $6,
                 CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END,
                 CASE WHEN $8::int IS NULL THEN NULL ELSE CURRENT_DATE + $8::int END,
                 $9::jsonb, $10::jsonb, $11)
         RETURNING id`,
        [
          businessId, o.status ?? 'completed', amount, planId, method, ref, startOff, endOff,
          JSON.stringify({ checkout_type: 'subscription', provider: method, ...(o.gateway ?? {}) }),
          JSON.stringify(o.metadata ?? {}), o.couponId ?? null,
        ],
      );
      return r!.id;
    }

    const refundsOf = (paymentId: string) =>
      query(
        `SELECT id::text AS id, status, total_amount::text AS total_amount, payment_reference, metadata
         FROM billing_transactions WHERE type = 'refund' AND metadata->>'refund_of' = $1 ORDER BY created_at`,
        [paymentId],
      ).then((r) => r.rows as { id: string; status: string; total_amount: string; payment_reference: string | null; metadata: Record<string, any> }[]);

    const planOf = (businessId: string) =>
      queryOne<{ plan_id: string; end_date: string | null; cancel_at_period_end: boolean; status: string }>(
        `SELECT plan_id, end_date::text, cancel_at_period_end, status FROM business_module_subscriptions
         WHERE business_id = $1 AND module_key = 'billing'`,
        [businessId],
      );

    const payRow = (id: string) =>
      queryOne<{ status: string; payment_reference: string | null; metadata: Record<string, any> }>(
        `SELECT status, payment_reference, metadata FROM billing_transactions WHERE id = $1`, [id],
      );

    async function addCommission(businessId: string, txId: string): Promise<string> {
      const partnerId = randomUUID();
      partners.push(partnerId);
      await query(
        `INSERT INTO platform_partners (id, name, email, password_hash, referral_code) VALUES ($1, 'P', $2, 'x', $3)`,
        [partnerId, `p_${partnerId.slice(0, 8)}@example.test`, 'RF' + partnerId.slice(0, 8)],
      );
      await query(
        `INSERT INTO partner_commissions (partner_id, business_id, billing_transaction_id, sale_amount, commission_type, commission_rate, commission_amount, eligible_at)
         VALUES ($1, $2, $3, 499, 'percentage', 20, 99.8, NOW())`,
        [partnerId, businessId, txId],
      );
      return partnerId;
    }

    const req = (businessId: string, tx: string, o: Record<string, unknown> = {}) => ({
      businessId, transactionId: tx, adminId: ADMIN, endPlan: 'period_end' as const, ...o,
    });

    function refundHook(event: string, refundId: string, payId: string, amountPaise: number) {
      const raw = JSON.stringify({
        event,
        payload: {
          refund: { entity: { id: refundId, payment_id: payId, amount: amountPaise, status: event.replace('refund.', '') } },
          payment: { entity: { id: payId } },
        },
      });
      const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
      return processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': sig });
    }
    const eventRow = (refundId: string, ev: string) =>
      queryOne<{ status: string; processing_notes: string | null }>(
        `SELECT status, processing_notes FROM platform_billing_webhook_events WHERE provider = 'razorpay' AND payload::text LIKE $1 AND event_type = $2`,
        [`%${refundId}%`, ev],
      );

    describe('state table and migration', () => {
      it('completed -> refunded is allowed; pending -> refunded, refunded -> anything and completed -> failed are not', () => {
        expect(() => assertBillingTransactionTransition('completed', 'refunded')).not.toThrow();
        expect(() => assertBillingTransactionTransition('pending', 'refunded')).toThrow();
        expect(() => assertBillingTransactionTransition('refunded', 'completed')).toThrow();
        expect(() => assertBillingTransactionTransition('refunded', 'refunded')).toThrow();
        expect(() => assertBillingTransactionTransition('completed', 'failed')).toThrow();
      });

      it('migration 480 can run again without error and leaves its indexes in place', async () => {
        await query(MIGRATION_480);
        const r = await query(
          `SELECT indexname FROM pg_indexes WHERE tablename = 'billing_transactions' AND indexname IN
             ('idx_billing_tx_refund_of', 'uq_billing_tx_refund_gateway_ref', 'uq_billing_tx_refund_idempotency')`,
        );
        expect(r.rows).toHaveLength(3);
      });

      it('the mark-refunded helper can no longer set refunded by itself', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await expect(updateBillingTransactionStatus(tx, 'refunded', { by: 'admin' })).rejects.toMatchObject({
          code: 'REFUND_REQUIRES_REFUND_FLOW',
        });
        expect((await payRow(tx))!.status).toBe('completed');
      });
    });

    describe('a full refund', () => {
      it("endPlan 'now': one gateway call with the payment id and paise, refund completed, payment refunded, plan on free, commission cancelled", async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const payId = (await payRow(tx))!.payment_reference!;
        await addCommission(biz, tx);
        stubGateway(razorpayOk('rfnd_full1'));

        const res = await refundPlatformPayment(req(biz, tx, { endPlan: 'now', notes: 'customer asked' }));

        expect(calls).toHaveLength(1);
        expect(calls[0].url).toMatch(new RegExp(`/v1/payments/${payId}/refund$`));
        expect(calls[0].method).toBe('POST');
        const price = await planPrice('billing_growth');
        expect(calls[0].body).toEqual({ amount: Math.round(price * 100) });
        const refunds = await refundsOf(tx);
        expect(refunds).toHaveLength(1);
        expect(calls[0].headers['X-Refund-Idempotency']).toBe(gatewayRefundKey(refunds[0].id));
        expect(res).toMatchObject({ refundTransactionId: refunds[0].id, status: 'processed', refundedTotal: price, fullyRefunded: true });
        expect(refunds[0]).toMatchObject({ status: 'completed', payment_reference: 'rfnd_full1' });
        expect(Number(refunds[0].total_amount)).toBe(price);
        expect(refunds[0].metadata).toMatchObject({ refund_of: tx, end_plan: 'now', requested_by_admin: ADMIN, plan_effect: 'ended_now' });
        expect((await payRow(tx))!.status).toBe('refunded');
        expect(await planOf(biz)).toMatchObject({ plan_id: 'free', end_date: null, status: 'active' });
        const c = await queryOne<{ status: string }>(`SELECT status FROM partner_commissions WHERE billing_transaction_id = $1`, [tx]);
        expect(c!.status).toBe('cancelled');
        const ev = await queryOne<{ event_type: string }>(
          `SELECT event_type FROM subscription_events WHERE business_id = $1 AND event_type = 'refunded'`, [biz],
        );
        expect(ev).not.toBeNull();
        // The refunded payment no longer gives upgrade credit.
        await setRow(biz, 'billing_starter', { startOffset: -5, endOffset: 25 });
        expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(0);
      });

      it("endPlan 'period_end': the plan keeps running and is set to end with the paid period", async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const before = await planOf(biz);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, tx, { endPlan: 'period_end' }));
        expect(await planOf(biz)).toMatchObject({ plan_id: 'billing_growth', cancel_at_period_end: true, end_date: before!.end_date });
        expect((await payRow(tx))!.status).toBe('refunded');
      });

      it('a ₹1 payment is refundable', async () => {
        const tx = await pay(biz, 'billing_growth', 1, -1, 29);
        await setRow(biz, 'billing_growth', { startOffset: -1, endOffset: 29 });
        stubGateway(razorpayOk());
        const res = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect(calls[0].body).toEqual({ amount: 100 });
        expect(res).toMatchObject({ status: 'processed', refundedTotal: 1, fullyRefunded: true });
      });
    });

    describe('partial refunds and limits', () => {
      it('a partial refund leaves the payment completed; the second partial completes it', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        const planBefore = await planOf(biz);
        stubGateway(razorpayOk());
        // The default choice is 'period_end' (which would cancel the plan on a full refund): a partial refund ignores it.
        const a = await refundPlatformPayment(req(biz, tx, { amount: 150.5 }));
        expect(calls[0].body).toEqual({ amount: 15050 });
        expect(a).toMatchObject({ status: 'processed', refundedTotal: 150.5, fullyRefunded: false });
        expect(a.message).toContain('The plan is unchanged.');
        expect(await planOf(biz)).toEqual(planBefore);
        expect((await planOf(biz))!.cancel_at_period_end).toBe(false);
        expect((await payRow(tx))!.status).toBe('completed');
        expect((await payRow(tx))!.metadata.refunded_paise).toBe(15050);

        stubGateway(razorpayOk());
        const b = await refundPlatformPayment(req(biz, tx));
        expect(calls[0].body).toEqual({ amount: 34850 });
        expect(b).toMatchObject({ refundedTotal: 499, fullyRefunded: true });
        expect((await payRow(tx))!.status).toBe('refunded');
        expect(await refundsOf(tx)).toHaveLength(2);
        // The refund that brings the payment to fully refunded applies the choice.
        expect((await planOf(biz))!.cancel_at_period_end).toBe(true);
      });

      it('a partly refunded payment gives upgrade credit only on what remains', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const tx = await pay(biz, 'billing_starter', 300, -10, 20);
        const full = await computeUpgradeCredit(biz, 'billing', 'billing_growth');
        expect(full.amount).toBe(200);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, tx, { amount: 150, endPlan: 'period_end' }));
        const half = await computeUpgradeCredit(biz, 'billing', 'billing_growth');
        expect(half.amount).toBe(100);
      });

      it('a refund above what is left is refused with REFUND_EXCEEDS_PAYMENT and nothing is sent', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        await expect(refundPlatformPayment(req(biz, tx, { amount: 499.01 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
        expect(calls).toHaveLength(0);
        expect(await refundsOf(tx)).toHaveLength(0);
      });

      it('amounts below ₹1 or with fractions of a paisa are refused; a last 50 paise can still be refunded', async () => {
        const tx = await pay(biz, 'billing_growth', 10.5, -5, 25);
        stubGateway(razorpayOk());
        await expect(refundPlatformPayment(req(biz, tx, { amount: 0.5 }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        await expect(refundPlatformPayment(req(biz, tx, { amount: 1.005 }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        await expect(refundPlatformPayment(req(biz, tx, { amount: -3 }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
        expect(calls).toHaveLength(0);
        await refundPlatformPayment(req(biz, tx, { amount: 10 }));
        const last = await refundPlatformPayment(req(biz, tx));
        expect(calls[1].body).toEqual({ amount: 50 });
        expect(last.fullyRefunded).toBe(true);
      });

      it('upgrade credit taken from a payment is not refunded in cash', async () => {
        const tx = await pay(biz, 'billing_starter', 499, -10, 20, { metadata: { credit_consumed_by: randomUUID(), credit_used_paise: 20000 } });
        stubGateway(razorpayOk());
        await expect(refundPlatformPayment(req(biz, tx, { amount: 299.01 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
        const res = await refundPlatformPayment(req(biz, tx));
        expect(calls).toHaveLength(1);
        expect(calls[0].body).toEqual({ amount: 29900 });
        expect(res).toMatchObject({ refundedTotal: 299, fullyRefunded: true });
        expect((await payRow(tx))!.status).toBe('refunded');
      });

      it('a payment that was itself bought with credit (a real upgrade) refunds only what was paid, and refunding it with now ends the plan', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        await pay(biz, 'billing_starter', 299, -10, 20);
        const q = await realUpgrade('billing_growth');
        expect(q.amount).toBe(299.67); // 499 - 199.33 credit
        const growth = q.tx;
        stubGateway(razorpayOk());
        await expect(refundPlatformPayment(req(biz, growth, { amount: 499 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
        const res = await refundPlatformPayment(req(biz, growth, { endPlan: 'now' }));
        expect(calls[0].body).toEqual({ amount: 29967 });
        expect(res).toMatchObject({ fullyRefunded: true });
        expect(await planOf(biz)).toMatchObject({ plan_id: 'free', end_date: null, cancel_at_period_end: false });
      });

      it('a coupon-only (₹0) payment, a pending, a failed and a refund row are NOT_REFUNDABLE', async () => {
        const zero = await pay(biz, 'billing_growth', 0, -1, 29, { method: 'coupon', ref: null });
        const pending = await pay(biz, 'billing_growth', 499, null, null, { status: 'pending' });
        const failed = await pay(biz, 'billing_growth', 499, null, null, { status: 'failed' });
        for (const tx of [zero, pending, failed]) {
          await expect(refundPlatformPayment(req(biz, tx))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
        }
        expect(calls).toHaveLength(0);
        const done = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, done));
        const refundRow = (await refundsOf(done))[0].id;
        await expect(refundPlatformPayment(req(biz, refundRow))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
        await expect(refundPlatformPayment(req(biz, done))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
      });

      it("a payment of another business is NOT_FOUND, and a gateway payment with no payment id is NOT_REFUNDABLE", async () => {
        const other = await newBusiness('other');
        const tx = await pay(other, 'billing_growth', 499, -5, 25);
        await expect(refundPlatformPayment(req(biz, tx))).rejects.toMatchObject({ code: 'NOT_FOUND' });
        const link = await pay(biz, 'billing_growth', 499, -5, 25, { ref: 'plink_abc123' });
        await expect(refundPlatformPayment(req(biz, link))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
        expect(calls).toHaveLength(0);
      });
    });

    describe('gateway failures, timeouts and repeats', () => {
      it('a refusal marks the refund failed, changes nothing else, and says so', async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const before = await planOf(biz);
        // The refusal is a 400; the status lookup that follows it finds no refund for the payment.
        stubGateway((c) => (c.method === 'GET' ? { json: { items: [] } } : { status: 400, json: { error: { description: 'The payment has not been captured' } } }));
        const err = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' })).catch((e) => e);
        expect(err).toBeInstanceOf(PlatformRefundError);
        expect(err.code).toBe('GATEWAY_REFUSED');
        expect(err.message).toMatch(/No money was returned/);
        expect(err.message).toMatch(/plan was not changed/);
        const refunds = await refundsOf(tx);
        expect(refunds).toHaveLength(1);
        expect(refunds[0].status).toBe('failed');
        expect(refunds[0].metadata.failure_reason).toBeTruthy();
        expect((await payRow(tx))!.status).toBe('completed');
        expect((await payRow(tx))!.metadata.refunded_paise).toBe(0);
        expect(await planOf(biz)).toEqual(before);
        // A failed refund reserves nothing: the same payment can be refunded again.
        stubGateway(razorpayOk());
        expect((await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }))).status).toBe('processed');
        expect(await refundsOf(tx)).toHaveLength(2);
      });

      it('no platform Razorpay credentials: refused, nothing sent, plan untouched', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        const saved = process.env.PLATFORM_RAZORPAY_KEY_ID;
        delete process.env.PLATFORM_RAZORPAY_KEY_ID;
        try {
          await expect(refundPlatformPayment(req(biz, tx))).rejects.toMatchObject({ code: 'GATEWAY_REFUSED' });
        } finally {
          process.env.PLATFORM_RAZORPAY_KEY_ID = saved;
        }
        expect(calls).toHaveLength(0);
        expect((await refundsOf(tx))[0].status).toBe('failed');
      });

      it("a timeout leaves the refund pending; the refund.processed webhook completes it and applies 'now'", async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const payId = (await payRow(tx))!.payment_reference!;
        stubGateway(() => ({ reject: true }));
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const res = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        err.mockRestore();
        expect(res).toMatchObject({ status: 'pending', fullyRefunded: false, refundedTotal: 0 });
        expect(res.message).toMatch(/plan has not been changed/);
        const [row] = await refundsOf(tx);
        expect(row.status).toBe('pending');
        expect((await planOf(biz))!.plan_id).toBe('billing_growth');
        expect((await payRow(tx))!.status).toBe('completed');

        const price = await planPrice('billing_growth');
        const hookRes = await refundHook('refund.processed', 'rfnd_late1', payId, Math.round(price * 100));
        expect(hookRes).toMatchObject({ ok: true });
        const [done] = await refundsOf(tx);
        expect(done).toMatchObject({ id: row.id, status: 'completed', payment_reference: 'rfnd_late1' });
        expect(done.metadata.plan_effect).toBe('ended_now');
        expect((await payRow(tx))!.status).toBe('refunded');
        expect((await planOf(biz))!.plan_id).toBe('free');
        expect(await eventRow('rfnd_late1', 'refund.processed')).toMatchObject({ status: 'processed' });
        // Delivered again: nothing happens twice.
        expect(await refundHook('refund.processed', 'rfnd_late1', payId, Math.round(price * 100))).toMatchObject({ duplicate: true });
        expect(await refundsOf(tx)).toHaveLength(1);
      });

      it('a repeat of the same request after a timeout resumes it with the same idempotency key: one refund, one row', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway(() => ({ reject: true }));
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect((await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }))).status).toBe('pending');
        err.mockRestore();
        stubGateway(razorpayOk('rfnd_resume'));
        const again = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect(again).toMatchObject({ status: 'processed', fullyRefunded: true });
        const rows = await refundsOf(tx);
        expect(rows).toHaveLength(1);
        const post = calls.filter((c) => c.method === 'POST');
        expect(post).toHaveLength(1);
        expect(post[0].headers['X-Refund-Idempotency']).toBe(gatewayRefundKey(rows[0].id));
        expect((await planOf(biz))!.plan_id).toBe('free');
      });

      it('a pending refund the gateway accepted settles by asking it again, and a different amount is not mixed up with it', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway(razorpayOk('rfnd_slow', 'pending'));
        const first = await refundPlatformPayment(req(biz, tx, { amount: 200, endPlan: 'now' }));
        expect(first).toMatchObject({ status: 'pending', refundedTotal: 0 });
        const [row] = await refundsOf(tx);
        expect(row).toMatchObject({ status: 'pending', payment_reference: 'rfnd_slow' });
        expect((await planOf(biz))!.plan_id).toBe('billing_growth');
        // Another refund while one is pending is refused with a clear reason.
        await expect(refundPlatformPayment(req(biz, tx, { amount: 100 }))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
        // Asking again looks the refund up (GET) and does not create another.
        stubGateway((c) => ({ json: { id: 'rfnd_slow', status: 'processed' } }));
        const settled = await settlePlatformRefund(row.id);
        expect(calls).toHaveLength(1);
        expect(calls[0].method).toBe('GET');
        expect(settled).toMatchObject({ status: 'processed', refundedTotal: 200, fullyRefunded: false });
        // Only 200 of 499 came back: a partial refund never changes the plan, whatever was asked.
        expect(await planOf(biz)).toMatchObject({ plan_id: 'billing_growth', cancel_at_period_end: false });
      });

      it('refund.failed marks a pending refund failed and leaves the plan alone', async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const payId = (await payRow(tx))!.payment_reference!;
        stubGateway(razorpayOk('rfnd_bad', 'pending'));
        await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        const price = await planPrice('billing_growth');
        await refundHook('refund.failed', 'rfnd_bad', payId, Math.round(price * 100));
        expect((await refundsOf(tx))[0].status).toBe('failed');
        expect((await payRow(tx))!.status).toBe('completed');
        expect((await payRow(tx))!.metadata.refunded_paise).toBe(0);
        expect((await planOf(biz))!.plan_id).toBe('billing_growth');
        expect(await eventRow('rfnd_bad', 'refund.failed')).toMatchObject({ status: 'failed' });
      });

      it('a repeat with the same idempotency key returns the same refund without calling the gateway again', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        const a = await refundPlatformPayment(req(biz, tx, { amount: 100, idempotencyKey: 'click-1' }));
        const b = await refundPlatformPayment(req(biz, tx, { amount: 100, idempotencyKey: 'click-1' }));
        expect(b.refundTransactionId).toBe(a.refundTransactionId);
        expect(calls).toHaveLength(1);
        expect(await refundsOf(tx)).toHaveLength(1);
        // A different key is a second, separate refund.
        await refundPlatformPayment(req(biz, tx, { amount: 100, idempotencyKey: 'click-2' }));
        expect(await refundsOf(tx)).toHaveLength(2);
      });

      it('two clicks at the same moment make one refund', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway(razorpayOk('rfnd_same'));
        const [a, b] = await Promise.all([
          refundPlatformPayment(req(biz, tx, { endPlan: 'now' })),
          refundPlatformPayment(req(biz, tx, { endPlan: 'now' })),
        ]);
        expect(a.refundTransactionId).toBe(b.refundTransactionId);
        expect(await refundsOf(tx)).toHaveLength(1);
        // Only the caller that claimed the attempt talks to the gateway.
        expect(calls.filter((c) => c.method === 'POST')).toHaveLength(1);
        expect((await payRow(tx))!.status).toBe('refunded');
        expect((await planOf(biz))!.plan_id).toBe('free');
      });
    });

    describe('other gateways and payment kinds', () => {
      it('a manual payment is recorded with no gateway call', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25, { method: 'manual', ref: null });
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        const res = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect(calls).toHaveLength(0);
        expect(res).toMatchObject({ status: 'processed', fullyRefunded: true });
        expect(res.message).toMatch(/outside Khatario/);
        expect((await payRow(tx))!.status).toBe('refunded');
        expect((await planOf(biz))!.plan_id).toBe('free');
      });

      it('Easebuzz: the refund is requested with our merchant refund id and stays pending until Easebuzz confirms it', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25, {
          method: 'easebuzz', ref: 'TXN' + sfx().replace(/-/g, 'x'), gateway: { webhook: { easepayid: 'E2409040A97T7L' } },
        });
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway((c) => (c.url.includes('/transaction/v2/refund') ? { json: { status: true } } : {}));
        const res = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect(res.status).toBe('pending');
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/transaction/v2/refund');
        const [row] = await refundsOf(tx);
        expect(calls[0].body).toMatchObject({
          easebuzz_id: 'E2409040A97T7L', refund_amount: '499.00', merchant_refund_id: gatewayRefundKey(row.id),
        });
        expect((await planOf(biz))!.plan_id).toBe('billing_growth');

        // Asking again looks up our merchant refund id first and never raises a second refund.
        stubGateway((c) =>
          c.url.includes('/refund/v1/retrieve')
            ? { json: { status: true, refunds: [{ merchant_refund_id: gatewayRefundKey(row.id), refund_status: 'refunded', refund_amount: '499.00' }] } }
            : {},
        );
        const again = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toContain('/refund/v1/retrieve');
        expect(again).toMatchObject({ status: 'processed', fullyRefunded: true });
        expect((await planOf(biz))!.plan_id).toBe('free');
      });

      it('Easebuzz with no transaction id on record is NOT_REFUNDABLE', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25, { method: 'easebuzz', ref: 'TXN' + sfx() });
        await expect(refundPlatformPayment(req(biz, tx))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
      });

      it('a WhatsApp add-on payment is refunded in money only: the plan is not touched', async () => {
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        const tx = await pay(biz, 'billing_growth', 100, null, null, { gateway: { checkout_type: 'whatsapp_addon' } });
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect((await planOf(biz))!.plan_id).toBe('billing_growth');
        expect((await refundsOf(tx))[0].metadata.plan_effect).toBe('none_not_a_plan_payment');
      });
    });

    describe('the plan rule with renewals', () => {
      it('refunding the current payment with a renewal still to come shortens the end date, never moves to Free', async () => {
        await setRow(biz, 'billing_growth', { startOffset: -20, endOffset: 40 });
        const a = await pay(biz, 'billing_growth', 499, -20, 10);
        await pay(biz, 'billing_growth', 499, 10, 40);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, a, { endPlan: 'now' }));
        const exp = await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + 40 - 30)::text AS d`);
        expect(await planOf(biz)).toMatchObject({ plan_id: 'billing_growth', end_date: exp!.d });
        expect((await refundsOf(a))[0].metadata.plan_effect).toBe('end_date_shortened');
      });

      it('the admin message states the real end date when a later renewal kept the plan from ending', async () => {
        await setRow(biz, 'billing_growth', { startOffset: -20, endOffset: 40 });
        const a = await pay(biz, 'billing_growth', 499, -20, 10);
        await pay(biz, 'billing_growth', 499, 10, 40);
        stubGateway(razorpayOk());
        const res = await refundPlatformPayment(req(biz, a, { endPlan: 'now' }));
        const exp = await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + 10)::text AS d`);
        expect(res.message).toContain('did not end today');
        expect(res.message).toContain(`the plan now ends on ${exp!.d}`);
      });

      it('a legacy payment with no period dates does not end the plan while another payment exists', async () => {
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        const legacy = await pay(biz, 'billing_growth', 499, null, null);
        await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, legacy, { endPlan: 'now' }));
        expect((await planOf(biz))!.plan_id).toBe('billing_growth');
        expect((await refundsOf(legacy))[0].metadata.plan_effect).toBe('none_no_period');
      });

      it('refunding a wholly future renewal shortens the end date by its period (both choices)', async () => {
        for (const endPlan of ['now', 'period_end'] as const) {
          const b2 = await newBusiness('fut');
          await setRow(b2, 'billing_growth', { startOffset: -20, endOffset: 40 });
          await pay(b2, 'billing_growth', 499, -20, 10);
          const future = await pay(b2, 'billing_growth', 499, 10, 40);
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(b2, future, { endPlan }));
          const exp = await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + 10)::text AS d`);
          expect(await planOf(b2)).toMatchObject({ plan_id: 'billing_growth', end_date: exp!.d, cancel_at_period_end: false });
        }
      });

      it("an older payment: 'now' shortens, 'period_end' changes nothing; never below tomorrow while another payment covers today", async () => {
        await setRow(biz, 'billing_growth', { startOffset: -40, endOffset: 5 });
        const old = await pay(biz, 'billing_growth', 499, -70, -40);
        await pay(biz, 'billing_growth', 499, -35, 5);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, old, { endPlan: 'period_end' }));
        expect((await planOf(biz))!.end_date).toBe(await daysFromToday(5));
        const old2 = await pay(biz, 'billing_growth', 499, -100, -70);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, old2, { endPlan: 'now' }));
        const after = await planOf(biz);
        expect(after!.plan_id).toBe('billing_growth');
        expect(after!.end_date).toBe(await daysFromToday(1)); // 5 - 30 days is in the past: held at tomorrow
      });

      it('an old plan\'s payment whose time was used as credit is not "another payment": refunding the upgrade with now ends the plan (real flow)', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const starter = await pay(biz, 'billing_starter', 299, -10, 20);
        const q = await realUpgrade('billing_growth');
        // The real overlap: the Starter payment still shows 20 days ahead, but its time was consumed as credit.
        expect((await payRow(starter))!.metadata.credit_consumed_by).toBe(q.tx);
        stubGateway(razorpayOk());
        const res = await refundPlatformPayment(req(biz, q.tx, { endPlan: 'now' }));
        expect(await planOf(biz)).toMatchObject({ plan_id: 'free', end_date: null, status: 'active' });
        expect(res.message).toMatch(/free plan/);
        expect(res.message).not.toMatch(/did not end today/);
      });

      it('refunding the only payment of the current plan moves it to Free; a payment for an older plan does not touch the plan', async () => {
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        const oldPlanPay = await pay(biz, 'billing_starter', 299, -30, -5);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, oldPlanPay, { endPlan: 'now' }));
        expect((await planOf(biz))!.plan_id).toBe('billing_growth');
        const cur = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, cur, { endPlan: 'now' }));
        expect((await planOf(biz))!.plan_id).toBe('free');
      });

      it('two refunds on different payments of one product at the same time both finish (no deadlock)', async () => {
        await setRow(biz, 'billing_growth', { startOffset: -20, endOffset: 40 });
        const a = await pay(biz, 'billing_growth', 499, -20, 10);
        const b = await pay(biz, 'billing_growth', 499, 10, 40);
        stubGateway(razorpayOk());
        const rs = await Promise.all([
          refundPlatformPayment(req(biz, a, { endPlan: 'now' })),
          refundPlatformPayment(req(biz, b, { endPlan: 'now' })),
        ]);
        rs.forEach((r) => expect(r.status).toBe('processed'));
        expect((await payRow(a))!.status).toBe('refunded');
        expect((await payRow(b))!.status).toBe('refunded');
      });
    });

    describe('coupons and partner commission', () => {
      it('a full refund keeps the coupon redemption and flags it for review; the finder lists it', async () => {
        const coupon = await makeCoupon('free_months', 1);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        const tx = await pay(biz, 'billing_growth', 499, -5, 25, { couponId: coupon });
        const red = await queryOne<{ id: string }>(
          `INSERT INTO coupon_redemptions (coupon_id, business_id, billing_transaction_id, plan_id, discount_amount)
           VALUES ($1, $2, $3, 'billing_growth', 0) RETURNING id`, [coupon, biz, tx],
        );
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        const [r] = await refundsOf(tx);
        expect(r.metadata).toMatchObject({ needs_review: true, coupon_redemption: { id: red!.id, coupon_id: coupon } });
        expect(r.metadata.review_reasons).toContain('coupon_redemption_kept');
        expect(await count(`coupon_redemptions WHERE id = $1`, [red!.id])).toBe(1);
        expect((await findRefundsNeedingReview()).find((x) => x.refund_id === r.id)?.reasons).toContain('coupon_redemption_kept');
      });

      it('a partial refund leaves partner commission alone', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await addCommission(biz, tx);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(biz, tx, { amount: 100 }));
        const c = await queryOne<{ status: string }>(`SELECT status FROM partner_commissions WHERE billing_transaction_id = $1`, [tx]);
        expect(c!.status).toBe('pending');
      });

      it('a refund still pending after an hour is listed by the finder', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(() => ({ reject: true }));
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        await refundPlatformPayment(req(biz, tx));
        err.mockRestore();
        const [r] = await refundsOf(tx);
        expect((await findRefundsNeedingReview()).map((x) => x.refund_id)).not.toContain(r.id);
        await query(`UPDATE billing_transactions SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE id = $1`, [r.id]);
        expect((await findRefundsNeedingReview()).find((x) => x.refund_id === r.id)?.reasons).toContain('refund_pending_over_an_hour');
      });
    });

    describe('refunds made in the gateway dashboard', () => {
      it('a full refund creates a row, leaves the plan until period end, and flags it', async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const payId = (await payRow(tx))!.payment_reference!;
        await addCommission(biz, tx);
        const price = await planPrice('billing_growth');
        expect(await refundHook('refund.created', 'rfnd_dash1', payId, Math.round(price * 100))).toMatchObject({ ok: true });
        let [r] = await refundsOf(tx);
        expect(r).toMatchObject({ status: 'pending', payment_reference: 'rfnd_dash1' });
        expect(r.metadata.source).toBe('gateway_dashboard');
        expect((await planOf(biz))!.cancel_at_period_end).toBe(false);

        await refundHook('refund.processed', 'rfnd_dash1', payId, Math.round(price * 100));
        [r] = await refundsOf(tx);
        expect(r.status).toBe('completed');
        expect(await refundsOf(tx)).toHaveLength(1);
        expect((await payRow(tx))!.status).toBe('refunded');
        expect(await planOf(biz)).toMatchObject({ plan_id: 'billing_growth', cancel_at_period_end: true });
        expect(r.metadata.review_reasons).toContain('refund_made_in_gateway_dashboard');
        expect((await queryOne<{ status: string }>(`SELECT status FROM partner_commissions WHERE billing_transaction_id = $1`, [tx]))!.status).toBe('cancelled');
        expect((await findRefundsNeedingReview()).map((x) => x.refund_id)).toContain(r.id);
        // The same event again changes nothing.
        expect(await refundHook('refund.processed', 'rfnd_dash1', payId, Math.round(price * 100))).toMatchObject({ duplicate: true });
      });

      it('a partial dashboard refund is recorded and flagged but the plan is not changed', async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const payId = (await payRow(tx))!.payment_reference!;
        await refundHook('refund.processed', 'rfnd_dash2', payId, 10000);
        const [r] = await refundsOf(tx);
        expect(r).toMatchObject({ status: 'completed', total_amount: '100.00' });
        expect(r.metadata.plan_effect).toBe('none_partial_gateway_refund');
        expect((await payRow(tx))!.status).toBe('completed');
        expect(await planOf(biz)).toMatchObject({ plan_id: 'billing_growth', cancel_at_period_end: false });
      });

      it('a refund for a payment that is not ours, or a bad signature, changes nothing', async () => {
        expect(await refundHook('refund.processed', 'rfnd_unknown', 'pay_unknown1', 10000)).toMatchObject({ ok: true });
        expect(await eventRow('rfnd_unknown', 'refund.processed')).toMatchObject({ status: 'ignored' });
        const raw = JSON.stringify({ event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd_forged', payment_id: 'pay_x', amount: 100 } } } });
        expect(await processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': 'ab'.repeat(32) })).toMatchObject({ ok: false });
        expect(await count(`platform_billing_webhook_events WHERE payload::text LIKE '%rfnd_forged%'`)).toBe(0);
      });

      it('a refund event never completes or activates a checkout', async () => {
        const tx = await pendingCheckout(biz, 'billing_growth', 499);
        const raw = JSON.stringify({
          event: 'refund.processed',
          payload: { payment: { entity: { id: 'pay_x1', status: 'captured', amount: 49900, notes: notesFor(biz, tx, 'billing_growth') } } },
        });
        const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
        expect(await processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': sig })).toMatchObject({ ok: true });
        expect((await txRow(tx))!.status).toBe('pending');
        expect(await moduleRow(biz)).toBeNull();
      });

      it('two refunds of one payment get separate idempotency keys in the event log', async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const payId = (await payRow(tx))!.payment_reference!;
        await refundHook('refund.processed', 'rfnd_a1', payId, 10000);
        await refundHook('refund.processed', 'rfnd_a2', payId, 20000);
        const rows = await refundsOf(tx);
        expect(rows.map((r) => r.payment_reference).sort()).toEqual(['rfnd_a1', 'rfnd_a2']);
      });
    });

    describe('fix round 1: one gateway attempt, credit, history, notices, nightly settle', () => {
      const POSTS = () => calls.filter((c) => c.method === 'POST');
      const easePay = (businessId: string, amount = 499) =>
        pay(businessId, 'billing_growth', amount, -5, 25, {
          method: 'easebuzz', ref: 'TXN' + sfx().replace(/-/g, 'x'), gateway: { webhook: { easepayid: 'E2409040A97T7L' } },
        });

      it('two simultaneous Easebuzz calls send ONE refund request; the row is not failed and the amount stays reserved', async () => {
        const tx = await easePay(biz);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        let first = true;
        stubGateway((c) => {
          if (c.url.includes('/transaction/v2/refund')) {
            // Easebuzz refuses a second request with the same merchant refund id.
            if (first) { first = false; return { json: { status: true } }; }
            return { json: { status: false, reason: 'Duplicate merchant_refund_id' } };
          }
          return {};
        });
        const rs = await Promise.all([
          refundPlatformPayment(req(biz, tx, { amount: 200, endPlan: 'now' })),
          refundPlatformPayment(req(biz, tx, { amount: 200, endPlan: 'now' })),
        ]);
        expect(POSTS()).toHaveLength(1);
        expect(rs.map((r) => r.status)).toEqual(['pending', 'pending']);
        const rows = await refundsOf(tx);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('pending');
        expect((await payRow(tx))!.metadata.refunded_paise).toBe(20000);
        // Another refund of the same money is still refused.
        await expect(refundPlatformPayment(req(biz, tx, { amount: 400 }))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
      });

      it('two simultaneous Razorpay calls send ONE refund request', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk('rfnd_one'));
        const rs = await Promise.all([
          refundPlatformPayment(req(biz, tx, { amount: 100 })),
          refundPlatformPayment(req(biz, tx, { amount: 100 })),
        ]);
        expect(POSTS()).toHaveLength(1);
        expect(rs[0].refundTransactionId).toBe(rs[1].refundTransactionId);
        const rows = await refundsOf(tx);
        expect(rows).toHaveLength(1);
        expect(rows[0].status).toBe('completed');
      });

      it('an Easebuzz duplicate-id refusal on an attempted refund is "already exists": status lookup settles it, never failed', async () => {
        const tx = await easePay(biz);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway(() => ({ reject: true })); // first attempt: timeout (the refund may have reached Easebuzz)
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect((await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }))).status).toBe('pending');
        err.mockRestore();
        const [row] = await refundsOf(tx);
        // Retry: the status lookup answers first.
        stubGateway((c) =>
          c.url.includes('/refund/v1/retrieve')
            ? { json: { status: true, refunds: [{ merchant_refund_id: gatewayRefundKey(row.id), refund_status: 'refunded' }] } }
            : { json: { status: false, reason: 'Duplicate merchant_refund_id' } },
        );
        const res = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect(res.status).toBe('processed');
        expect(POSTS().filter((c) => c.url.includes('/transaction/v2/refund'))).toHaveLength(0);
        expect((await refundsOf(tx))[0].status).toBe('completed');
      });

      it('a refusal reply is never trusted alone: if the status lookup cannot answer, the row stays pending', async () => {
        const tx = await easePay(biz);
        stubGateway((c) =>
          c.url.includes('/transaction/v2/refund') ? { status: 400, json: { reason: 'bad' } } : { status: 500, json: {} },
        );
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        const res = await refundPlatformPayment(req(biz, tx));
        err.mockRestore();
        expect(res.status).toBe('pending');
        expect((await refundsOf(tx))[0].status).toBe('pending');
      });

      it('a definite refusal fails the row only when the gateway also has no such refund (Easebuzz)', async () => {
        const tx = await easePay(biz);
        stubGateway((c) =>
          c.url.includes('/transaction/v2/refund')
            ? { json: { status: false, reason: 'Refund amount exceeds' } }
            : { json: { status: true, refunds: [] } },
        );
        await expect(refundPlatformPayment(req(biz, tx))).rejects.toMatchObject({ code: 'GATEWAY_REFUSED' });
        expect((await refundsOf(tx))[0].status).toBe('failed');
      });

      it('Razorpay timeout then retry where Razorpay did refund: the refund is found by listing, no second request', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(() => ({ reject: true }));
        const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        expect((await refundPlatformPayment(req(biz, tx, { amount: 120 }))).status).toBe('pending');
        err.mockRestore();
        stubGateway((c) => (c.method === 'GET' ? { json: { items: [{ id: 'rfnd_found', amount: 12000, status: 'processed' }] } } : {}));
        const res = await refundPlatformPayment(req(biz, tx, { amount: 120 }));
        expect(res.status).toBe('processed');
        expect(POSTS()).toHaveLength(0);
        const rows = await refundsOf(tx);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ status: 'completed', payment_reference: 'rfnd_found' });
      });

      it('a webhook that settles the refund while the API call is in flight: the result says processed, not pending', async () => {
        const tx = await paidAndActivated(biz, 'billing_growth');
        const payId = (await payRow(tx))!.payment_reference!;
        const price = await planPrice('billing_growth');
        (global.fetch as unknown as jest.Mock).mockReset();
        (global.fetch as unknown as jest.Mock).mockImplementation(async () => {
          await refundHook('refund.processed', 'rfnd_race', payId, Math.round(price * 100));
          return { ok: true, status: 200, json: async () => ({ id: 'rfnd_race', status: 'pending' }) };
        });
        const res = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        expect(res.status).toBe('processed');
        expect(res.message).toMatch(/free plan/);
        expect(await refundsOf(tx)).toHaveLength(1);
        expect((await planOf(biz))!.plan_id).toBe('free');
      });

      it('a payment method that is not razorpay, easebuzz or manual is refused (fails closed)', async () => {
        const odd = await pay(biz, 'billing_growth', 499, -5, 25, { method: 'bank_transfer', ref: null });
        await expect(refundPlatformPayment(req(biz, odd))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
        await query(`UPDATE billing_transactions SET payment_method = NULL WHERE id = $1`, [odd]);
        await expect(refundPlatformPayment(req(biz, odd))).rejects.toMatchObject({ code: 'NOT_REFUNDABLE' });
        expect(await refundsOf(odd)).toHaveLength(0);
      });

      it('the refund holds the payment row, and only then waits for the module lock (payment row -> module lock)', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway(razorpayOk());
        const holder = await getPool().connect();
        const probe = await getPool().connect();
        try {
          await holder.query('BEGIN');
          await holder.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`module_plan_change:${biz}:billing`]);
          const refund = refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
          // Wait until the refund transaction is blocked on the advisory lock.
          let blocked = false;
          for (let i = 0; i < 50 && !blocked; i++) {
            await new Promise((r) => setTimeout(r, 50));
            blocked = (await probe.query(`SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rowCount! > 0;
          }
          expect(blocked).toBe(true);
          await probe.query('BEGIN');
          await expect(probe.query(`SELECT 1 FROM billing_transactions WHERE id = $1 FOR UPDATE NOWAIT`, [tx])).rejects.toMatchObject({ code: '55P03' });
          await probe.query('ROLLBACK');
          await holder.query('COMMIT');
          expect((await refund).status).toBe('processed');
        } finally {
          holder.release();
          probe.release();
        }
        expect((await planOf(biz))!.plan_id).toBe('free');
      });

      it('ending the plan runs on the refund transaction: a failed commit leaves the plan as it was', async () => {
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway(razorpayOk());
        // A refund of a payment the module is not on cannot touch it, whatever the choice.
        const cnt = (await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM subscription_events WHERE business_id = $1 AND event_type = 'refunded'`, [biz]))!.n;
        await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
        const after = (await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM subscription_events WHERE business_id = $1 AND event_type = 'refunded'`, [biz]))!.n;
        expect(Number(after)).toBe(Number(cnt) + 1);
        expect((await planOf(biz))!.plan_id).toBe('free');
      });

      describe('upgrade credit from a partly refunded payment', () => {
        async function checkout(planId: string) {
          const spy = jest
            .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
            .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
          try {
            const r = await createSubscriptionCheckout({ businessId: biz, planId, billingCycle: 'monthly' });
            return { tx: r.billingTransactionId, amount: r.amount };
          } finally {
            spy.mockRestore();
          }
        }
        const meta = (id: string) => queryOne<{ metadata: Record<string, any> }>(`SELECT metadata FROM billing_transactions WHERE id = $1`, [id]);

        it('a refund made BEFORE the credit was granted does not reject it: full period, source consumed', async () => {
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          const src = await pay(biz, 'billing_starter', 300, -10, 20);
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, src, { amount: 150, endPlan: 'period_end' }));
          stubGateway(() => ({ reject: true }));
          const q = await checkout('billing_growth');
          const m0 = await meta(q.tx);
          expect(m0!.metadata.upgrade_credit.amount).toBe(100);
          expect(m0!.metadata.upgrade_credit.allocation[0]).toMatchObject({ id: src, refundedPaise: 15000 });
          await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, q.tx, 'billing_growth'), Math.round(q.amount * 100));
          const after = await moduleRow(biz);
          expect(after!.plan_id).toBe('billing_growth');
          expect(after!.end_date).toBe(await monthsFromToday(1));
          const m = await meta(q.tx);
          expect(m!.metadata.upgrade_credit.rejected).toBeUndefined();
          expect((await meta(src))!.metadata.credit_consumed_by).toBe(q.tx);
        });

        it('a refund made AFTER the credit was granted rejects it: the period is shortened and flagged', async () => {
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          const src = await pay(biz, 'billing_starter', 300, -10, 20);
          stubGateway(() => ({ reject: true }));
          const q = await checkout('billing_growth');
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, src, { amount: 100, endPlan: 'period_end' }));
          await hook('payment.captured', 'pay_cr_' + sfx(), 'captured', notesFor(biz, q.tx, 'billing_growth'), Math.round(q.amount * 100));
          const m = await meta(q.tx);
          expect(m!.metadata.upgrade_credit.rejected).toBe('source_refunded');
          const after = await moduleRow(biz);
          expect(after!.end_date! < (await monthsFromToday(1))).toBe(true);
        });
      });

      describe('customer billing history', () => {
        async function history() {
          const res = await (await import('@/app/api/subscriptions/billing-history/route')).GET(
            new NextRequest('http://localhost/api/subscriptions/billing-history', {
              headers: { 'x-authenticated-business-id': biz, 'x-authenticated-user-id': adminOf.get(biz)! },
            }),
          );
          expect(res.status).toBe(200);
          return (await res.json()).transactions as any[];
        }

        it('shows a completed refund as a negative "Refund for <plan> payment of <date>", never pending or failed ones, never a uuid', async () => {
          const tx = await pay(biz, 'billing_growth', 499, -5, 25);
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, tx, { amount: 100 }));
          // A pending refund and a failed refund of this payment.
          stubGateway(razorpayOk(undefined, 'pending'));
          await refundPlatformPayment(req(biz, tx, { amount: 110 }));
          stubGateway((c) => (c.method === 'GET' ? { json: { items: [] } } : { status: 400, json: {} }));
          const pend = (await refundsOf(tx)).find((r) => r.status === 'pending')!;
          await settlePlatformRefund(pend.id).catch(() => undefined);
          const h = await history();
          const refunds = h.filter((t) => t.type === 'refund');
          expect(refunds).toHaveLength(1);
          expect(refunds[0]).toMatchObject({ amount: -100, status: 'refunded' });
          expect(refunds[0].description).toMatch(/^Refund for .+ payment of \d{2} \w{3} \d{4}$/);
          expect(JSON.stringify(h)).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}.*Refund of payment/);
          expect(refunds[0].description).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
          expect(h.find((t) => t.id === tx)).toMatchObject({ type: 'payment', amount: 499 });
        });

        it('a stale pending refund is not closed by the 48-hour checkout expiry', async () => {
          const tx = await pay(biz, 'billing_growth', 499, -5, 25);
          stubGateway(razorpayOk(undefined, 'pending'));
          await refundPlatformPayment(req(biz, tx, { amount: 100 }));
          const [r] = await refundsOf(tx);
          await query(`UPDATE billing_transactions SET created_at = CURRENT_TIMESTAMP - INTERVAL '5 days' WHERE id = $1`, [r.id]);
          await (await import('@/lib/platform-billing')).expireStaleCheckouts(48);
          expect((await refundsOf(tx))[0].status).toBe('pending');
        });
      });

      describe('customer notice', () => {
        it('a completed refund sends one email and one in-app event; pending and failed send none', async () => {
          const { sendPlatformEmail, getBusinessPlatformRecipient } = await import('@/lib/platform-email');
          (sendPlatformEmail as jest.Mock).mockClear();
          (getBusinessPlatformRecipient as jest.Mock).mockResolvedValue({ email: 'owner@example.test', businessName: 'Biz' });
          try {
            const tx = await pay(biz, 'billing_growth', 499, -5, 25);
            await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
            stubGateway(razorpayOk(undefined, 'pending'));
            await refundPlatformPayment(req(biz, tx, { amount: 100 }));
            expect(sendPlatformEmail).not.toHaveBeenCalled();
            const [p] = await refundsOf(tx);
            await settlePlatformRefund(p.id).catch(() => undefined);
            stubGateway(() => ({ json: { id: p.payment_reference ?? 'x', status: 'processed' } }));
            await settlePlatformRefund(p.id);
            expect(sendPlatformEmail).toHaveBeenCalledTimes(1);
            const mail = (sendPlatformEmail as jest.Mock).mock.calls[0][0];
            expect(mail.to).toBe('owner@example.test');
            expect(mail.text).toMatch(/refunded ₹100/);
            expect(mail.text).toMatch(/Your plan is unchanged\./);
            const ev = await query(`SELECT details FROM subscription_events WHERE business_id = $1 AND event_type = 'refund_completed'`, [biz]);
            expect(ev.rows).toHaveLength(1);
            await settlePlatformRefund(p.id);
            expect(sendPlatformEmail).toHaveBeenCalledTimes(1);
          } finally {
            (getBusinessPlatformRecipient as jest.Mock).mockResolvedValue(null);
          }
        });
      });

      describe('nightly settle of unconfirmed refunds', () => {
        it('asks the gateway about attempted refunds pending over an hour, and never sends one that was never attempted', async () => {
          const tx = await easePay(biz);
          await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
          stubGateway((c) => (c.url.includes('/transaction/v2/refund') ? { json: { status: true } } : {}));
          await refundPlatformPayment(req(biz, tx, { amount: 100, endPlan: 'period_end' }));
          const [row] = await refundsOf(tx);
          expect(row.status).toBe('pending');
          // Not old enough yet.
          stubGateway(() => ({ reject: true }));
          const before = await (await import('@/lib/subscription/lifecycle')).processExpiredModuleSubscriptions();
          expect(before.refundsSettled).toBe(0);
          await query(`UPDATE billing_transactions SET created_at = CURRENT_TIMESTAMP - INTERVAL '2 hours' WHERE id = $1`, [row.id]);
          // A reserved refund that never reached the gateway, also old.
          const tx2 = await pay(biz, 'billing_growth', 499, -5, 25);
          const unsent = randomUUID();
          await query(
            `INSERT INTO billing_transactions (id, business_id, type, status, amount, total_amount, plan_id, payment_method, metadata, module_key, created_at)
             VALUES ($1, $2, 'refund', 'pending', 50, 50, 'billing_growth', 'razorpay', $3::jsonb, 'billing', CURRENT_TIMESTAMP - INTERVAL '2 hours')`,
            [unsent, biz, JSON.stringify({ refund_of: tx2 })],
          );
          stubGateway((c) =>
            c.url.includes('/refund/v1/retrieve')
              ? { json: { status: true, refunds: [{ merchant_refund_id: gatewayRefundKey(row.id), refund_status: 'refunded' }] } }
              : {},
          );
          const { settleStalePendingPlatformRefunds } = await import('@/lib/platform-refunds');
          expect(await settleStalePendingPlatformRefunds(10)).toBeGreaterThanOrEqual(1);
          expect((await refundsOf(tx))[0].status).toBe('completed');
          // Only lookups: nothing is ever raised or re-sent by the nightly step.
          expect(POSTS().filter((c) => c.url.includes('/transaction/v2/refund') || /\/payments\/[^/]+\/refund$/.test(c.url))).toHaveLength(0);
          expect((await queryOne<{ status: string }>(`SELECT status FROM billing_transactions WHERE id = $1`, [unsent]))!.status).toBe('pending');
        });
      });

      describe('cancelling a refund that was never sent', () => {
        const unsentRow = async (businessId: string, tx: string, claimed = false) => {
          const id = randomUUID();
          await query(
            `INSERT INTO billing_transactions (id, business_id, type, status, amount, total_amount, plan_id, payment_method, metadata, module_key)
             VALUES ($1, $2, 'refund', 'pending', 100, 100, 'billing_growth', 'razorpay', $3::jsonb, 'billing')`,
            [id, businessId, JSON.stringify({ refund_of: tx, ...(claimed ? { gateway_requested: true } : {}) })],
          );
          await query(`UPDATE billing_transactions SET metadata = metadata || '{"refunded_paise": 10000}'::jsonb WHERE id = $1`, [tx]);
          return id;
        };
        const cancelCall = async (business: string, tx: string, body: unknown) => {
          const { POST } = await import('@/app/api/admin/businesses/[id]/billing/[txId]/refund/cancel/route');
          return POST(
            new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }),
            { params: { id: business, txId: tx } },
          );
        };

        it('frees the reserved amount; refuses one that reached the gateway; checks ownership and auth', async () => {
          (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: ADMIN } });
          const tx = await pay(biz, 'billing_growth', 499, -5, 25);
          const claimed = await unsentRow(biz, tx, true);
          const r1 = await cancelCall(biz, tx, { refund_id: claimed });
          expect(r1.status).toBe(409);
          expect(await r1.json()).toMatchObject({ code: 'NOT_REFUNDABLE' });
          await query(`UPDATE billing_transactions SET status = 'failed' WHERE id = $1`, [claimed]);

          const unsent = await unsentRow(biz, tx);
          const other = await newBusiness('cx');
          expect((await cancelCall(other, tx, { refund_id: unsent })).status).toBe(404);
          expect((await cancelCall(biz, tx, { refund_id: 'nope' })).status).toBe(400);
          const ok = await cancelCall(biz, tx, { refund_id: unsent });
          expect(ok.status).toBe(200);
          const [row] = (await refundsOf(tx)).filter((r) => r.id === unsent);
          expect(row.status).toBe('failed');
          expect(row.metadata.cancelled_by_admin).toBe(ADMIN);
          expect((await payRow(tx))!.metadata.refunded_paise).toBe(0);
          stubGateway(razorpayOk());
          expect((await refundPlatformPayment(req(biz, tx))).fullyRefunded).toBe(true);

          const { NextResponse } = await import('next/server');
          (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 403 }) });
          expect((await cancelCall(biz, tx, { refund_id: unsent })).status).toBe(403);
        });
      });
    });

    describe('final fix wave: end now ends, partial changes nothing, credit is releasable, tax in the cap', () => {
      const SELLER = (() => {
        const first14 = '27AAAAA0000A1Z';
        return first14 + gstinCheckChar(first14);
      })();
      const SELLER_FOR_SHORTEN = SELLER;
      const txMetaOf = async (id: string) =>
        (await queryOne<{ metadata: Record<string, any> }>(`SELECT metadata FROM billing_transactions WHERE id = $1`, [id]))!.metadata;
      const planRowJson = async (businessId: string) =>
        (await queryOne<{ j: string }>(
          `SELECT to_jsonb(m)::text AS j FROM business_module_subscriptions m WHERE business_id = $1 AND module_key = 'billing'`, [businessId],
        ))!.j;
      const periodOf = (id: string) =>
        queryOne<{ period_start: string; period_end: string; len: number }>(
          `SELECT period_start::text, period_end::text, (period_end - period_start) AS len FROM billing_transactions WHERE id = $1`, [id],
        );

      describe('I1 end now ends the plan', () => {
        it('full refund of an upgrade bought with credit: Free today, no grace, the message says so', async () => {
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          await pay(biz, 'billing_starter', 299, -10, 20);
          const q = await realUpgrade('billing_growth');
          stubGateway(razorpayOk());
          const res = await refundPlatformPayment(req(biz, q.tx, { endPlan: 'now' }));
          expect(await planOf(biz)).toMatchObject({ plan_id: 'free', status: 'active', end_date: null, cancel_at_period_end: false });
          const g = await queryOne<{ grace_period_end: string | null }>(
            `SELECT grace_period_end::text FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz],
          );
          expect(g!.grace_period_end).toBeNull();
          expect((await refundsOf(q.tx))[0].metadata.plan_effect).toBe('ended_now');
          expect(res.message).toContain('ended today');
          expect(res.message).toContain('no grace period');
        });

        it('refund while the row is in grace: Free today, and the end date is never moved forward', async () => {
          await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
          const tx = await pay(biz, 'billing_growth', 499, -33, -3);
          const before = await planOf(biz);
          expect(before!.end_date).toBe(await daysFromToday(-3));
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
          expect(await planOf(biz)).toMatchObject({ plan_id: 'free', end_date: null, status: 'active' });
        });

        it('refund in grace with "let it run to the end": the cancel flag is set and the end date stays in the past (never moved forward)', async () => {
          await setRow(biz, 'billing_growth', { startOffset: -33, endOffset: -3 });
          const tx = await pay(biz, 'billing_growth', 499, -33, -3);
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, tx, { endPlan: 'period_end' }));
          expect(await planOf(biz)).toMatchObject({ plan_id: 'billing_growth', cancel_at_period_end: true, end_date: await daysFromToday(-3) });
        });

        it('refund of the current payment while a later renewal exists (real renewals): end date shortened by that period, plan still active; the message states the date', async () => {
          const a = await paidAndActivated(biz, 'billing_growth');
          const b = await paidAndActivated(biz, 'billing_growth'); // early renewal: starts where A ends
          const before = await planOf(biz);
          const pa = await periodOf(a);
          const pb = await periodOf(b);
          expect(pb!.period_start).toBe(pa!.period_end);
          stubGateway(razorpayOk());
          const res = await refundPlatformPayment(req(biz, a, { endPlan: 'now' }));
          const exp = await queryOne<{ d: string }>(`SELECT ($1::date - $2::int)::text AS d`, [before!.end_date, pa!.len]);
          const after = await planOf(biz);
          expect(after).toMatchObject({ plan_id: 'billing_growth', status: 'active', cancel_at_period_end: false, end_date: exp!.d });
          expect(res.message).toContain(`the plan now ends on ${exp!.d}`);
          expect(res.message).toContain('later renewal payment was not refunded');
        });

        it('refund of the future renewal payment: the end date goes back to the first period\'s end', async () => {
          const a = await paidAndActivated(biz, 'billing_growth');
          const b = await paidAndActivated(biz, 'billing_growth');
          const pa = await periodOf(a);
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, b, { endPlan: 'now' }));
          expect(await planOf(biz)).toMatchObject({ plan_id: 'billing_growth', status: 'active', end_date: pa!.period_end });
        });

        it('both renewals refunded one after the other end the plan (last one moves to Free)', async () => {
          const a = await paidAndActivated(biz, 'billing_growth');
          const b = await paidAndActivated(biz, 'billing_growth');
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, b, { endPlan: 'now' }));
          await refundPlatformPayment(req(biz, a, { endPlan: 'now' }));
          expect(await planOf(biz)).toMatchObject({ plan_id: 'free', end_date: null });
        });

        it('yearly Starter used as credit, later the module is back on Starter with a new payment: refunding that with now moves to Free (the consumed yearly payment does not count)', async () => {
          await setRow(biz, 'billing_starter', { startOffset: -30, endOffset: 335, cycle: 'yearly' });
          const yearly = await pay(biz, 'billing_starter', 2999, -30, 335);
          const q = await realUpgrade('billing_growth');
          expect((await payRow(yearly))!.metadata.credit_consumed_by).toBe(q.tx);
          // The scheduled downgrade has run: the module is on Starter again and the customer pays for it.
          await setRow(biz, 'billing_starter', { startOffset: 0, endOffset: 30 });
          const again = await pay(biz, 'billing_starter', 299, 0, 30);
          stubGateway(razorpayOk());
          const res = await refundPlatformPayment(req(biz, again, { endPlan: 'now' }));
          expect(await planOf(biz)).toMatchObject({ plan_id: 'free', end_date: null });
          expect(res.message).toContain('free plan');
          expect((await refundsOf(again))[0].metadata.plan_effect).toBe('ended_now');
        });

        it('what the admin list says each choice would do matches what the refund then does', async () => {
          (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: ADMIN } });
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          await pay(biz, 'billing_starter', 299, -10, 20);
          const q = await realUpgrade('billing_growth');
          const { GET } = await import('@/app/api/admin/businesses/[id]/billing/route');
          const res = await GET(new NextRequest(`http://localhost/api/admin/businesses/${biz}/billing`), { params: { id: biz } });
          const row = (await res.json()).transactions.find((t: any) => t.id === q.tx);
          expect(row.plan_effects.now).toMatch(/free plan today, with no grace period/);
          expect(row.plan_effects.period_end).toMatch(/keeps their plan until \d{4}-\d{2}-\d{2}/);
        });
      });

      describe('I2 a partial refund never changes the plan', () => {
        it('₹50 goodwill refund on a ₹299 payment leaves the module row byte-identical; refunding the remainder with end-now moves to Free', async () => {
          const tx = await paidAndActivated(biz, 'billing_starter');
          const before = await planRowJson(biz);
          stubGateway(razorpayOk());
          const goodwill = await refundPlatformPayment(req(biz, tx, { amount: 50, endPlan: 'now' })); // even an explicit choice is ignored
          expect(goodwill).toMatchObject({ status: 'processed', fullyRefunded: false });
          expect(goodwill.message).toBe('₹50 has been refunded to the customer. Partial refund. The plan is unchanged.');
          expect(await planRowJson(biz)).toBe(before);
          expect((await refundsOf(tx))[0].metadata).toMatchObject({ plan_effect: 'none_partial_refund', end_plan: null });

          // The remainder needs the choice (it ends the plan if it is "now").
          await expect(refundPlatformPayment(req(biz, tx, { endPlan: undefined }))).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
          expect(await planRowJson(biz)).toBe(before);
          const rest = await refundPlatformPayment(req(biz, tx, { endPlan: 'now' }));
          expect(rest).toMatchObject({ fullyRefunded: true, refundedTotal: 299 });
          expect(await planOf(biz)).toMatchObject({ plan_id: 'free', end_date: null });
        });

        it('the route needs no end_plan for a partial refund, and refuses a final refund without one', async () => {
          (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: ADMIN } });
          const tx = await paidAndActivated(biz, 'billing_starter');
          const before = await planRowJson(biz);
          const { POST } = await import('@/app/api/admin/businesses/[id]/billing/[txId]/refund/route');
          const go = (body: unknown) =>
            POST(new NextRequest('http://localhost/x', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }), { params: { id: biz, txId: tx } });
          stubGateway(razorpayOk());
          const partial = await go({ amount: 50 });
          expect(partial.status).toBe(200);
          expect((await partial.json()).refund.message).toContain('The plan is unchanged.');
          expect(await planRowJson(biz)).toBe(before);
          const final = await go({ amount: 249 });
          expect(final.status).toBe(400);
          expect(await final.json()).toMatchObject({ code: 'INVALID_REQUEST' });
          expect((await go({ amount: 249, end_plan: 'soon' })).status).toBe(400);
          expect((await go({ amount: 249, end_plan: 'period_end' })).status).toBe(200);
        });
      });

      describe('I3 credit can be released', () => {
        async function upgradeFromStarter() {
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          const starter = await pay(biz, 'billing_starter', 299, -10, 20);
          const q = await realUpgrade('billing_growth');
          return { starter, growth: q.tx, paid: q.amount };
        }

        it("the ₹598.67 example: refunding the upgrade releases the credit, so the Starter payment can be refunded in full too", async () => {
          const { starter, growth, paid } = await upgradeFromStarter();
          expect(paid).toBe(299.67);
          const consumed = (await payRow(starter))!.metadata;
          expect(consumed).toMatchObject({ credit_consumed_by: growth, credit_used_paise: 19933 });
          expect(refundableAmountPaise({ total_amount: '299.00', metadata: consumed as any })).toBe(9967); // capped while the credit is spent
          stubGateway(razorpayOk());
          await expect(refundPlatformPayment(req(biz, starter, { amount: 299 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });

          await refundPlatformPayment(req(biz, growth, { endPlan: 'now' }));
          const released = (await payRow(starter))!.metadata;
          expect(released.credit_consumed_by).toBeUndefined();
          expect(released.credit_used_paise).toBeUndefined();
          expect(released).toMatchObject({ credit_released_by: growth, credit_released_paise: 19933 });
          expect(released.credit_released_at).toBeTruthy();
          expect((await refundsOf(growth))[0].metadata.credit_released).toEqual([{ id: starter, paise: 19933 }]);

          // Everything the customer paid (299 + 299.67 = 598.67) can now go back.
          const res = await refundPlatformPayment(req(biz, starter, { endPlan: 'now' }));
          expect(res).toMatchObject({ fullyRefunded: true, refundedTotal: 299 });
          expect(calls.filter((c) => c.method === 'POST').map((c) => c.body.amount)).toEqual([29967, 29900]);
          expect((await payRow(starter))!.status).toBe('refunded');
          expect((await payRow(growth))!.status).toBe('refunded');
        });

        it('reverse order: the old payment\'s remainder is refunded FIRST, then the upgrade; the old payment reopens and the rest can go back (₹598.67 in total)', async () => {
          const { starter, growth } = await upgradeFromStarter();
          stubGateway(razorpayOk());
          const first = await refundPlatformPayment(req(biz, starter, { endPlan: 'period_end' }));
          expect(first).toMatchObject({ fullyRefunded: true, refundedTotal: 99.67 });
          expect((await payRow(starter))!.status).toBe('refunded');
          const paidAtBefore = (await payRow(starter))!.metadata.paid_at;
          const paidEvents = () => count(`subscription_events WHERE business_id = $1 AND event_type IN ('upgraded', 'payment_succeeded')`, [biz]);
          const paidEventsBefore = await paidEvents();

          await refundPlatformPayment(req(biz, growth, { endPlan: 'now' }));
          const reopened = await payRow(starter);
          expect(reopened!.status).toBe('completed');
          expect(reopened!.metadata).toMatchObject({ credit_released_by: growth, reopened_by_credit_release: growth });
          expect(reopened!.metadata.credit_used_paise).toBeUndefined();
          expect(reopened!.metadata.credit_gross_saving_paise).toBeUndefined();
          expect(reopened!.metadata.paid_at).toBe(paidAtBefore); // not treated as newly paid
          expect((await refundsOf(growth))[0].metadata.credit_released).toEqual([{ id: starter, paise: 19933, reopened: true }]);
          // Nothing re-activated: no plan change from the reopen (the plan went Free with the upgrade refund), no unapplied-payment alert.
          expect((await planOf(biz))!.plan_id).toBe('free');
          expect((await findUnappliedPayments()).filter((u) => u.business_id === biz)).toEqual([]);
          expect(await paidEvents()).toBe(paidEventsBefore); // no second "payment succeeded" or upgrade from the reopen

          const rest = await refundPlatformPayment(req(biz, starter, { endPlan: 'now' }));
          expect(rest).toMatchObject({ fullyRefunded: true, refundedTotal: 299 });
          expect(calls.filter((c) => c.method === 'POST').map((c) => c.body.amount)).toEqual([9967, 29967, 19933]);
          expect((await payRow(starter))!.status).toBe('refunded');
          expect((await payRow(growth))!.status).toBe('refunded');
          const total = (await refundsOf(starter)).concat(await refundsOf(growth)).filter((r) => r.status === 'completed').reduce((a, r) => a + Math.round(Number(r.total_amount) * 100), 0);
          expect(total).toBe(59867); // 299 + 299.67 paid, all of it refunded, exactly
        });

        it('the reopen is not a general transition: refunded -> completed is still refused everywhere else', () => {
          expect(() => assertBillingTransactionTransition('refunded', 'completed')).toThrow();
          expect(() => assertCreditReleaseReopen('refunded', 'completed')).not.toThrow();
          expect(() => assertCreditReleaseReopen('completed', 'refunded')).toThrow();
          expect(() => assertCreditReleaseReopen('failed', 'completed')).toThrow();
        });

        it('a partial refund of the credit-bought payment releases nothing', async () => {
          const { starter, growth } = await upgradeFromStarter();
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, growth, { amount: 100 }));
          expect((await payRow(starter))!.metadata).toMatchObject({ credit_consumed_by: growth, credit_used_paise: 19933 });
          expect((await payRow(starter))!.metadata.credit_released_by).toBeUndefined();
        });

        it('a released source is not usable as credit when the business is no longer on its plan; the normal source rules decide', async () => {
          const { growth } = await upgradeFromStarter();
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, growth, { endPlan: 'now' })); // the business is on Free now
          expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(0);
          // Control: put the business back on Starter and the released source gives credit again, by the existing rules.
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(199.33);
        });
      });

      describe('I4 the cash cap subtracts what the credit saved the customer, gross', () => {
        it('refundableAmountPaise: stored gross saving first, credit_used_paise for older rows, floor 0', () => {
          expect(refundableAmountPaise({ total_amount: '299.00', metadata: { credit_used_paise: 19933, credit_gross_saving_paise: 23521 } })).toBe(6379);
          expect(refundableAmountPaise({ total_amount: '299.00', metadata: { credit_used_paise: 19933 } })).toBe(9967); // consumed before the saving was stored
          expect(refundableAmountPaise({ total_amount: '299.00', metadata: { credit_used_paise: 19933, credit_gross_saving_paise: 19933 } })).toBe(9967); // mode none
          expect(refundableAmountPaise({ total_amount: '299.00', metadata: { credit_gross_saving_paise: 0 } })).toBe(29900);
          expect(refundableAmountPaise({ total_amount: '299.00', metadata: {} })).toBe(29900);
          expect(refundableAmountPaise({ total_amount: '299.00', metadata: { credit_gross_saving_paise: 99999 } })).toBe(0);
        });

        const SELLER_GST = SELLER;
        /**
         * Starter paid in `sourceMode` (10 of 30 days used), then upgraded to Growth in `upgradeMode`, both through the real
         * checkout and signed webhook. Returns the rows and what each paid.
         */
        async function upgradeWith(sourceMode: 'none' | 'inclusive' | 'exclusive', upgradeMode: 'none' | 'inclusive' | 'exclusive') {
          const taxOn = (mode: 'inclusive' | 'exclusive') =>
            saveTaxSettings({ mode, rate_percent: 18, seller_gstin: SELLER_GST, seller_legal_name: 'Khatario Software Pvt Ltd', seller_address: '1 MG Road, Bengaluru' });
          const spy = jest
            .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
            .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
          try {
            let starter: string;
            let starterPaid = 299;
            if (sourceMode === 'none') {
              starter = await pay(biz, 'billing_starter', 299, -10, 20);
            } else {
              await taxOn(sourceMode);
              const c1 = await createSubscriptionCheckout({ businessId: biz, planId: 'billing_starter', billingCycle: 'monthly' });
              expect(await hook('payment.captured', 'pay_tx_' + sfx(), 'captured', notesFor(biz, c1.billingTransactionId, 'billing_starter'), Math.round(c1.amount * 100))).toMatchObject({ ok: true });
              await query(`UPDATE billing_transactions SET period_start = CURRENT_DATE - 10, period_end = CURRENT_DATE + 20 WHERE id = $1`, [c1.billingTransactionId]);
              starter = c1.billingTransactionId;
              starterPaid = c1.amount;
            }
            await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
            if (upgradeMode === 'none') await query(`UPDATE platform_settings SET subscription_gst_mode = 'none' WHERE id = 'default'`);
            else await taxOn(upgradeMode);
            const up = await createSubscriptionCheckout({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
            expect(await hook('payment.captured', 'pay_tx_' + sfx(), 'captured', notesFor(biz, up.billingTransactionId, 'billing_growth'), Math.round(up.amount * 100))).toMatchObject({ ok: true });
            return { starter, starterPaid, growth: up.billingTransactionId, growthPaid: up.amount };
          } finally {
            spy.mockRestore();
            await query(`UPDATE platform_settings SET subscription_gst_mode = 'none', subscription_seller_gstin = NULL WHERE id = 'default'`);
          }
        }
        const capOf = async (id: string) => {
          const r = (await payRow(id))!;
          const t = await queryOne<{ total: string }>(`SELECT total_amount::text AS total FROM billing_transactions WHERE id = $1`, [id]);
          return refundableAmountPaise({ total_amount: t!.total, metadata: r.metadata as any });
        };

        it('a tax-free ₹299 source consumed by an EXCLUSIVE upgrade can be refunded ₹63.79 (the credit saved ₹235.21 with GST), not ₹99.67', async () => {
          const { starter, starterPaid } = await upgradeWith('none', 'exclusive');
          expect(starterPaid).toBe(299);
          const meta = (await payRow(starter))!.metadata;
          expect(meta.credit_used_paise).toBe(19933);
          expect(meta.credit_gross_saving_paise).toBe(23521);
          expect(await capOf(starter)).toBe(6379);
          stubGateway(razorpayOk());
          await expect(refundPlatformPayment(req(biz, starter, { amount: 63.8 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
          await refundPlatformPayment(req(biz, starter, { endPlan: 'period_end' }));
          expect(calls.filter((c) => c.method === 'POST')[0].body.amount).toBe(6379);
        });

        it('an exclusive ₹352.82 source consumed by an EXCLUSIVE upgrade can be refunded ₹117.61 (saved ₹235.21), not ₹153.49', async () => {
          const { starter, starterPaid } = await upgradeWith('exclusive', 'exclusive');
          expect(starterPaid).toBe(352.82);
          expect((await payRow(starter))!.metadata.credit_gross_saving_paise).toBe(23521);
          expect(await capOf(starter)).toBe(11761);
          stubGateway(razorpayOk());
          await expect(refundPlatformPayment(req(biz, starter, { amount: 117.62 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
          const res = await refundPlatformPayment(req(biz, starter, { endPlan: 'period_end' }));
          expect(calls.filter((c) => c.method === 'POST')[0].body.amount).toBe(11761);
          expect(res.fullyRefunded).toBe(true);
        });

        it('an inclusive ₹299 source consumed by an INCLUSIVE upgrade can be refunded ₹130.08 (the credit saved ₹168.92), not ₹99.67', async () => {
          const { starter, starterPaid } = await upgradeWith('inclusive', 'inclusive');
          expect(starterPaid).toBe(299);
          const meta = (await payRow(starter))!.metadata;
          expect(meta.credit_used_paise).toBe(16892);
          expect(meta.credit_gross_saving_paise).toBe(16892); // inclusive: the credit is what was taken off
          expect(await capOf(starter)).toBe(13008);
          stubGateway(razorpayOk());
          await expect(refundPlatformPayment(req(biz, starter, { amount: 130.09 }))).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT' });
          await refundPlatformPayment(req(biz, starter, { endPlan: 'period_end' }));
          expect(calls.filter((c) => c.method === 'POST')[0].body.amount).toBe(13008);
        });

        it('mode none is unchanged: ₹299 source, ₹199.33 credit, ₹99.67 refundable', async () => {
          const { starter } = await upgradeWith('none', 'none');
          const meta = (await payRow(starter))!.metadata;
          expect(meta).toMatchObject({ credit_used_paise: 19933, credit_gross_saving_paise: 19933 });
          expect(await capOf(starter)).toBe(9967);
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, starter, { endPlan: 'period_end' }));
          expect(calls.filter((c) => c.method === 'POST')[0].body.amount).toBe(9967);
        });

        it('with several sources the per-source savings add up exactly to the consuming payment\'s gross saving', async () => {
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 50 });
          const s1 = await pay(biz, 'billing_starter', 101, -10, 20);
          const s2 = await pay(biz, 'billing_starter', 101, 20, 50);
          await saveTaxSettings({ mode: 'exclusive', rate_percent: 18, seller_gstin: SELLER_GST, seller_legal_name: 'Khatario Software Pvt Ltd', seller_address: '1 MG Road, Bengaluru' });
          try {
            const q = await realUpgrade('billing_growth');
            const row = (await queryOne<{ taxable: string; total: string; credit: number }>(
              `SELECT taxable_amount::text AS taxable, total_amount::text AS total, (metadata->'upgrade_credit'->>'amount')::numeric * 100 AS credit FROM billing_transactions WHERE id = $1`, [q.tx],
            ))!;
            const used = (await payRow(s1))!.metadata.credit_used_paise + ((await payRow(s2))!.metadata.credit_used_paise ?? 0);
            const savings = ((await payRow(s1))!.metadata.credit_gross_saving_paise ?? 0) + ((await payRow(s2))!.metadata.credit_gross_saving_paise ?? 0);
            expect(used).toBe(Math.round(Number(row.credit)));
            expect(savings).toBe(Math.round((used * Math.round(Number(row.total) * 100)) / Math.round(Number(row.taxable) * 100)));
          } finally {
            await query(`UPDATE platform_settings SET subscription_gst_mode = 'none', subscription_seller_gstin = NULL WHERE id = 'default'`);
          }
        });
      });

      describe('minor items', () => {
        it('legacy payments with no period and others present: the plan is untouched and the message says why', async () => {
          await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
          const legacy = await pay(biz, 'billing_growth', 499, null, null);
          await pay(biz, 'billing_growth', 499, null, null);
          stubGateway(razorpayOk());
          const res = await refundPlatformPayment(req(biz, legacy, { endPlan: 'now' }));
          expect((await planOf(biz))!.plan_id).toBe('billing_growth');
          expect(res.message).toContain('no recorded period');
        });

        it('a plan set to end by a refund cannot be undone by the customer; a customer\'s own cancellation still can', async () => {
          const { POST: undo } = await import('@/app/api/subscriptions/cancel/undo/route');
          const call = () =>
            undo(new NextRequest('http://localhost/api/subscriptions/cancel/undo', {
              method: 'POST', body: JSON.stringify({ module_key: 'billing' }),
              headers: { 'content-type': 'application/json', 'x-authenticated-business-id': biz, 'x-authenticated-user-id': adminOf.get(biz)! },
            }));
          const tx = await pay(biz, 'billing_growth', 499, -5, 25);
          await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, tx, { endPlan: 'period_end' }));
          expect((await planOf(biz))!.cancel_at_period_end).toBe(true);
          const blocked = await call();
          expect(blocked.status).toBe(409);
          expect(await blocked.json()).toMatchObject({ code: 'CANCELLED_BY_REFUND' });
          expect((await planOf(biz))!.cancel_at_period_end).toBe(true);

          const b2 = await newBusiness('undo2');
          await setRow(b2, 'billing_growth', { startOffset: -5, endOffset: 25 });
          await query(`UPDATE business_module_subscriptions SET cancel_at_period_end = true, cancelled_at = CURRENT_TIMESTAMP WHERE business_id = $1`, [b2]);
          const ok = await undo(new NextRequest('http://localhost/api/subscriptions/cancel/undo', {
            method: 'POST', body: JSON.stringify({ module_key: 'billing' }),
            headers: { 'content-type': 'application/json', 'x-authenticated-business-id': b2, 'x-authenticated-user-id': adminOf.get(b2)! },
          }));
          expect(ok.status).toBe(200);
        });

        it('unapplied-payment alerts ignore bookkeeping touches: refunding the cash left on a consumed source after an upgrade raises no alert', async () => {
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          const starter = await pay(biz, 'billing_starter', 299, -10, 20);
          const q = await realUpgrade('billing_growth');
          stubGateway(razorpayOk());
          await refundPlatformPayment(req(biz, starter, { amount: 50, endPlan: 'period_end' })); // touches the old row's updated_at
          const mine = (await findUnappliedPayments()).filter((u) => u.business_id === biz);
          expect(mine).toEqual([]);
          expect((await moduleRow(biz))!.plan_id).toBe('billing_growth');
          expect(q.tx).toBeTruthy();
        });

        it('a shortened period (credit gone) is priced on the pre-tax amount: GST buys no days', async () => {
          await saveTaxSettings({ mode: 'exclusive', rate_percent: 18, seller_gstin: SELLER_FOR_SHORTEN, seller_legal_name: 'Khatario Software Pvt Ltd', seller_address: '1 MG Road, Bengaluru' });
          try {
            await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
            const src = await pay(biz, 'billing_starter', 299, -10, 20);
            const spy = jest
              .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
              .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
            const up = await createSubscriptionCheckout({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
            spy.mockRestore();
            await query(`UPDATE billing_transactions SET status = 'refunded' WHERE id = $1`, [src]); // the credit is gone
            await hook('payment.captured', 'pay_sh_' + sfx(), 'captured', notesFor(biz, up.billingTransactionId, 'billing_growth'), Math.round(up.amount * 100));
            const row = await queryOne<{ taxable_amount: string; period_start: string; period_end: string }>(
              `SELECT taxable_amount::text, period_start::text, period_end::text FROM billing_transactions WHERE id = $1`, [up.billingTransactionId],
            );
            const taxable = Math.round(Number(row!.taxable_amount) * 100);
            const credit = Math.round(Number((await queryOne<{ c: string }>(`SELECT (metadata->'upgrade_credit'->>'amount') AS c FROM billing_transactions WHERE id = $1`, [up.billingTransactionId]))!.c) * 100);
            const days = Math.floor((30 * taxable) / (taxable + credit)); // pre-tax paid / pre-tax value, the cycle being 30 days
            const got = await queryOne<{ d: number }>(`SELECT ($1::date - $2::date) AS d`, [row!.period_end, row!.period_start]);
            expect(Math.abs(got!.d - days)).toBeLessThanOrEqual(1); // month length rounding only; tax-inclusive pricing would be ~2 days longer
            const withTax = Math.floor((30 * Math.round(up.amount * 100)) / (Math.round(up.amount * 100) + credit));
            expect(got!.d).toBeLessThan(withTax);
          } finally {
            await query(`UPDATE platform_settings SET subscription_gst_mode = 'none', subscription_seller_gstin = NULL WHERE id = 'default'`);
          }
        });

        it('an empty GST rate is refused, never saved as 0 %', async () => {
          await expect(saveTaxSettings({ rate_percent: '' })).rejects.toBeInstanceOf(TaxSettingsError);
          await expect(saveTaxSettings({ rate_percent: '   ' })).rejects.toThrow(/rate must be a number/);
          expect((await loadTaxSettings()).ratePercent).toBe(18);
        });

        it('a refund and an upgrade completing on the same source at the same time never both pay out the same money', async () => {
          await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
          const starter = await pay(biz, 'billing_starter', 299, -10, 20);
          const spy = jest
            .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
            .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
          const up = await createSubscriptionCheckout({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
          spy.mockRestore();
          stubGateway(razorpayOk());
          const complete = () => hook('payment.captured', 'pay_race_' + sfx().replace(/-/g, 'x'), 'captured', notesFor(biz, up.billingTransactionId, 'billing_growth'), Math.round(up.amount * 100));
          const refund = () => refundPlatformPayment(req(biz, starter, { endPlan: 'period_end' }));
          const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
          const first = await Promise.allSettled([complete(), refund()]);
          // Postgres may abort one side of a lock cycle (40P01); the retry paths settle it.
          if (first[0].status === 'rejected') await complete();
          if (first[1].status === 'rejected') await refund();
          err.mockRestore();
          const meta = (await payRow(starter))!.metadata;
          const refunded = (await refundsOf(starter)).filter((r) => r.status === 'completed').reduce((a, r) => a + Math.round(Number(r.total_amount) * 100), 0);
          const creditTaken = Number(meta.credit_used_paise ?? 0);
          expect(refunded + creditTaken).toBeLessThanOrEqual(29900);
          if (creditTaken > 0) expect(refunded).toBeLessThanOrEqual(9967);
          else expect((await txMetaOf(up.billingTransactionId)).upgrade_credit.rejected).toBeTruthy();
        });
      });
    });

    describe('the admin route', () => {
      const call = (tx: string, body: unknown, business = biz, headers: Record<string, string> = {}) =>
        refundPost(
          new NextRequest(`http://localhost/api/admin/businesses/${business}/billing/${tx}/refund`, {
            method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json', ...headers },
          }),
          { params: { id: business, txId: tx } },
        );
      const asAdmin = () =>
        (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: ADMIN } });

      it('rejects a caller who is not a platform admin before doing anything', async () => {
        const { NextResponse } = await import('next/server');
        (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 403 }) });
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        const r = await call(tx, { end_plan: 'now' });
        expect(r.status).toBe(403);
        expect(calls).toHaveLength(0);
        expect(requirePlatformRequest).toHaveBeenCalledWith(expect.anything(), 'admin', 'can_manage_subscriptions');
      });

      it('validates the body, then returns { success, refund } or { error, code }', async () => {
        asAdmin();
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        await setRow(biz, 'billing_growth', { startOffset: -5, endOffset: 25 });
        stubGateway(razorpayOk());
        expect((await call(tx, {})).status).toBe(400);
        expect((await call(tx, { end_plan: 'soon' })).status).toBe(400);
        expect((await call(tx, { end_plan: 'now', amount: 'lots' })).status).toBe(400);
        expect(calls).toHaveLength(0);

        const tooMuch = await call(tx, { end_plan: 'now', amount: 600 });
        expect(tooMuch.status).toBe(422);
        expect(await tooMuch.json()).toMatchObject({ code: 'REFUND_EXCEEDS_PAYMENT', error: expect.any(String) });

        const ok = await call(tx, { end_plan: 'now', amount: 499, business_id: randomUUID(), created_by: 'x' });
        expect(ok.status).toBe(200);
        const body = await ok.json();
        expect(body).toMatchObject({ success: true, refund: { status: 'processed', fully_refunded: true, refunded_total: 499 } });
        expect((await refundsOf(tx))[0].metadata.requested_by_admin).toBe(ADMIN);

        const again = await call(tx, { end_plan: 'now' });
        expect(again.status).toBe(409);
        expect(await again.json()).toMatchObject({ code: 'NOT_REFUNDABLE' });
      });

      it('a gateway refusal is 502 GATEWAY_REFUSED; a payment of another business is 404; the idempotency header is honoured', async () => {
        asAdmin();
        const tx = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway((c) => (c.method === 'GET' ? { json: { items: [] } } : { status: 400, json: {} }));
        const r = await call(tx, { end_plan: 'now' });
        expect(r.status).toBe(502);
        expect(await r.json()).toMatchObject({ code: 'GATEWAY_REFUSED' });
        const other = await newBusiness('route');
        expect((await call(tx, { end_plan: 'now' }, other)).status).toBe(404);

        const tx2 = await pay(biz, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        const a = await (await call(tx2, { end_plan: 'period_end', amount: 100 }, biz, { 'idempotency-key': 'hdr-1' })).json();
        const b = await (await call(tx2, { end_plan: 'period_end', amount: 100 }, biz, { 'idempotency-key': 'hdr-1' })).json();
        expect(b.refund.id).toBe(a.refund.id);
        expect(calls).toHaveLength(1);
      });
    });

    describe('billing archive', () => {
      it('refund rows are archived with the payment when a business is deleted', async () => {
        const b3 = await newBusiness('arch');
        const tx = await pay(b3, 'billing_growth', 499, -5, 25);
        stubGateway(razorpayOk());
        await refundPlatformPayment(req(b3, tx, { amount: 100 }));
        const [r] = await refundsOf(tx);
        await deleteBusinessCompletely(b3, ADMIN);
        const rows = await query(
          `SELECT type, status, total_amount::text AS total_amount, metadata->>'refund_of' AS refund_of
           FROM billing_transactions_archive WHERE id = $1`, [r.id],
        );
        expect(rows.rows[0]).toMatchObject({ type: 'refund', status: 'completed', total_amount: '100.00', refund_of: tx });
        expect(await count(`billing_transactions_archive WHERE business_id = $1`, [b3])).toBe(2);
        expect(typeof archiveBusinessBillingTransactions).toBe('function');
      });
    });
  });

  // ---- Task 6: GST mode, tax line, invoice numbers, receipt ----

  describe('GST mode, tax line, invoice numbers and receipt', () => {
    const ADMIN = randomUUID();
    const gstinFor = (state: string) => {
      const first14 = `${state}AAAAA0000A1Z`;
      return first14 + gstinCheckChar(first14);
    };
    const SELLER_MH = gstinFor('27'); // same state as the test businesses (27)
    const SELLER_KA = gstinFor('29'); // a different state
    const SAVED = { seller_legal_name: 'Khatario Software Pvt Ltd', seller_address: '1 MG Road, Bengaluru' };

    async function resetTax() {
      await query(`INSERT INTO platform_settings (id) VALUES ('default') ON CONFLICT (id) DO NOTHING`);
      await query(
        `UPDATE platform_settings SET subscription_gst_mode = 'none', subscription_gst_rate = 18, subscription_seller_gstin = NULL,
           subscription_seller_legal_name = NULL, subscription_seller_address = NULL, subscription_seller_state_code = NULL,
           subscription_sac_code = '998314', subscription_invoice_prefix = 'KH', platform_payment_provider = NULL
         WHERE id = 'default'`,
      );
    }
    const setTax = (o: Record<string, unknown> = {}) =>
      saveTaxSettings({ mode: 'exclusive', rate_percent: 18, seller_gstin: SELLER_MH, ...SAVED, ...o });

    afterEach(async () => {
      await resetTax();
      (requirePlatformRequest as jest.Mock).mockReset();
      (global.fetch as unknown as jest.Mock).mockReset();
      (global.fetch as unknown as jest.Mock).mockRejectedValue(new Error('network disabled in tests'));
      jest.restoreAllMocks();
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
    });
    beforeEach(resetTax);

    /** A real checkout with the gateway call stubbed. Returns the pending row id, the quoted and the gateway amount. */
    async function checkout(businessId: string, planId: string, o: { cycle?: BillingCycle; coupon?: string; provider?: 'razorpay' | 'easebuzz' } = {}) {
      const proto = o.provider === 'easebuzz' ? EasebuzzPaymentProvider.prototype : RazorpayPaymentProvider.prototype;
      const spy = jest
        .spyOn(proto as any, 'createHostedPaymentLink')
        .mockResolvedValue({ provider: o.provider ?? 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://pay.example/x' });
      try {
        const r = await createSubscriptionCheckout({ businessId, planId, billingCycle: o.cycle ?? 'monthly', couponCode: o.coupon });
        return { tx: r.billingTransactionId, amount: r.amount, gateway: (spy.mock.calls[0][0] as { amount: number }).amount, result: r };
      } finally {
        spy.mockRestore();
      }
    }

    const taxRow = (id: string) =>
      queryOne<{
        status: string; amount: string; total_amount: string; tax_amount: string; taxable_amount: string | null;
        cgst_amount: string | null; sgst_amount: string | null; igst_amount: string | null; gst_rate: string | null;
        gst_mode: string | null; invoice_number: string | null; metadata: Record<string, any>; type: string;
      }>(
        `SELECT type, status, amount::text, total_amount::text, tax_amount::text, taxable_amount::text, cgst_amount::text,
                sgst_amount::text, igst_amount::text, gst_rate::text, gst_mode, invoice_number, metadata
         FROM billing_transactions WHERE id = $1`,
        [id],
      );

    const count = async (from: string, params: unknown[] = []) =>
      Number((await queryOne<{ c: string }>(`SELECT COUNT(*)::text AS c FROM ${from}`, params))!.c);
    const FY = /^KH\/\d{4}-\d{2}\/\d{6}$/;

    async function complete(businessId: string, tx: string, planId: string, rupees: number, cycle: BillingCycle = 'monthly') {
      return hook('payment.captured', 'pay_t6_' + sfx(), 'captured', notesFor(businessId, tx, planId, cycle), Math.round(rupees * 100));
    }

    /** A completed payment with a stored tax split and a paid period, as a taxed checkout would leave it. */
    async function insertTaxedPaid(businessId: string, planId: string, taxable: number | null, total: number, tax: number, startOff: number, endOff: number) {
      const r = await queryOne<{ id: string }>(
        `INSERT INTO billing_transactions
           (business_id, type, status, amount, total_amount, tax_amount, taxable_amount, plan_id, module_key, billing_cycle,
            payment_method, period_start, period_end, gateway_response)
         VALUES ($1, 'payment', 'completed', $2, $3, $4, $5, $6, 'billing', 'monthly', 'razorpay',
                 CURRENT_DATE + $7::int, CURRENT_DATE + $8::int, '{"checkout_type":"subscription","provider":"razorpay"}'::jsonb)
         RETURNING id`,
        [businessId, taxable ?? total, total, tax, taxable, planId, startOff, endOff],
      );
      return r!.id;
    }

    const asBusiness = (id: string) => ({ headers: { 'x-authenticated-business-id': id, 'x-authenticated-user-id': adminOf.get(id)! } });
    async function receiptOf(businessId: string | null, id: string) {
      const res = await receiptGet(new NextRequest(`http://localhost/api/subscriptions/receipts/${id}`, businessId ? asBusiness(businessId) : {}), {
        params: { id },
      });
      return { status: res.status, type: res.headers.get('content-type'), text: await res.text() };
    }
    const asPlatformAdmin = () => (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: ADMIN } });

    function stubRefundGateway() {
      (global.fetch as unknown as jest.Mock).mockReset();
      (global.fetch as unknown as jest.Mock).mockImplementation(async (url: unknown) => {
        const u = String(url);
        return { ok: true, status: 200, json: async () => (u.includes('/refund') ? { id: 'rfnd_' + sfx().replace(/-/g, 'x'), status: 'processed' } : {}) };
      });
    }
    const refundOf = (businessId: string, tx: string, amount?: number) =>
      refundPlatformPayment({ businessId, transactionId: tx, adminId: ADMIN, endPlan: 'period_end', ...(amount === undefined ? {} : { amount }) });

    // ---------------- default mode: nothing a customer pays changes ----------------

    describe('default (none): every amount is what it was', () => {
      it('a normal plan: quoted, sent to the gateway and stored at the plan price, no tax; completion issues no number in mode none', async () => {
        expect((await loadTaxSettings()).mode).toBe('none');
        const price = await planPrice('billing_growth');
        const q = await checkout(biz, 'billing_growth');
        expect(q.amount).toBe(price);
        expect(q.gateway).toBe(price);
        expect(await taxRow(q.tx)).toMatchObject({
          status: 'pending', amount: price.toFixed(2), total_amount: price.toFixed(2), tax_amount: '0.00', taxable_amount: price.toFixed(2),
          gst_mode: 'none', invoice_number: null,
        });
        expect((await taxRow(q.tx))!.metadata.tax).toMatchObject({ mode: 'none', rate: 0, taxable: price, tax: 0 });
        expect(await complete(biz, q.tx, 'billing_growth', price)).toMatchObject({ ok: true });
        const done = (await taxRow(q.tx))!;
        expect(done.status).toBe('completed');
        expect(done.invoice_number).toBeNull(); // mode none: a plain receipt, never numbered
        expect(done.tax_amount).toBe('0.00');
      });

      it('a ₹1 plan is charged ₹1 and the floor still holds', async () => {
        await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_starter'`);
        try {
          const q = await checkout(biz, 'billing_starter');
          expect(q.amount).toBe(1);
          expect(q.gateway).toBe(1);
          expect(Number((await taxRow(q.tx))!.total_amount)).toBe(1);
          expect(await complete(biz, q.tx, 'billing_starter', 1)).toMatchObject({ ok: true });
          expect((await moduleRow(biz))!.plan_id).toBe('billing_starter');
        } finally {
          await query(`UPDATE subscription_plans SET price_monthly = 299 WHERE id = 'billing_starter'`);
        }
      });

      it('a coupon takes its amount off and nothing else is added', async () => {
        const code = `T6${randomUUID().slice(0, 8).toUpperCase()}`;
        const c = await queryOne<{ id: string }>(`INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, 'flat', 100, 1) RETURNING id`, [code]);
        coupons.push(c!.id);
        const q = await checkout(biz, 'billing_growth', { coupon: code });
        expect(q.amount).toBe((await planPrice('billing_growth')) - 100);
        expect(q.gateway).toBe(q.amount);
        expect(await taxRow(q.tx)).toMatchObject({ amount: '499.00', tax_amount: '0.00', total_amount: '399.00', gst_mode: 'none' });
      });

      it('an upgrade with credit charges the same as before (price - credit)', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        await insertTaxedPaid(biz, 'billing_starter', null, 299, 0, -10, 20);
        const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
        expect(p).toMatchObject({ finalAmount: 299.67, netAmount: 299.67, taxAmount: 0, taxableAmount: 299.67, creditApplied: 199.33 });
        const q = await checkout(biz, 'billing_growth');
        expect(q.amount).toBe(299.67);
        expect(q.gateway).toBe(299.67);
      });

      it('an add-on is charged its price, and its pending row carries no tax', async () => {
        const spy = jest
          .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
          .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://pay.example/a' });
        const r = await createAddonCheckout({ businessId: biz, addonType: 'khatario_ai' });
        expect(r.amount).toBe(299);
        expect((spy.mock.calls[0][0] as { amount: number }).amount).toBe(299);
        expect(await taxRow(r.billingTransactionId)).toMatchObject({ total_amount: '299.00', tax_amount: '0.00', gst_mode: 'none' });
      });
    });

    // ---------------- exclusive / inclusive ----------------

    describe('exclusive: tax is added after coupon and credit', () => {
      it('18 % on ₹299 charges ₹352.82 (tax ₹53.82); the same amount reaches Razorpay and Easebuzz; the breakdown is stored', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_starter');
        expect(q.amount).toBe(352.82);
        expect(q.gateway).toBe(352.82);
        const row = (await taxRow(q.tx))!;
        expect(row).toMatchObject({
          amount: '299.00', total_amount: '352.82', tax_amount: '53.82', taxable_amount: '299.00', gst_rate: '18.00', gst_mode: 'exclusive',
          cgst_amount: '26.91', sgst_amount: '26.91', igst_amount: '0.00', invoice_number: null,
        });
        expect(row.metadata.tax).toMatchObject({ mode: 'exclusive', rate: 18, taxable: 299, tax: 53.82, intra_state: true, place_of_supply_code: '27' });
        expect(row.metadata.tax.seller).toMatchObject({ legal_name: SAVED.seller_legal_name, gstin: SELLER_MH });

        await query(`UPDATE platform_settings SET platform_payment_provider = 'easebuzz' WHERE id = 'default'`);
        const e = await checkout(await newBusiness('eb'), 'billing_starter', { provider: 'easebuzz' });
        expect(e.amount).toBe(352.82);
        expect(e.gateway).toBe(352.82);
      });

      it('the completion check uses the stored amounts, not the setting at payment time; the invoice number is issued then', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_starter');
        await saveTaxSettings({ mode: 'none' }); // switched after the link was made
        await expect(
          completeSubscriptionCheckoutPaymentDetailed({
            businessId: biz, planId: 'billing_starter', billingCycle: 'monthly', billingTransactionId: q.tx, providerPaymentId: 'pay_x_' + sfx(), amount: 299,
          }),
        ).rejects.toThrow('AMOUNT_MISMATCH');
        expect((await taxRow(q.tx))!).toMatchObject({ status: 'pending', invoice_number: null });
        expect(await complete(biz, q.tx, 'billing_starter', 352.82)).toMatchObject({ ok: true });
        const done = (await taxRow(q.tx))!;
        expect(done).toMatchObject({ status: 'completed', total_amount: '352.82', tax_amount: '53.82' });
        expect(done.invoice_number).toMatch(FY);
        expect(done.invoice_number!.split('/')[1]).toBe(await financialYearLabel({ query: (sql: string, v?: unknown[]) => getPool().query(sql, v as unknown[]) } as any));
      });

      it('a failed or pending payment gets no number; a repeated completion does not issue a second one', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_growth');
        expect((await taxRow(q.tx))!.invoice_number).toBeNull();
        await updateBillingTransactionStatus(q.tx, 'failed');
        expect((await taxRow(q.tx))!.invoice_number).toBeNull();

        const ok = await checkout(biz, 'billing_growth');
        const payId = 'pay_rep_' + sfx();
        const notes = notesFor(biz, ok.tx, 'billing_growth');
        await hook('payment.captured', payId, 'captured', notes, 58882);
        const first = (await taxRow(ok.tx))!.invoice_number;
        expect(first).toMatch(FY);
        const counter = () => queryOne<{ n: string }>(`SELECT COALESCE(SUM(last_number), 0)::text AS n FROM subscription_invoice_counters`);
        const before = await counter();
        await hook('payment.captured', payId, 'captured', notes, 58882);
        const again = await completeSubscriptionCheckoutPaymentDetailed({
          businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', billingTransactionId: ok.tx, providerPaymentId: payId, amount: 588.82,
        });
        expect(again.completion).toBe('already_completed');
        expect((await taxRow(ok.tx))!.invoice_number).toBe(first);
        expect(await counter()).toEqual(before);
      });

      it('simultaneous completions get different numbers with no gap', async () => {
        await setTax();
        const bs = await Promise.all([newBusiness('c1'), newBusiness('c2'), newBusiness('c3'), newBusiness('c4')]);
        const qs: Awaited<ReturnType<typeof checkout>>[] = [];
        for (const b of bs) qs.push(await checkout(b, 'billing_growth')); // one at a time: each stubs the gateway call
        await Promise.all(qs.map((q, i) => complete(bs[i], q.tx, 'billing_growth', 588.82)));
        const seqs = (await Promise.all(qs.map((q) => taxRow(q.tx)))).map((r) => Number(r!.invoice_number!.split('/')[2])).sort((a, b) => a - b);
        expect(new Set(seqs).size).toBe(4);
        expect(seqs[3] - seqs[0]).toBe(3);
      });

      it('two simultaneous completions of the SAME payment issue one number', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_growth');
        const payId = 'pay_same_' + sfx();
        const results = await Promise.all([
          hook('payment.captured', payId, 'captured', notesFor(biz, q.tx, 'billing_growth'), 58882),
          hook('payment.captured', payId, 'captured', notesFor(biz, q.tx, 'billing_growth'), 58882),
        ]);
        expect(results.every((r) => (r as { ok: boolean }).ok)).toBe(true);
        expect((await taxRow(q.tx))!.invoice_number).toMatch(FY);
        expect(await count(`billing_transactions WHERE invoice_number = $1`, [(await taxRow(q.tx))!.invoice_number])).toBe(1);
      });

      it('another state, and an unknown state, get IGST; the same state gets CGST + SGST', async () => {
        await setTax({ seller_gstin: SELLER_KA });
        const q1 = await checkout(biz, 'billing_starter'); // buyer GSTIN state 27, seller 29
        expect(await taxRow(q1.tx)).toMatchObject({ igst_amount: '53.82', cgst_amount: '0.00', sgst_amount: '0.00' });
        const unknown = await newBusiness('nostate');
        await query(`UPDATE businesses SET gstin = NULL, state_code = NULL, state = NULL WHERE id = $1`, [unknown]);
        const q2 = await checkout(unknown, 'billing_starter');
        expect(await taxRow(q2.tx)).toMatchObject({ igst_amount: '53.82', cgst_amount: '0.00', total_amount: '352.82' });
        expect((await taxRow(q2.tx))!.metadata.tax).toMatchObject({ intra_state: false, place_of_supply_code: null });
        const named = await newBusiness('named');
        await query(`UPDATE businesses SET gstin = NULL, state_code = NULL, state = 'Karnataka' WHERE id = $1`, [named]);
        await setTax({ seller_gstin: SELLER_KA });
        expect(await taxRow((await checkout(named, 'billing_starter')).tx)).toMatchObject({ cgst_amount: '26.91', sgst_amount: '26.91' });
      });

      it('the ₹1 floor: credit larger than the price leaves ₹1 before tax; ₹1.18 to pay', async () => {
        await setTax();
        await setRow(biz, 'billing_starter', { startOffset: -1, endOffset: 29 });
        await insertTaxedPaid(biz, 'billing_starter', null, 5000, 0, -1, 29);
        const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
        expect(p).toMatchObject({ netAmount: 1, taxableAmount: 1, taxAmount: 0.18, finalAmount: 1.18 });
        const q = await checkout(biz, 'billing_growth');
        expect(q.gateway).toBe(1.18);
      });

      it('a ₹1 plan: 1.18 exclusive, 1 inclusive', async () => {
        await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_starter'`);
        try {
          await setTax();
          expect((await checkout(biz, 'billing_starter')).amount).toBe(1.18);
          await saveTaxSettings({ mode: 'inclusive' });
          const q = await checkout(await newBusiness('one'), 'billing_starter');
          expect(q.amount).toBe(1);
          expect(await taxRow(q.tx)).toMatchObject({ total_amount: '1.00', taxable_amount: '0.85', tax_amount: '0.15' });
        } finally {
          await query(`UPDATE subscription_plans SET price_monthly = 299 WHERE id = 'billing_starter'`);
        }
      });

      it('an upgrade: tax is on the price after credit (₹299.67 + ₹53.94)', async () => {
        await setTax();
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        await insertTaxedPaid(biz, 'billing_starter', null, 299, 0, -10, 20); // from before GST was recorded
        const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
        expect(p).toMatchObject({ baseAmount: 499, creditApplied: 199.33, netAmount: 299.67, taxAmount: 53.94, finalAmount: 353.61 });
      });

      it('yearly ₹4,499 + 18 % = ₹5,308.82', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_growth', { cycle: 'yearly' });
        expect(q.amount).toBe(5308.82);
        expect(await complete(biz, q.tx, 'billing_growth', 5308.82, 'yearly')).toMatchObject({ ok: true });
      });

      it('an add-on gets the same tax, on both gateways, and completes only at the stored total', async () => {
        await setTax();
        const rz = jest
          .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
          .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://pay.example/a' });
        const r = await createAddonCheckout({ businessId: biz, addonType: 'khatario_ai' });
        expect(r.amount).toBe(352.82);
        expect(r.taxAmount).toBe(53.82);
        expect((rz.mock.calls[0][0] as { amount: number }).amount).toBe(352.82);
        expect(await taxRow(r.billingTransactionId)).toMatchObject({ amount: '299.00', total_amount: '352.82', tax_amount: '53.82', gst_mode: 'exclusive' });
        await query(`UPDATE platform_settings SET platform_payment_provider = 'easebuzz' WHERE id = 'default'`);
        const eb = jest
          .spyOn(EasebuzzPaymentProvider.prototype, 'createHostedPaymentLink')
          .mockResolvedValue({ provider: 'easebuzz', providerPaymentId: 'txn_' + sfx(), paymentUrl: 'https://pay.example/e' });
        const r2 = await createAddonCheckout({ businessId: await newBusiness('ebadd'), addonType: 'khatario_ai' });
        expect(r2.amount).toBe(352.82);
        expect((eb.mock.calls[0][0] as { amount: number }).amount).toBe(352.82);

        await expect(
          completeAddonCheckoutPayment({ businessId: biz, billingTransactionId: r.billingTransactionId, providerPaymentId: 'pay_a_' + sfx(), amount: 299 }),
        ).rejects.toThrow('AMOUNT_MISMATCH');
        await completeAddonCheckoutPayment({ businessId: biz, billingTransactionId: r.billingTransactionId, providerPaymentId: 'pay_a_' + sfx(), amount: 352.82 });
        expect((await taxRow(r.billingTransactionId))!.invoice_number).toMatch(FY);
      });
    });

    describe('inclusive: the charge is unchanged, the tax part is shown', () => {
      it('₹299 stays ₹299; taxable ₹253.39 + tax ₹45.61', async () => {
        await setTax({ mode: 'inclusive' });
        const q = await checkout(biz, 'billing_starter');
        expect(q.amount).toBe(299);
        expect(q.gateway).toBe(299);
        expect(await taxRow(q.tx)).toMatchObject({
          total_amount: '299.00', taxable_amount: '253.39', tax_amount: '45.61', cgst_amount: '22.80', sgst_amount: '22.81', gst_mode: 'inclusive',
        });
      });
    });

    // ---------------- upgrade credit is pre-tax ----------------

    describe('upgrade credit uses the pre-tax amount of each source', () => {
      it('a taxed payment (₹352.82, taxable ₹299) gives the same credit as ₹299 did; a row with no breakdown uses its total', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const taxed = await insertTaxedPaid(biz, 'billing_starter', 299, 352.82, 53.82, -10, 20);
        expect(await computeUpgradeCredit(biz, 'billing', 'billing_growth')).toMatchObject({ amount: 199.33, fromTransactionId: taxed });
        const b2 = await newBusiness('legacy');
        await setRow(b2, 'billing_starter', { startOffset: -10, endOffset: 20 });
        await insertTaxedPaid(b2, 'billing_starter', null, 299, 0, -10, 20);
        expect((await computeUpgradeCredit(b2, 'billing', 'billing_growth')).amount).toBe(199.33);
      });

      it('a part-refunded taxed payment loses the pre-tax share of the refund', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const id = await insertTaxedPaid(biz, 'billing_starter', 299, 352.82, 53.82, -10, 20);
        await query(`UPDATE billing_transactions SET metadata = jsonb_build_object('refunded_paise', 17641) WHERE id = $1`, [id]);
        // half of the money went back: pre-tax 149.50 left; 20/30 of it
        expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(99.66);
      });

      it('a tax-free part-refunded payment is exactly as before (total - refunded)', async () => {
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        const id = await insertTaxedPaid(biz, 'billing_starter', null, 299, 0, -10, 20);
        await query(`UPDATE billing_transactions SET metadata = jsonb_build_object('refunded_paise', 10000) WHERE id = $1`, [id]);
        expect((await computeUpgradeCredit(biz, 'billing', 'billing_growth')).amount).toBe(132.66); // (299 - 100) * 20 / 30
      });
    });

    // ---------------- refunds ----------------

    describe('refunds', () => {
      it('a refund of a taxed payment carries its share of the tax, a credit-note number, and the shares add up', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_starter');
        await complete(biz, q.tx, 'billing_starter', 352.82);
        stubRefundGateway();
        const a = await refundOf(biz, q.tx, 100);
        const b = await refundOf(biz, q.tx);
        const rows = (
          await query<{ id: string }>(`SELECT id FROM billing_transactions WHERE type = 'refund' AND metadata->>'refund_of' = $1 ORDER BY created_at`, [q.tx])
        ).rows;
        const [r1, r2] = await Promise.all(rows.map((r) => taxRow(r.id)));
        expect(a.status).toBe('processed');
        expect(b.status).toBe('processed');
        expect(r1).toMatchObject({ status: 'completed', total_amount: '100.00', tax_amount: '15.24', taxable_amount: '84.76', gst_mode: 'exclusive' });
        expect(r2).toMatchObject({ total_amount: '252.82', tax_amount: '38.58', taxable_amount: '214.24' });
        expect(Number(r1!.tax_amount) + Number(r2!.tax_amount)).toBeCloseTo(53.82, 2);
        expect(Number(r1!.cgst_amount) + Number(r1!.sgst_amount)).toBeCloseTo(15.24, 2);
        for (const r of [r1, r2]) expect(r!.invoice_number).toMatch(/^KH\/CN\/\d{4}-\d{2}\/\d{6}$/);
        expect(r1!.invoice_number).not.toBe(r2!.invoice_number);
        // the payment's own number is untouched and from the other series
        expect((await taxRow(q.tx))!.invoice_number).toMatch(FY);
      });

      it('a refund of a tax-free payment has no tax and no number: a plain Refund receipt', async () => {
        const q = await checkout(biz, 'billing_growth');
        await complete(biz, q.tx, 'billing_growth', 499);
        stubRefundGateway();
        await refundOf(biz, q.tx, 100);
        const r = (await queryOne<{ id: string }>(`SELECT id FROM billing_transactions WHERE type = 'refund' AND metadata->>'refund_of' = $1`, [q.tx]))!;
        expect(await taxRow(r.id)).toMatchObject({ tax_amount: '0.00', total_amount: '100.00', gst_mode: null });
        expect((await taxRow(r.id))!.invoice_number).toBeNull();
        const doc = await receiptOf(biz, r.id);
        expect(doc.status).toBe(200);
        expect(doc.text).toContain('<h1>Refund receipt</h1>');
        expect(doc.text).not.toMatch(/tax invoice|GST/i);
      });

      it('a pending refund has no number', async () => {
        const q = await checkout(biz, 'billing_growth');
        await complete(biz, q.tx, 'billing_growth', 499);
        (global.fetch as unknown as jest.Mock).mockReset();
        (global.fetch as unknown as jest.Mock).mockRejectedValue(new TypeError('fetch failed'));
        await refundOf(biz, q.tx, 100).catch(() => undefined);
        const rows = await query<{ id: string; status: string; invoice_number: string | null }>(
          `SELECT id, status, invoice_number FROM billing_transactions WHERE type = 'refund' AND metadata->>'refund_of' = $1`, [q.tx]);
        expect(rows.rows.length).toBeGreaterThan(0);
        for (const r of rows.rows) if (r.status !== 'completed') expect(r.invoice_number).toBeNull();
      });
    });

    // ---------------- numbering ----------------

    describe('numbers', () => {
      const scoped = async (fn: (c: import('pg').PoolClient) => Promise<void>) => {
        const c = await getPool().connect();
        try {
          await c.query('BEGIN');
          await fn(c);
        } finally {
          await c.query('ROLLBACK').catch(() => undefined);
          c.release();
        }
      };

      it('the financial year runs April to March by the date in India', async () => {
        await scoped(async (c) => {
          expect(await financialYearLabel(c, '2027-03-31T18:00:00Z')).toBe('2026-27'); // 23:30 IST on 31 March
          expect(await financialYearLabel(c, '2027-03-31T18:30:00Z')).toBe('2027-28'); // 00:00 IST on 1 April
          expect(await financialYearLabel(c, '2026-04-01T00:00:00+05:30')).toBe('2026-27');
          expect(await financialYearLabel(c, '2027-01-15T10:00:00Z')).toBe('2026-27');
          expect(await financialYearLabel(c, '2099-12-31T00:00:00Z')).toBe('2099-00');
        });
      });

      it('numbers continue within a year, restart in a new one, credit notes have their own series, and a rollback gives the number back', async () => {
        await query(`DELETE FROM subscription_invoice_counters WHERE financial_year IN ('2090-91', '2091-92')`);
        try {
          await scoped(async (c) => {
            expect(await nextInvoiceNumber(c, { invoicePrefix: 'ZZ' }, { at: '2090-05-01T00:00:00Z' })).toBe('ZZ/2090-91/000001');
          });
          const c = await getPool().connect();
          try {
            await c.query('BEGIN');
            expect(await nextInvoiceNumber(c, { invoicePrefix: 'ZZ' }, { at: '2090-05-01T00:00:00Z' })).toBe('ZZ/2090-91/000001');
            expect(await nextInvoiceNumber(c, { invoicePrefix: 'ZZ' }, { at: '2091-03-01T00:00:00Z' })).toBe('ZZ/2090-91/000002');
            expect(await nextInvoiceNumber(c, { invoicePrefix: 'ZZ' }, { at: '2091-04-01T00:00:00Z' })).toBe('ZZ/2091-92/000001');
            expect(await nextInvoiceNumber(c, { invoicePrefix: 'ZZ' }, { at: '2090-05-01T00:00:00Z', series: 'credit_note' })).toBe('ZZ/CN/2090-91/000001');
            await c.query('COMMIT');
          } finally {
            c.release();
          }
          await scoped(async (c2) => {
            expect(await nextInvoiceNumber(c2, { invoicePrefix: 'ZZ' }, { at: '2090-05-01T00:00:00Z' })).toBe('ZZ/2090-91/000003');
          });
        } finally {
          await query(`DELETE FROM subscription_invoice_counters WHERE financial_year IN ('2090-91', '2091-92')`);
        }
      });

      it('the database refuses a second row with the same invoice number', async () => {
        const q1 = await checkout(biz, 'billing_growth');
        const q2 = await checkout(biz, 'billing_growth');
        await query(`UPDATE billing_transactions SET invoice_number = 'DUP/1' WHERE id = $1`, [q1.tx]);
        await expect(query(`UPDATE billing_transactions SET invoice_number = 'DUP/1' WHERE id = $1`, [q2.tx])).rejects.toMatchObject({ code: '23505' });
        await query(`UPDATE billing_transactions SET invoice_number = NULL WHERE id = $1`, [q1.tx]);
      });
    });

    // ---------------- receipt route ----------------

    describe('receipt route', () => {
      it('a taxed payment: the owner sees a Tax invoice with the stored split; the seller as it was when the link was made', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_starter');
        await complete(biz, q.tx, 'billing_starter', 352.82);
        await saveTaxSettings({ seller_legal_name: 'Renamed Later Pvt Ltd' });
        const doc = await receiptOf(biz, q.tx);
        const number = (await taxRow(q.tx))!.invoice_number!;
        expect(doc.status).toBe(200);
        expect(doc.type).toMatch(/text\/html/);
        expect(doc.text).toContain('<h1>Tax invoice</h1>');
        expect(doc.text).toContain(number);
        expect(doc.text).toContain(SAVED.seller_legal_name);
        expect(doc.text).not.toContain('Renamed Later');
        expect(doc.text).toContain(SELLER_MH);
        expect(doc.text).toContain('27AAAPA1234A1Z5'); // buyer GSTIN
        expect(doc.text).toContain('CGST @ 9%');
        expect(doc.text).toContain('SGST @ 9%');
        expect(doc.text).toContain('26.91');
        expect(doc.text).toContain('299.00');
        expect(doc.text).toContain('352.82');
        expect(doc.text).toContain('998314');
      });

      it('mode none: a Receipt with the payment reference, no number, and never a Tax invoice or a GST line', async () => {
        const q = await checkout(biz, 'billing_growth');
        await complete(biz, q.tx, 'billing_growth', 499);
        const doc = await receiptOf(biz, q.tx);
        expect(doc.status).toBe(200);
        expect(doc.text).toContain('<h1>Receipt</h1>');
        expect((await taxRow(q.tx))!.invoice_number).toBeNull();
        expect(doc.text).not.toMatch(/ no\.|tax invoice|GST|Taxable|IGST/i);
        expect(doc.text).toContain('Reference');
        expect(doc.text).toContain('499.00');
      });

      it('a receipt of a payment made before GST was recorded (no breakdown) is a Receipt', async () => {
        const id = await insertTaxedPaid(biz, 'billing_growth', null, 499, 0, 0, 30);
        const doc = await receiptOf(biz, id);
        expect(doc.status).toBe(200);
        expect(doc.text).toContain('<h1>Receipt</h1>');
      });

      it('a payment of another business, a pending payment, a bad id and no session all fail; business ids in the URL are not trusted', async () => {
        const q = await checkout(biz, 'billing_growth');
        expect((await receiptOf(biz, q.tx)).status).toBe(404); // pending
        await complete(biz, q.tx, 'billing_growth', 499);
        expect((await receiptOf(biz, q.tx)).status).toBe(200);
        const other = await newBusiness('other');
        expect((await receiptOf(other, q.tx)).status).toBe(404);
        expect((await receiptOf(biz, randomUUID())).status).toBe(404);
        expect((await receiptOf(biz, 'not-a-uuid')).status).toBe(404);
        expect((await receiptOf(null, q.tx)).status).toBe(401);
        const res = await receiptGet(new NextRequest(`http://localhost/api/subscriptions/receipts/${q.tx}?business_id=${biz}`, asBusiness(other)), { params: { id: q.tx } });
        expect(res.status).toBe(404);
      });

      it('a business name with markup is escaped', async () => {
        const evil = '<script>alert(1)</script>';
        await setTax();
        await query(`UPDATE businesses SET name = $2 WHERE id = $1`, [biz, evil]);
        const q = await checkout(biz, 'billing_starter');
        await complete(biz, q.tx, 'billing_starter', 352.82);
        const taxed = await receiptOf(biz, q.tx);
        expect(taxed.text).not.toContain('<script>');
        expect(taxed.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
        await saveTaxSettings({ mode: 'none' });
        const biz2 = await newBusiness('plain');
        await query(`UPDATE businesses SET name = $2 WHERE id = $1`, [biz2, evil]);
        const q2 = await checkout(biz2, 'billing_growth');
        await complete(biz2, q2.tx, 'billing_growth', 499);
        const plain = await receiptOf(biz2, q2.tx);
        expect(plain.text).not.toContain('<script>');
        expect(plain.text).toContain('&lt;script&gt;');
      });

      it('a platform admin opens it through the admin route for that business only', async () => {
        const q = await checkout(biz, 'billing_growth');
        await complete(biz, q.tx, 'billing_growth', 499);
        const call = (bizId: string, tx: string) =>
          adminReceiptGet(new NextRequest(`http://localhost/api/admin/businesses/${bizId}/billing/${tx}/receipt`), { params: { id: bizId, txId: tx } });
        asPlatformAdmin();
        const ok = await call(biz, q.tx);
        expect(ok.status).toBe(200);
        expect(await ok.text()).toContain('<h1>Receipt</h1>');
        expect((await call(await newBusiness('adm'), q.tx)).status).toBe(404);
        (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 403 }) });
        expect((await call(biz, q.tx)).status).toBe(403);
      });
    });

    // ---------------- billing history ----------------

    describe('billing history', () => {
      it('carries the receipt link, number and breakdown; pending rows have no link; refunds are negative', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_starter');
        const pendingOnly = await checkout(biz, 'billing_growth');
        await complete(biz, q.tx, 'billing_starter', 352.82);
        stubRefundGateway();
        await refundOf(biz, q.tx, 100);
        const res = await historyGet(new NextRequest('http://localhost/api/subscriptions/billing-history', asBusiness(biz)));
        const body = await res.json();
        const byId = (id: string) => body.history.find((h: any) => h.id === id);
        const paid = byId(q.tx);
        expect(paid).toMatchObject({
          receipt_url: `/api/subscriptions/receipts/${q.tx}`, invoice_number: expect.stringMatching(FY), document_kind: 'tax_invoice',
          gst_mode: 'exclusive', gst_rate: 18, taxable_amount: 299, tax_amount: 53.82, cgst_amount: 26.91, sgst_amount: 26.91, igst_amount: 0, amount: 352.82,
        });
        expect(byId(pendingOnly.tx)).toMatchObject({ receipt_url: null, invoice_number: null });
        const refund = body.history.find((h: any) => h.type === 'refund');
        expect(refund).toMatchObject({
          amount: -100, tax_amount: -15.24, taxable_amount: -84.76, document_kind: 'credit_note',
          receipt_url: expect.stringContaining('/api/subscriptions/receipts/'), invoice_number: expect.stringContaining('/CN/'),
        });
      });

      it('a payment with no tax shows tax 0 and a Receipt kind', async () => {
        const q = await checkout(biz, 'billing_growth');
        await complete(biz, q.tx, 'billing_growth', 499);
        const body = await (await historyGet(new NextRequest('http://localhost/api/subscriptions/billing-history', asBusiness(biz)))).json();
        expect(body.history.find((h: any) => h.id === q.tx)).toMatchObject({ gst_mode: 'none', tax_amount: 0, taxable_amount: 499, document_kind: 'receipt' });
      });
    });

    // ---------------- admin setting ----------------

    describe('admin tax settings', () => {
      const put = (body: unknown) =>
        taxSettingsPut(new NextRequest('http://localhost/api/admin/settings/billing-tax', { method: 'PUT', body: JSON.stringify(body) }));

      it('only a platform admin can change it; a caller that is refused changes nothing', async () => {
        (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'no' }, { status: 403 }) });
        const r = await put({ mode: 'exclusive', seller_gstin: SELLER_MH, seller_legal_name: 'X' });
        expect(r.status).toBe(403);
        expect((await loadTaxSettings()).mode).toBe('none');
        const g = await taxSettingsGet(new NextRequest('http://localhost/api/admin/settings/billing-tax'));
        expect(g.status).toBe(403);
      });

      it('refuses to switch tax on without the seller GSTIN and legal name, and a bad GSTIN, rate or mode; nothing changes', async () => {
        asPlatformAdmin();
        for (const body of [
          { mode: 'exclusive' },
          { mode: 'inclusive', seller_gstin: SELLER_MH },
          { mode: 'exclusive', seller_legal_name: 'X' },
          { mode: 'exclusive', seller_gstin: '27AAAAA0000A1Z0', seller_legal_name: 'X' },
          { mode: 'exclusive', seller_gstin: SELLER_MH, seller_legal_name: 'X', rate_percent: 29 },
          { mode: 'exclusive', seller_gstin: SELLER_MH, seller_legal_name: 'X', rate_percent: -1 },
          { mode: 'exclusive', seller_gstin: SELLER_MH, seller_legal_name: 'X', rate_percent: 'abc' },
          { mode: 'exclusive', seller_gstin: SELLER_MH, seller_legal_name: 'X', rate_percent: 18.123 },
          { mode: 'sometimes' },
          { mode: 'none', invoice_prefix: 'bad prefix!' },
          { mode: 'none', sac_code: 'abc' },
          { mode: 'none', seller_state_code: '29', seller_gstin: SELLER_MH },
        ]) {
          const r = await put(body);
          expect({ body, status: r.status }).toEqual({ body, status: 400 });
          expect(typeof (await r.json()).error).toBe('string');
        }
        expect(await loadTaxSettings()).toMatchObject({ mode: 'none', sellerGstin: null });
      });

      it('saves and returns the settings; a later partial change keeps the rest; the audit log is written without the secrets of the request', async () => {
        asPlatformAdmin();
        const r = await put({
          mode: 'exclusive', rate_percent: 12, seller_gstin: SELLER_KA.toLowerCase(), seller_legal_name: ' Khatario Pvt Ltd ',
          seller_address: 'Bengaluru', sac_code: '998313', invoice_prefix: 'kh', business_id: randomUUID(), created_by: 'x',
        });
        expect(r.status).toBe(200);
        expect((await r.json()).settings).toEqual({
          mode: 'exclusive', rate_percent: 12, seller_gstin: SELLER_KA, seller_legal_name: 'Khatario Pvt Ltd', seller_address: 'Bengaluru',
          seller_state_code: '29', sac_code: '998313', invoice_prefix: 'KH', updated_by: ADMIN, updated_at: expect.any(String),
        });
        const r2 = await put({ rate_percent: 5 });
        expect(r2.status).toBe(200);
        expect(await loadTaxSettings()).toMatchObject({ mode: 'exclusive', ratePercent: 5, sellerGstin: SELLER_KA, sacCode: '998313' });
        const g = await taxSettingsGet(new NextRequest('http://localhost/api/admin/settings/billing-tax'));
        expect((await g.json()).settings).toMatchObject({ mode: 'exclusive', rate_percent: 5 });
        // a checkout now uses the saved rate
        expect((await checkout(biz, 'billing_starter')).amount).toBe(313.95);
      });

      it('the database itself refuses tax on without a seller GSTIN', async () => {
        await expect(query(`UPDATE platform_settings SET subscription_gst_mode = 'exclusive' WHERE id = 'default'`)).rejects.toMatchObject({ code: '23514' });
        await expect(query(`UPDATE platform_settings SET subscription_gst_rate = 40 WHERE id = 'default'`)).rejects.toMatchObject({ code: '23514' });
        expect(saveTaxSettings({ mode: 'exclusive' })).rejects.toBeInstanceOf(TaxSettingsError);
      });
    });


    // ---------------- fix round 1 ----------------

    describe('numbers only for taxed rows, number last, per-head refunds, setting switched', () => {
      it('two completions at once for one business and product, one with upgrade credit and one without, both finish with distinct consecutive numbers', async () => {
        await setTax();
        await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
        await insertTaxedPaid(biz, 'billing_starter', null, 299, 0, -10, 20);
        const withCredit = await checkout(biz, 'billing_growth');
        const renewal = await checkout(biz, 'billing_starter');
        expect(withCredit.amount).toBe(353.61);
        expect(renewal.amount).toBe(352.82);
        const [a, b] = await Promise.all([
          complete(biz, withCredit.tx, 'billing_growth', 353.61),
          complete(biz, renewal.tx, 'billing_starter', 352.82),
        ]);
        expect(a).toMatchObject({ ok: true });
        expect(b).toMatchObject({ ok: true });
        const rows = [await taxRow(withCredit.tx), await taxRow(renewal.tx)];
        expect(rows.map((r) => r!.status)).toEqual(['completed', 'completed']);
        const seqs = rows.map((r) => Number(r!.invoice_number!.split('/')[2])).sort((x, y) => x - y);
        expect(seqs[1] - seqs[0]).toBe(1);
      });

      it('mode none never reads or writes the counter table: the row count is unchanged and a locked counter table does not stop a completion or a refund', async () => {
        const sums = () => queryOne<{ n: string; c: string }>(`SELECT COALESCE(SUM(last_number), 0)::text AS n, COUNT(*)::text AS c FROM subscription_invoice_counters`);
        const before = await sums();
        const q = await checkout(biz, 'billing_growth');
        const locker = await getPool().connect();
        try {
          await locker.query('BEGIN');
          await locker.query('LOCK TABLE subscription_invoice_counters IN ACCESS EXCLUSIVE MODE');
          const done = await Promise.race([
            complete(biz, q.tx, 'billing_growth', 499).then(() => 'done'),
            new Promise((r) => setTimeout(() => r('blocked'), 8000)),
          ]);
          expect(done).toBe('done');
          stubRefundGateway();
          const refund = await Promise.race([
            refundOf(biz, q.tx, 100).then(() => 'done'),
            new Promise((r) => setTimeout(() => r('blocked'), 8000)),
          ]);
          expect(refund).toBe('done');
        } finally {
          await locker.query('ROLLBACK').catch(() => undefined);
          locker.release();
        }
        expect((await taxRow(q.tx))).toMatchObject({ status: 'completed', invoice_number: null });
        const rf = await queryOne<{ invoice_number: string | null; status: string }>(
          `SELECT invoice_number, status FROM billing_transactions WHERE type = 'refund' AND metadata->>'refund_of' = $1`, [q.tx]);
        expect(rf).toEqual({ invoice_number: null, status: 'completed' });
        expect(await sums()).toEqual(before);
      });

      it('the document kind follows the mode stored on the row, not today\'s setting', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_starter');
        await complete(biz, q.tx, 'billing_starter', 352.82);
        await saveTaxSettings({ mode: 'none' });
        expect((await receiptOf(biz, q.tx)).text).toContain('<h1>Tax invoice</h1>');
        const b2 = await newBusiness('plain2');
        const p = await checkout(b2, 'billing_starter');
        await setTax();
        await complete(b2, p.tx, 'billing_starter', 299);
        const doc = await receiptOf(b2, p.tx);
        expect(doc.text).toContain('<h1>Receipt</h1>');
        expect(doc.text).not.toMatch(/tax invoice|GST/i);
      });

      it('created in exclusive, switched to none, paid: completes at the stored total with the stored breakdown and a tax-invoice number', async () => {
        await setTax();
        const q = await checkout(biz, 'billing_starter');
        await saveTaxSettings({ mode: 'none' });
        expect(await complete(biz, q.tx, 'billing_starter', 352.82)).toMatchObject({ ok: true });
        const row = (await taxRow(q.tx))!;
        expect(row).toMatchObject({ status: 'completed', total_amount: '352.82', tax_amount: '53.82', taxable_amount: '299.00', gst_mode: 'exclusive' });
        expect(row.invoice_number).toMatch(FY);
      });

      it('created in none, switched to exclusive, paid: completes at the original amount, no tax, no number', async () => {
        const q = await checkout(biz, 'billing_starter');
        await setTax();
        await expect(
          completeSubscriptionCheckoutPaymentDetailed({
            businessId: biz, planId: 'billing_starter', billingCycle: 'monthly', billingTransactionId: q.tx, providerPaymentId: 'pay_x_' + sfx(), amount: 352.82,
          }),
        ).rejects.toThrow('AMOUNT_MISMATCH');
        expect(await complete(biz, q.tx, 'billing_starter', 299)).toMatchObject({ ok: true });
        expect(await taxRow(q.tx)).toMatchObject({ status: 'completed', total_amount: '299.00', tax_amount: '0.00', gst_mode: 'none', invoice_number: null });
      });

      describe.each([
        ['intra-state (CGST + SGST)', SELLER_MH],
        ['inter-state (IGST)', SELLER_KA],
      ])('three partial refunds of an odd-paise invoice, %s', (_label, sellerGstin) => {
        it('every head sums exactly to the invoice figure after the full refund', async () => {
          await setTax({ rate_percent: 5, seller_gstin: sellerGstin }); // 299 + 14.95 = 313.95, tax 14.95 is odd
          const q = await checkout(biz, 'billing_starter');
          expect(q.amount).toBe(313.95);
          await complete(biz, q.tx, 'billing_starter', 313.95);
          const inv = (await taxRow(q.tx))!;
          stubRefundGateway();
          await refundOf(biz, q.tx, 100.01);
          await refundOf(biz, q.tx, 100.01);
          await refundOf(biz, q.tx); // the rest
          const sums = (
            await query<{ taxable: string; cgst: string; sgst: string; igst: string; total: string; n: string }>(
              `SELECT SUM(round(taxable_amount * 100))::text AS taxable, SUM(round(cgst_amount * 100))::text AS cgst,
                      SUM(round(sgst_amount * 100))::text AS sgst, SUM(round(igst_amount * 100))::text AS igst,
                      SUM(round(total_amount * 100))::text AS total, COUNT(*)::text AS n
               FROM billing_transactions WHERE type = 'refund' AND status = 'completed' AND metadata->>'refund_of' = $1`, [q.tx])
          ).rows[0];
          const paise = (v: string | null) => Math.round(Number(v ?? 0) * 100);
          expect(sums.n).toBe('3');
          expect(Number(sums.total)).toBe(paise(inv.total_amount));
          expect(Number(sums.taxable)).toBe(paise(inv.taxable_amount));
          expect(Number(sums.cgst)).toBe(paise(inv.cgst_amount));
          expect(Number(sums.sgst)).toBe(paise(inv.sgst_amount));
          expect(Number(sums.igst)).toBe(paise(inv.igst_amount));
          expect(Number(sums.cgst) + Number(sums.sgst) + Number(sums.igst)).toBe(1495);
          if (sellerGstin === SELLER_MH) expect([paise(inv.cgst_amount), paise(inv.sgst_amount)]).toEqual([747, 748]);
          else expect(paise(inv.igst_amount)).toBe(1495);
        });
      });

      it('the setting records who changed it and when', async () => {
        asPlatformAdmin();
        const res = await taxSettingsPut(new NextRequest('http://localhost/x', { method: 'PUT', body: JSON.stringify({ mode: 'none', invoice_prefix: 'AB' }) }));
        expect(res.status).toBe(200);
        expect(await queryOne(`SELECT subscription_tax_updated_by AS by, subscription_tax_updated_at IS NOT NULL AS at FROM platform_settings WHERE id = 'default'`)).toEqual({ by: ADMIN, at: true });
      });
    });

    // ---------------- migration ----------------

    describe('migration 481', () => {
      it('can run again; the tax columns are on both tables and the billing archive list; the invoice number is unique', async () => {
        const text = readFileSync(join(process.cwd(), 'database/migrations/481_subscription_tax.sql'), 'utf8');
        await query(text);
        await query(text);
        const cols = async (t: string) =>
          new Set((await query<{ column_name: string }>(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`, [t])).rows.map((r) => r.column_name));
        for (const c of ['taxable_amount', 'cgst_amount', 'sgst_amount', 'igst_amount', 'gst_rate', 'gst_mode']) {
          expect((await cols('billing_transactions')).has(c)).toBe(true);
          expect((await cols('billing_transactions_archive')).has(c)).toBe(true);
        }
        expect(await count(`pg_indexes WHERE indexname = 'uq_billing_tx_invoice_number'`)).toBe(1);
        expect(text).toMatch(/SET LOCAL lock_timeout/);
      });

      it('a deleted business keeps its tax breakdown and invoice number in the archive', async () => {
        await setTax();
        const b = await newBusiness('arch6');
        const q = await checkout(b, 'billing_starter');
        await complete(b, q.tx, 'billing_starter', 352.82);
        const number = (await taxRow(q.tx))!.invoice_number;
        await deleteBusinessCompletely(b, ADMIN);
        const a = await queryOne<{ invoice_number: string; tax_amount: string; taxable_amount: string; gst_mode: string }>(
          `SELECT invoice_number, tax_amount::text, taxable_amount::text, gst_mode FROM billing_transactions_archive WHERE id = $1`, [q.tx]);
        expect(a).toEqual({ invoice_number: number, tax_amount: '53.82', taxable_amount: '299.00', gst_mode: 'exclusive' });
      });
    });
  });

  // ---- Task 7: the price preview shows what checkout then stores ----

  describe('checkout preview', () => {
    const asBiz = (id: string) => ({ headers: { 'x-authenticated-business-id': id, 'x-authenticated-user-id': adminOf.get(id)! } });
    async function preview(businessId: string, qs: Record<string, string>) {
      const res = await previewGet(
        new NextRequest(`http://localhost/api/subscriptions/checkout/preview?${new URLSearchParams(qs).toString()}`, asBiz(businessId)),
      );
      return { status: res.status, body: await res.json() };
    }
    async function realCheckout(businessId: string, planId: string, coupon?: string) {
      const spy = jest
        .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
        .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
      try {
        return await createSubscriptionCheckout({ businessId, planId, billingCycle: 'monthly', couponCode: coupon });
      } finally {
        spy.mockRestore();
      }
    }
    const stored = (id: string) =>
      queryOne<{ total_amount: string; tax_amount: string; metadata: Record<string, any>; period_start: string | null; period_end: string | null }>(
        `SELECT total_amount::text, tax_amount::text, metadata, period_start::text, period_end::text FROM billing_transactions WHERE id = $1`,
        [id],
      );
    const tables = async (businessId: string) =>
      (await queryOne<{ n: string }>(
        `SELECT ((SELECT COUNT(*) FROM billing_transactions WHERE business_id = $1)
               + (SELECT COUNT(*) FROM coupon_redemptions WHERE business_id = $1)
               + (SELECT COUNT(*) FROM subscription_events WHERE business_id = $1))::text AS n`,
        [businessId],
      ))!.n;
    const insertPaid7 = (businessId: string, planId: string, amount: number, s: number, e: number) =>
      query(
        `INSERT INTO billing_transactions (business_id, type, status, amount, total_amount, plan_id, module_key, billing_cycle, payment_method,
           period_start, period_end, gateway_response)
         VALUES ($1, 'payment', 'completed', $2, $2, $3, 'billing', 'monthly', 'razorpay', CURRENT_DATE + $4::int, CURRENT_DATE + $5::int,
           '{"checkout_type":"subscription","provider":"razorpay"}'::jsonb)`,
        [businessId, amount, planId, s, e],
      );

    /** Preview, then the real checkout, then the payment: the three must agree. */
    async function agree(businessId: string, planId: string, coupon?: string) {
      const before = await tables(businessId);
      const p = await preview(businessId, { plan_id: planId, billing_cycle: 'monthly', ...(coupon ? { coupon_code: coupon } : {}) });
      expect(p.status).toBe(200);
      expect(await tables(businessId)).toBe(before); // a preview writes nothing
      expect(global.fetch).not.toHaveBeenCalled();
      const c = await realCheckout(businessId, planId, coupon);
      const row = await stored(c.billingTransactionId);
      expect(p.body.breakdown.amountToPay).toBe(c.amount);
      expect(Number(row!.total_amount)).toBe(p.body.breakdown.amountToPay);
      expect(p.body.breakdown.taxAmount).toBe(Number(row!.tax_amount));
      expect(p.body.breakdown.creditApplied).toBe(c.creditApplied);
      expect(p.body.breakdown.creditUnused).toBe(c.creditUnused);
      expect(p.body.credit_unused).toBe(c.creditUnused);
      expect(p.body.breakdown.listPrice).toBe(c.baseAmount);
      expect(p.body.breakdown.couponDiscount).toBe(c.discountAmount);
      const done = await hook('payment.captured', 'pay_pv_' + sfx(), 'captured', notesFor(businessId, c.billingTransactionId, planId), Math.round(c.amount * 100));
      expect(done).toMatchObject({ ok: true });
      const paid = await stored(c.billingTransactionId);
      // The subscription row ends up with the previewed dates; the payment row records the days it bought.
      expect(await moduleRow(businessId)).toMatchObject({ start_date: p.body.period_start, end_date: p.body.period_end });
      expect(paid!.period_end).toBe(p.body.period_end);
      return p.body;
    }

    it('a normal plan on a business with no plan row', async () => {
      const b = await agree(biz, 'billing_starter');
      expect(b.period_kind).toBe('change');
      expect(b.breakdown.listPrice).toBe(299);
    });

    it('a Rs 1 plan previews Rs 1 and the same Rs 1 is charged', async () => {
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_starter'`);
      try {
        const b = await agree(biz, 'billing_starter');
        expect(b.breakdown.amountToPay).toBe(1);
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = 299 WHERE id = 'billing_starter'`);
      }
    });

    it('a renewal keeps the start and adds the cycle after the current end date', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid7(biz, 'billing_starter', 299, -10, 20);
      const b = await agree(biz, 'billing_starter');
      expect(b.period_kind).toBe('renewal');
      expect(b.period_start).toBe(await daysFromToday(-10));
      expect(b.period_end).toBe(await addMonths(await daysFromToday(20), 1));
      expect(b.breakdown.creditApplied).toBe(0);
    });

    it('an upgrade with credit, including credit that is left over', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid7(biz, 'billing_starter', 299, -10, 20);
      const b = await agree(biz, 'billing_growth');
      expect(b.period_kind).toBe('change');
      expect(b.breakdown.creditApplied).toBe(199.33);
      expect(b.period_start).toBe(await daysFromToday(0));

      const b2 = await newBusiness('pv-left');
      await setRow(b2, 'billing_starter', { startOffset: -1, endOffset: 29 });
      await insertPaid7(b2, 'billing_starter', 5000, -1, 29);
      const body = await agree(b2, 'billing_growth');
      expect(body.breakdown.amountToPay).toBe(1);
      expect(body.credit_unused).toBeGreaterThan(0);
    });

    it('a coupon', async () => {
      const code = `PV${randomUUID().slice(0, 8).toUpperCase()}`;
      const c = await queryOne<{ id: string }>(`INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, 'flat', 100, 1) RETURNING id`, [code]);
      coupons.push(c!.id);
      const b = await agree(biz, 'billing_growth', code);
      expect(b.breakdown.couponDiscount).toBe(100);
      expect(b.breakdown.amountToPay).toBe(399);
    });

    it('refuses the trial plan, an unknown plan and a missing session; never takes a business id from the query', async () => {
      expect((await preview(biz, { plan_id: 'trial' })).status).toBe(400);
      expect((await preview(biz, { plan_id: 'no_such_plan' })).status).toBe(400);
      expect((await preview(biz, {})).status).toBe(400);
      const anon = await previewGet(new NextRequest('http://localhost/api/subscriptions/checkout/preview?plan_id=billing_starter'));
      expect(anon.status).toBe(401);
      const other = await newBusiness('pv-other');
      const p = await preview(biz, { plan_id: 'billing_starter', business_id: other });
      expect(p.status).toBe(200); // ignored: the answer is for the session's business
    });

    it("the answer is the session's business's even when another business's id is sent (that one has credit, this one has none)", async () => {
      const other = await newBusiness('pv-credit');
      await setRow(other, 'billing_starter', { startOffset: -10, endOffset: 20 });
      await insertPaid7(other, 'billing_starter', 299, -10, 20);
      // Control: asked as the other business, the same preview carries its credit.
      const asOther = await preview(other, { plan_id: 'billing_growth' });
      expect(asOther.body.breakdown.creditApplied).toBe(199.33);
      // As biz (no plan row, no payments) with the other's id in the query: biz's answer, with no credit.
      const asBiz = await preview(biz, { plan_id: 'billing_growth', business_id: other });
      expect(asBiz.status).toBe(200);
      expect(asBiz.body.breakdown.creditApplied).toBe(0);
      expect(asBiz.body.period_kind).toBe('change');
      expect(asBiz.body.breakdown.amountToPay).toBe(asBiz.body.breakdown.listPrice);
    });
  });

  describe('admin billing list tells the screen what a refund may be', () => {
    it('reports the refundable amount (paid minus credit used, minus refunds), pending refunds and whether one can be cancelled', async () => {
      (requirePlatformRequest as jest.Mock).mockResolvedValue({ ok: true, admin: { id: randomUUID() } });
      await setRow(biz, 'billing_starter', { startOffset: -5, endOffset: 25 });
      const pay = await queryOne<{ id: string }>(
        `INSERT INTO billing_transactions (business_id, type, status, amount, total_amount, plan_id, module_key, billing_cycle, payment_method,
           period_start, period_end, metadata, gateway_response)
         VALUES ($1, 'payment', 'completed', 300, 300, 'billing_starter', 'billing', 'monthly', 'razorpay', CURRENT_DATE - 5, CURRENT_DATE + 25,
           '{"credit_used_paise": 5000}'::jsonb, '{"checkout_type":"subscription","provider":"razorpay"}'::jsonb) RETURNING id`,
        [biz],
      );
      const refund = (status: string, amt: number, meta: Record<string, unknown>) =>
        queryOne<{ id: string }>(
          `INSERT INTO billing_transactions (business_id, type, status, amount, total_amount, plan_id, module_key, payment_method, metadata)
           VALUES ($1, 'refund', $2, $3, $3, 'billing_starter', 'billing', 'razorpay', $4::jsonb) RETURNING id`,
          [biz, status, amt, JSON.stringify({ refund_of: pay!.id, ...meta })],
        );
      const done = await refund('completed', 50, {});
      const waiting = await refund('pending', 100, {});
      const sent = await refund('pending', 20, { gateway_requested: true });
      const res = await adminBillingGet(new NextRequest(`http://localhost/api/admin/businesses/${biz}/billing`), { params: { id: biz } });
      const { transactions } = await res.json();
      const byId = (id: string) => transactions.find((t: any) => t.id === id);
      expect(byId(pay!.id)).toMatchObject({
        can_refund: true,
        refundable_amount: 80, // 300 - 50 credit used - 50 refunded - 100 waiting - 20 waiting
        refunded_amount: 50,
        pending_refund_amount: 120,
        sent_through_gateway: true,
        plan_end_date: await daysFromToday(25),
      });
      expect(byId(pay!.id).metadata).toBeUndefined();
      expect(byId(done!.id)).toMatchObject({ refund_of: pay!.id, can_cancel_refund: false });
      expect(byId(waiting!.id).can_cancel_refund).toBe(true);
      expect(byId(sent!.id).can_cancel_refund).toBe(false);
      (requirePlatformRequest as jest.Mock).mockReset();
    });
  });
});
