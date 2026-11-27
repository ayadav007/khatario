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

import { query, queryOne, closePool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { processPlatformRazorpayWebhook, recordBillingTransaction } from '@/lib/platform-billing';
import { resolveNewPeriod } from '@/lib/subscription/period';
import { readFileSync } from 'fs';
import { join } from 'path';
import type { BillingCycle } from '@/lib/subscription/apply-plan-change';

const run = enabled ? describe : describe.skip;

run('renewal, refund and GST (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  const coupons: string[] = [];
  let biz: string;

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
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [randomUUID(), id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
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
});
