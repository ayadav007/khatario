/**
 * Billing money-path fixes against real PostgreSQL. Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/billing-money-path.db.test.ts --runInBand --forceExit
 */
import { createHash, createHmac, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { config as loadEnv } from 'dotenv';

process.env.PLATFORM_RAZORPAY_KEY_ID = 'rzp_test_plan';
process.env.PLATFORM_RAZORPAY_KEY_SECRET = 'k';
process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET = 'whsec_plan';
process.env.PLATFORM_EASEBUZZ_KEY = 'PLATKEY';
process.env.PLATFORM_EASEBUZZ_SALT = 'PLATSALT';

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

jest.mock('@/lib/platform-push', () => ({ sendPlatformAdminPush: jest.fn(async () => undefined) }));

import { NextRequest } from 'next/server';
import { query, queryOne, closePool, getPool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { POST as upgradePost } from '@/app/api/subscriptions/upgrade/route';
import { POST as checkoutPost } from '@/app/api/subscriptions/checkout/route';
import {
  downgradeModuleSubscription,
  moveModuleSubscriptionToFree,
} from '@/lib/subscription/module-plan-lifecycle';
import { applyModuleSubscriptionPlanChange } from '@/lib/subscription/apply-module-plan-change';
import * as planChange from '@/lib/subscription/apply-module-plan-change';
import { processExpiredModuleSubscriptions } from '@/lib/subscription/lifecycle';
import { getOperationalModuleSubscriptions } from '@/lib/subscription/module-subscriptions';
import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';
import {
  processPlatformEasebuzzCallback,
  processPlatformRazorpayWebhook,
  recordBillingTransaction,
  updateBillingTransactionStatus,
} from '@/lib/platform-billing';
import { completeAddonCheckoutPayment } from '@/lib/platform-addon-checkout';
import { khatarioMonthlyQuota } from '@/lib/ai-agent/billing';
import { sendPlatformAdminPush } from '@/lib/platform-push';
import {
  findStuckWebhookEvents,
  findUnappliedPayments,
  reportBillingAnomalies,
} from '@/lib/subscription/reconcile-payments';
import { POST as razorpayWebhookPost } from '@/app/api/webhooks/platform-billing/razorpay/route';

const run = enabled ? describe : describe.skip;

type SetPlanOpts = {
  end_date?: string; // relative to CURRENT_DATE, e.g. '+300 days' | '-1 day'
  grace_period_end?: string; // same format
  scheduled_plan_id?: string;
  status?: string;
};

run('billing money path (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  const createdCoupons: string[] = [];
  const adminOf = new Map<string, string>();
  let biz: string;

  /** Business with billing enabled and a primary-admin user (owner of subscription changes). */
  async function newBusiness(label: string): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Money path ${label} ${id.slice(0, 6)}`],
    );
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source)
       VALUES ($1, 'billing', true, 'test')`,
      [id],
    );
    const userId = randomUUID();
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin)
       VALUES ($1, $2, 'Owner', $3, true)`,
      [userId, id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
    );
    adminOf.set(id, userId);
    return id;
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

  /** The database's CURRENT_DATE + n days, as text (so tests and SQL agree on "today"). */
  async function daysFromToday(n: number): Promise<string> {
    const r = await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + $1::int)::text AS d`, [n]);
    return r!.d;
  }

  /** The database's CURRENT_DATE + n months, as text. */
  async function monthsFromToday(n: number): Promise<string> {
    const r = await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + make_interval(months => $1::int))::date::text AS d`, [n]);
    return r!.d;
  }

  /** The Khatario AI add-on row with dates as text, or null. */
  async function addon(businessId: string) {
    return queryOne<{ status: string; start_date: string; end_date: string | null; price_monthly: string }>(
      `SELECT status, start_date::text, end_date::text, price_monthly::text FROM whatsapp_addons
       WHERE business_id = $1 AND addon_type = 'khatario_ai'`,
      [businessId],
    );
  }

  /** One real Khatario AI payment through completeAddonCheckoutPayment. */
  async function payAddon(businessId: string) {
    const billingTransactionId = await pendingCheckout(businessId, 'connect', 299);
    await query(
      `UPDATE billing_transactions SET gateway_response = '{"checkout_type":"whatsapp_addon","addon_type":"khatario_ai","provider":"razorpay"}'::jsonb WHERE id = $1`,
      [billingTransactionId],
    );
    return completeAddonCheckoutPayment({
      businessId,
      addonType: 'khatario_ai',
      billingTransactionId,
      providerPaymentId: 'pay_ai_' + randomUUID().replace(/-/g, '').slice(0, 16),
      amount: 299,
    });
  }

  /** The module row with date columns as text, or null. */
  async function row(businessId: string, moduleKey: string) {
    return queryOne<{
      plan_id: string;
      status: string;
      start_date: string;
      end_date: string | null;
      trial_end_date: string | null;
      grace_period_end: string | null;
      scheduled_plan_id: string | null;
      billing_cycle: string | null;
    }>(
      `SELECT plan_id, status, start_date::text AS start_date, end_date::text AS end_date,
              trial_end_date::text AS trial_end_date, grace_period_end::text AS grace_period_end,
              scheduled_plan_id, billing_cycle
       FROM business_module_subscriptions WHERE business_id = $1 AND module_key = $2`,
      [businessId, moduleKey],
    );
  }

  /** Call POST /api/subscriptions/upgrade as the business's primary admin. */
  function upgrade(businessId: string, body: Record<string, unknown>) {
    const req = new NextRequest('http://localhost/api/subscriptions/upgrade', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-authenticated-business-id': businessId,
        'x-authenticated-user-id': adminOf.get(businessId)!,
      },
      body: JSON.stringify(body),
    });
    return upgradePost(req);
  }

  /** Call POST /api/subscriptions/checkout as the business's primary admin. */
  function checkout(businessId: string, body: Record<string, unknown>) {
    const req = new NextRequest('http://localhost/api/subscriptions/checkout', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-authenticated-business-id': businessId,
        'x-authenticated-user-id': adminOf.get(businessId)!,
      },
      body: JSON.stringify(body),
    });
    return checkoutPost(req);
  }


  /** Insert a pending subscription-checkout row through the real recorder; returns its id. */
  async function pendingCheckout(
    businessId: string,
    planId: string,
    amount: number,
    opts: { couponId?: string; discount?: number; cycle?: 'monthly' | 'yearly' | 'three_year' } = {},
  ): Promise<string> {
    const { id } = await recordBillingTransaction({
      businessId,
      planId,
      amount,
      discountAmount: opts.discount,
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
    return queryOne<{
      status: string;
      total_amount: string;
      payment_reference: string | null;
      description: string | null;
    }>(`SELECT status, total_amount::text, payment_reference, description FROM billing_transactions WHERE id = $1`, [id]);
  }

  function notesFor(businessId: string, tx: string, planId: string, cycle = 'monthly') {
    return { business_id: businessId, billing_transaction_id: tx, plan_id: planId, billing_cycle: cycle };
  }

  /** Build, sign and deliver a Razorpay webhook to the real platform handler. */
  function hook(
    event: string,
    payId: string,
    payStatus: string,
    notes: Record<string, unknown>,
    opts: { amountPaise?: number; withLink?: boolean } = {},
  ) {
    const amount = opts.amountPaise ?? 49900;
    const payload: Record<string, unknown> = {
      payment: { entity: { id: payId, status: payStatus, amount, notes } },
    };
    if (event.startsWith('payment_link.') || opts.withLink) {
      const linkStatus = event.endsWith('cancelled') ? 'cancelled' : event.endsWith('expired') ? 'expired' : 'paid';
      payload.payment_link = {
        entity: { id: 'plink_' + payId, status: linkStatus, amount, amount_paid: amount, notes },
      };
    }
    const raw = JSON.stringify({ event, payload });
    const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
    return processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': sig });
  }

  const sfx = () => randomUUID().slice(0, 8);

  /** Pending checkout at the plan's monthly price, paid via a signed payment.captured; returns the transaction id. */
  async function paidAndActivated(businessId: string, planId: string, amount?: number): Promise<string> {
    let price = amount;
    if (price === undefined) {
      const plan = await queryOne<{ price_monthly: string }>(
        `SELECT price_monthly::text FROM subscription_plans WHERE id = $1`,
        [planId],
      );
      price = Number(plan!.price_monthly);
    }
    const tx = await pendingCheckout(businessId, planId, price);
    const r = await hook('payment.captured', 'pay_pa_' + sfx(), 'captured', notesFor(businessId, tx, planId), {
      amountPaise: Math.round(price * 100),
    });
    expect(r).toMatchObject({ ok: true });
    return tx;
  }

  async function eventFor(txId: string) {
    return queryOne<{ status: string; processing_notes: string | null }>(
      `SELECT status, processing_notes FROM platform_billing_webhook_events WHERE billing_transaction_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [txId],
    );
  }

  /** Insert a coupon with a unique code; removed in afterAll. Returns its id. */
  async function makeCoupon(c: {
    type: 'percentage' | 'flat' | 'free_months';
    value: number;
    max_redemptions?: number;
    max_per_business?: number;
  }): Promise<string> {
    const code = `T5${randomUUID().slice(0, 10).toUpperCase()}`;
    const r = await queryOne<{ id: string }>(
      `INSERT INTO coupons (code, type, value, max_redemptions, max_per_business)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [code, c.type, c.value, c.max_redemptions ?? null, c.max_per_business ?? 1],
    );
    createdCoupons.push(r!.id);
    return r!.id;
  }

  /** SELECT COUNT(*) FROM <sqlAfterFrom>. */
  async function count(sqlAfterFrom: string, params: unknown[]): Promise<number> {
    const r = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${sqlAfterFrom}`, params);
    return Number(r!.n);
  }

  /** A pending Easebuzz checkout row (payment_reference = txnid, as createSubscriptionCheckout stores it). */
  async function pendingEasebuzzCheckout(businessId: string, planId: string, amount: number) {
    const txnid = `PB-${randomUUID().replace(/-/g, '').slice(0, 20)}-${Date.now()}`;
    const { id } = await recordBillingTransaction({
      businessId,
      planId,
      amount,
      billingCycle: 'monthly',
      paymentMethod: 'easebuzz',
      paymentReference: txnid,
      status: 'pending',
      skipEmails: true,
    });
    await query(
      `UPDATE billing_transactions SET gateway_response = '{"checkout_type":"subscription","provider":"easebuzz"}'::jsonb WHERE id = $1`,
      [id],
    );
    return { id, txnid };
  }

  /** Easebuzz callback body hashed with the platform salt (same formula as tests/lib/platform-billing-easebuzz.test.ts). */
  function easebuzzBody(txnid: string, fields: Record<string, string>) {
    const f = {
      key: 'PLATKEY',
      txnid,
      amount: '499.00',
      productinfo: 'Khatario plan',
      firstname: 'Owner',
      email: 'owner@example.in',
      udf1: '',
      udf2: '',
      status: 'success',
      easepayid: 'EP' + randomUUID().slice(0, 8),
      ...fields,
    };
    const hash = createHash('sha512')
      .update(
        ['PLATSALT', f.status, '', '', '', '', '', '', '', '', f.udf2, f.udf1, f.email, f.firstname, f.productinfo, f.amount, f.txnid, f.key].join('|'),
      )
      .digest('hex');
    return new URLSearchParams({ ...f, hash }).toString();
  }

  beforeAll(() => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
  });

  beforeEach(async () => {
    biz = await newBusiness('t');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of created) {
        await query(
          `DELETE FROM platform_billing_webhook_events WHERE business_id = $1 OR payload::text LIKE $2`,
          [id, `%${id}%`],
        ).catch(() => undefined);
      }
      for (const id of created) {
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      for (const id of createdCoupons) {
        await query(`DELETE FROM coupons WHERE id = $1`, [id]).catch(() => undefined);
      }
      await closePool();
    }
  });

  describe('SUB-01 / SUB-31: no-payment plan requests', () => {
    it('upgrade to connect_free leaves no end date', async () => {
      const res = await upgrade(biz, { plan_id: 'connect_free' });
      expect(res.status).toBe(200);
      expect(await row(biz, 'connect')).toMatchObject({ plan_id: 'connect_free', status: 'active', end_date: null });
    });

    it('paid business cannot drop to free through upgrade', async () => {
      await setPlan(biz, 'billing', 'billing_business', { end_date: '+300 days' });
      const res = await upgrade(biz, { plan_id: 'free' });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('USE_DOWNGRADE');
      expect((await row(biz, 'billing'))!.plan_id).toBe('billing_business');
    });

    it('adding HR starts a real trial row', async () => {
      await upgrade(biz, { plan_id: 'hr_trial' });
      const r = (await row(biz, 'hr'))!;
      expect(r.status).toBe('trial');
      expect(r.trial_end_date).not.toBeNull();
      expect(r.end_date).toBeNull();
    });

    it('second HR trial request is refused', async () => {
      await upgrade(biz, { plan_id: 'hr_trial' });
      const res = await upgrade(biz, { plan_id: 'hr_trial' });
      expect(res.status).toBe(409);
      expect((await res.json()).code).toBe('TRIAL_ALREADY_USED');
    });
  });

  describe('SUB-01 part 2 / SUB-29: tier order does not depend on price', () => {
    it('cannot schedule a higher tier as a downgrade', async () => {
      await setPlan(biz, 'connect', 'connect_free');
      await expect(downgradeModuleSubscription(biz, 'connect', 'connect', { confirmed: true }))
        .rejects.toThrow('not a lower tier');
      expect((await row(biz, 'connect'))!.scheduled_plan_id).toBeNull();
    });

    it('cannot schedule a plan that is not on sale', async () => {
      await setPlan(biz, 'billing', 'business', { end_date: '+20 days' }); // Business Classic, sort 31
      await expect(downgradeModuleSubscription(biz, 'billing', 'growth', { confirmed: true })) // Growth Classic, not public
        .rejects.toThrow('not found or inactive');
    });

    it('a plan priced at 1 rupee is still bought through checkout and keeps its tier', async () => {
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_business'`);
      try {
        await setPlan(biz, 'billing', 'billing_starter', { end_date: '+20 days' });
        const up = await upgrade(biz, { plan_id: 'billing_business' });
        expect(up.status).toBe(402); // REQUIRES_CHECKOUT, not a free switch
        await expect(downgradeModuleSubscription(biz, 'billing', 'billing_business', { confirmed: true }))
          .rejects.toThrow('not a lower tier');
        const pricing = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_business', billingCycle: 'monthly' });
        expect(pricing.finalAmount).toBe(1);
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = 799 WHERE id = 'billing_business'`);
      }
    });

    it('a plan priced at 1 rupee activates after a 1 rupee payment', async () => {
      const before = await queryOne<{ p: string }>(
        `SELECT price_monthly::text AS p FROM subscription_plans WHERE id = 'billing_business'`,
      );
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_business'`);
      try {
        const tx = await pendingCheckout(biz, 'billing_business', 1);
        const r = await hook('payment.captured', 'pay_one_' + sfx(), 'captured', notesFor(biz, tx, 'billing_business'), {
          amountPaise: 100,
        });
        expect(r).toEqual({ ok: true });
        expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'billing_business', status: 'active' });
        expect((await txRow(tx))!.status).toBe('completed');
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'billing_business'`, [before!.p]);
      }
    });

    it('checkout refuses an amount below 1 rupee after a coupon', async () => {
      const code = `HALF${randomUUID().slice(0, 8).toUpperCase()}`;
      await query(`INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, 'percentage', 50, 5)`, [code]);
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_business'`);
      try {
        await setPlan(biz, 'billing', 'billing_starter', { end_date: '+20 days' });
        const res = await checkout(biz, { plan_id: 'billing_business', billing_cycle: 'monthly', coupon_code: code });
        expect(res.status).toBe(400);
        expect((await res.json()).code).toBe('AMOUNT_BELOW_MINIMUM');
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = 799 WHERE id = 'billing_business'`);
        await query(`DELETE FROM coupons WHERE code = $1`, [code]);
      }
    });
  });

  describe('SUB-05 / SUB-28: nightly job never starts an unpaid paid period', () => {
    it('due downgrade to a cheaper paid plan gets grace, not a new period', async () => {
      await setPlan(biz, 'billing', 'billing_business', { end_date: '-1 day', scheduled_plan_id: 'billing_starter' });
      await processExpiredModuleSubscriptions();
      const r = (await row(biz, 'billing'))!;
      expect(r.plan_id).toBe('billing_starter');
      expect(r.scheduled_plan_id).toBeNull();
      expect(r.end_date).toBe(await daysFromToday(-1));
      expect(r.grace_period_end).toBe(await daysFromToday(6));
      const events = await query(
        `SELECT event_type, details FROM subscription_events WHERE business_id = $1 ORDER BY created_at`,
        [biz],
      );
      expect(events.rows.filter((e: any) => e.event_type === 'grace_started')).toHaveLength(0);
      expect(events.rows.find((e: any) => e.event_type === 'downgraded')?.details).toMatchObject({ awaiting_payment: true });
    });

    it('due downgrade to free lands on free with no end date', async () => {
      await setPlan(biz, 'billing', 'billing_business', { end_date: '-1 day', scheduled_plan_id: 'free' });
      await processExpiredModuleSubscriptions();
      expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'free', end_date: null, grace_period_end: null });
    });

    it('a payment that lands before the update is not overwritten', async () => {
      await setPlan(biz, 'billing', 'billing_growth', { end_date: '-9 days', grace_period_end: '-1 day' });
      // simulate the payment between select and update
      await applyModuleSubscriptionPlanChange({ businessId: biz, moduleKey: 'billing', planId: 'billing_growth', billingCycle: 'monthly' });
      const changed = await moveModuleSubscriptionToFree(biz, 'billing', 'billing_growth', 'grace_expired', 'grace_expired');
      expect(changed).toBe(false);
      expect((await row(biz, 'billing'))!.plan_id).toBe('billing_growth');
    });

    it('migration 477 clears end dates on free plans', async () => {
      await setPlan(biz, 'billing', 'free', { end_date: '-1 day' });
      await query(readFileSync('database/migrations/477_free_plan_no_end_date_addon_period.sql', 'utf8'));
      expect((await row(biz, 'billing'))!.end_date).toBeNull();
      expect((await getOperationalModuleSubscriptions(biz, true)).length).toBeGreaterThan(0);
    });
  });

  describe('SUB-04: the AI add-on has a paid period', () => {
    it('first payment gives one month', async () => {
      await payAddon(biz);
      const a = (await addon(biz))!;
      expect(a.status).toBe('active');
      expect(a.end_date).toBe(await monthsFromToday(1));
      expect(a.start_date).toBe(await daysFromToday(0));
    });

    it('second payment extends from the current end date', async () => {
      await payAddon(biz);
      await payAddon(biz);
      const a = (await addon(biz))!;
      expect(a.end_date).toBe(await monthsFromToday(2));
      expect(a.start_date).toBe(await daysFromToday(0));
    });

    it('job expires an ended add-on and the quota drops', async () => {
      await payAddon(biz);
      expect(await khatarioMonthlyQuota(biz)).toBe(3000);
      await query(`UPDATE whatsapp_addons SET end_date = CURRENT_DATE - 1 WHERE business_id = $1`, [biz]);
      const counts = await processExpiredModuleSubscriptions();
      expect(counts.addonsExpired).toBeGreaterThanOrEqual(1);
      expect((await addon(biz))!.status).toBe('expired');
      expect(await khatarioMonthlyQuota(biz)).toBe(0);
    });

    it('an add-on still in its period is not expired by the job', async () => {
      await payAddon(biz);
      await processExpiredModuleSubscriptions();
      expect((await addon(biz))!.status).toBe('active');
    });

    it('paying again after expiry restarts the period from today', async () => {
      await payAddon(biz);
      await query(`UPDATE whatsapp_addons SET end_date = CURRENT_DATE - 10, start_date = CURRENT_DATE - 40 WHERE business_id = $1`, [biz]);
      await processExpiredModuleSubscriptions();
      expect((await addon(biz))!.status).toBe('expired');
      await payAddon(biz);
      const a = (await addon(biz))!;
      expect(a.status).toBe('active');
      expect(a.start_date).toBe(await daysFromToday(0));
      expect(a.end_date).toBe(await monthsFromToday(1));
    });

    it('migration 477 gives an open-ended active add-on 30 days and leaves dated ones alone', async () => {
      const other = await newBusiness('addon-dated');
      await query(
        `INSERT INTO whatsapp_addons (business_id, addon_type, status, price_monthly, start_date, end_date)
         VALUES ($1, 'khatario_ai', 'active', 299, CURRENT_DATE, NULL)`,
        [biz],
      );
      await query(
        `INSERT INTO whatsapp_addons (business_id, addon_type, status, price_monthly, start_date, end_date)
         VALUES ($1, 'khatario_ai', 'active', 299, CURRENT_DATE, CURRENT_DATE + 5)`,
        [other],
      );
      await query(readFileSync('database/migrations/477_free_plan_no_end_date_addon_period.sql', 'utf8'));
      expect((await addon(biz))!.end_date).toBe(await daysFromToday(30));
      expect((await addon(other))!.end_date).toBe(await daysFromToday(5));
    });
  });

  describe('SUB-02: a failed attempt does not close the checkout', () => {
    it('failed attempt then captured payment activates the plan', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = notesFor(biz, tx, 'billing_growth');
      expect(await hook('payment.failed', 'pay_f1_' + sfx(), 'failed', notes)).toEqual({ ok: true });
      expect((await txRow(tx))!.status).toBe('pending');
      expect(await eventFor(tx)).toMatchObject({ status: 'processed', processing_notes: 'Attempt failed; checkout still open' });
      expect(await hook('payment.captured', 'pay_ok1_' + sfx(), 'captured', notes)).toEqual({ ok: true });
      expect((await txRow(tx))!.status).toBe('completed');
      expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'billing_growth', status: 'active' });
    });

    it('success after the link was cancelled still activates', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = notesFor(biz, tx, 'billing_growth');
      await hook('payment_link.cancelled', 'c1_' + sfx(), 'cancelled', notes);
      expect((await txRow(tx))!.status).toBe('failed');
      await hook('payment.captured', 'pay_ok2_' + sfx(), 'captured', notes);
      expect((await row(biz, 'billing'))!.plan_id).toBe('billing_growth');
      expect((await txRow(tx))!.status).toBe('completed');
    });

    it('expired link closes a pending checkout; a second expiry on a failed row does not throw', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = notesFor(biz, tx, 'billing_growth');
      expect(await hook('payment_link.expired', 'e1_' + sfx(), 'expired', notes)).toEqual({ ok: true });
      expect((await txRow(tx))!.status).toBe('failed');
      expect(await hook('payment_link.cancelled', 'c2_' + sfx(), 'cancelled', notes)).toEqual({ ok: true });
      expect((await txRow(tx))!.status).toBe('failed');
      expect((await eventFor(tx))!.status).toBe('processed');
    });

    it('cancel after completion leaves the row completed', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = notesFor(biz, tx, 'billing_growth');
      await hook('payment.captured', 'pay_ok3_' + sfx(), 'captured', notes);
      expect(await hook('payment_link.cancelled', 'c3_' + sfx(), 'cancelled', notes)).toEqual({ ok: true });
      expect((await txRow(tx))!.status).toBe('completed');
    });
  });
  describe('SUB-03 / SUB-27 / SUB-26: completion is one transaction and events can be reprocessed', () => {
    it('captured and link-paid at the same instant activate once', async () => {
      const coupon = await makeCoupon({ type: 'percentage', value: 10, max_redemptions: 5 });
      const tx = await pendingCheckout(biz, 'billing_growth', 499, { couponId: coupon, discount: 49.9 });
      const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
      const results = await Promise.all([
        hook('payment.captured', 'pay_r1', 'captured', notes, { amountPaise: 44910 }),
        hook('payment_link.paid', 'pay_r1', 'captured', notes, { amountPaise: 44910, withLink: true }),
      ]);
      expect(results.every((r) => r.ok)).toBe(true);
      expect(results.filter((r) => r.duplicate)).toHaveLength(1);
      expect(await count(`coupon_redemptions WHERE coupon_id = $1`, [coupon])).toBe(1);
      expect(await count(`subscription_events WHERE business_id = $1 AND event_type = 'upgraded'`, [biz])).toBe(1);
    });

    it('a failure during activation leaves the payment pending and the event retryable', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
      const spy = jest.spyOn(planChange, 'applyModuleSubscriptionPlanChange').mockRejectedValueOnce(new Error('boom'));
      await expect(hook('payment.captured', 'pay_e1', 'captured', notes)).rejects.toThrow('boom');
      expect((await txRow(tx))!.status).toBe('pending');
      expect(await eventFor(tx)).toMatchObject({ status: 'error', processing_notes: 'boom' });
      spy.mockRestore();
      expect(await hook('payment.captured', 'pay_e1', 'captured', notes)).toEqual({ ok: true });
      expect((await row(biz, 'billing'))!.plan_id).toBe('billing_growth');
    });

    it('wrong amount does not activate', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' };
      const r = await hook('payment.captured', 'pay_a1', 'captured', notes, { amountPaise: 100 });
      expect(r).toMatchObject({ ok: false, error: 'Amount mismatch' });
      expect(await row(biz, 'billing')).toBeNull();
      expect((await txRow(tx))!.status).toBe('pending');
    });

    it('plan comes from the stored row, not from notes', async () => {
      const tx = await pendingCheckout(biz, 'billing_starter', 299);
      await hook('payment.captured', 'pay_n1', 'captured',
        { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_business', billing_cycle: 'three_year' }, { amountPaise: 29900 });
      expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'billing_starter', billing_cycle: 'monthly' });
    });

    it('route answers 422 for an amount mismatch and 500 when processing throws', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = notesFor(biz, tx, 'billing_growth');
      const post = (event: string, payId: string, amount: number) => {
        const raw = JSON.stringify({ event, payload: { payment: { entity: { id: payId, status: 'captured', amount, notes } } } });
        const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
        return razorpayWebhookPost(
          new NextRequest('http://localhost/api/webhooks/platform-billing/razorpay', {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig },
            body: raw,
          }),
        );
      };
      expect((await post('payment.captured', 'pay_rt1_' + sfx(), 100)).status).toBe(422);
      const spy = jest.spyOn(planChange, 'applyModuleSubscriptionPlanChange').mockRejectedValueOnce(new Error('boom'));
      jest.spyOn(console, 'error').mockImplementationOnce(() => undefined);
      const res = await post('payment.captured', 'pay_rt2_' + sfx(), 49900);
      spy.mockRestore();
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Webhook processing failed' });
      expect((await txRow(tx))!.status).toBe('pending');
    });

    it('a cancel whose notes name another business does not touch the row', async () => {
      const other = await newBusiness('other');
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      expect(await hook('payment_link.cancelled', 'cx_' + sfx(), 'cancelled', notesFor(other, tx, 'billing_growth'))).toEqual({ ok: true });
      expect((await txRow(tx))!.status).toBe('pending');
    });

    it('Easebuzz: a failure callback on a row that is already failed changes nothing', async () => {
      const { id, txnid } = await pendingEasebuzzCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'failed' WHERE id = $1`, [id]);
      const r = await processPlatformEasebuzzCallback(easebuzzBody(txnid, { status: 'failure' }));
      expect(r).toMatchObject({ ok: true, outcome: 'failed' });
      expect((await txRow(id))!.status).toBe('failed');
      expect(await eventFor(id)).toMatchObject({ status: 'processed', processing_notes: 'Checkout already failed; no status change' });
    });

    it('Easebuzz: success activates from the stored row once; a repeat is not an error', async () => {
      const { id, txnid } = await pendingEasebuzzCheckout(biz, 'billing_growth', 499);
      const body = easebuzzBody(txnid, {});
      expect(await processPlatformEasebuzzCallback(body)).toMatchObject({ ok: true, outcome: 'paid' });
      expect((await txRow(id))!.status).toBe('completed');
      expect(await row(biz, 'billing')).toMatchObject({ plan_id: 'billing_growth', status: 'active' });
      expect(await processPlatformEasebuzzCallback(body)).toMatchObject({ ok: true });
      expect(await count(`subscription_events WHERE business_id = $1 AND event_type = 'upgraded'`, [biz])).toBe(1);
    });

    it('Easebuzz: a failure during activation marks the event error and a redelivery activates', async () => {
      const { id, txnid } = await pendingEasebuzzCheckout(biz, 'billing_growth', 499);
      const body = easebuzzBody(txnid, {});
      const spy = jest.spyOn(planChange, 'applyModuleSubscriptionPlanChange').mockRejectedValueOnce(new Error('boom'));
      await expect(processPlatformEasebuzzCallback(body)).rejects.toThrow('boom');
      spy.mockRestore();
      expect((await txRow(id))!.status).toBe('pending');
      expect(await eventFor(id)).toMatchObject({ status: 'error', processing_notes: 'boom' });
      expect(await processPlatformEasebuzzCallback(body)).toMatchObject({ ok: true, outcome: 'paid' });
      expect((await row(biz, 'billing'))!.plan_id).toBe('billing_growth');
    });

    it('add-on checkout: two events for the same payment grant one month', async () => {
      const { id: tx } = await recordBillingTransaction({
        businessId: biz,
        planId: 'connect',
        moduleKey: 'connect',
        amount: 499,
        billingCycle: 'monthly',
        paymentMethod: 'razorpay',
        status: 'pending',
        skipEmails: true,
      });
      const notes = { business_id: biz, billing_transaction_id: tx, checkout_type: 'whatsapp_addon', addon_type: 'whatsapp_bot', plan_id: 'connect' };
      const results = await Promise.all([
        hook('payment.captured', 'pay_ad_' + tx.slice(0, 8), 'captured', notes),
        hook('payment_link.paid', 'pay_ad_' + tx.slice(0, 8), 'captured', notes, { withLink: true }),
      ]);
      expect(results.every((r) => r.ok)).toBe(true);
      expect((await txRow(tx))!.status).toBe('completed');
      expect((await row(biz, 'connect'))!.end_date).toBe(
        (await queryOne<{ d: string }>(`SELECT (CURRENT_DATE + INTERVAL '1 month')::date::text AS d`))!.d,
      );
      expect(
        await completeAddonCheckoutPayment({ businessId: biz, addonType: 'whatsapp_bot', billingTransactionId: tx, amount: 499 }),
      ).toBe('already_completed');
    });

    it('add-on checkout refuses a billing row of another business', async () => {
      const other = await newBusiness('other-addon');
      const { id: tx } = await recordBillingTransaction({
        businessId: other,
        planId: 'connect',
        moduleKey: 'connect',
        amount: 499,
        billingCycle: 'monthly',
        paymentMethod: 'razorpay',
        status: 'pending',
        skipEmails: true,
      });
      await expect(
        completeAddonCheckoutPayment({ businessId: biz, addonType: 'whatsapp_bot', billingTransactionId: tx, amount: 499 }),
      ).rejects.toThrow('CHECKOUT_TRANSACTION_NOT_FOUND');
      expect((await txRow(tx))!.status).toBe('pending');
      expect(await row(biz, 'connect')).toBeNull();
    });
  });
  describe('Task 5 fix round 1: failure writes are guarded by the row status', () => {
    /** Lock the row on a separate connection, set it completed (uncommitted), run fn, then commit. */
    async function completeUnderneath<T>(txId: string, fn: () => Promise<T>): Promise<T> {
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT id FROM billing_transactions WHERE id = $1 FOR UPDATE`, [txId]);
        await client.query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [txId]);
        const pending = fn();
        pending.catch(() => undefined);
        await new Promise((r) => setTimeout(r, 200));
        await client.query('COMMIT');
        return await pending;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      } finally {
        client.release();
      }
    }

    async function eventByPayment(payId: string) {
      return queryOne<{ status: string; processing_notes: string | null }>(
        `SELECT status, processing_notes FROM platform_billing_webhook_events WHERE payload::text LIKE $1 ORDER BY created_at DESC LIMIT 1`,
        [`%${payId}%`],
      );
    }

    it('a cancel that lands after a completed payment cannot reopen the checkout', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = notesFor(biz, tx, 'billing_growth');
      const payId = 'pay_cr_' + sfx();
      expect(await hook('payment.captured', payId, 'captured', notes)).toEqual({ ok: true });
      expect(await hook('payment_link.cancelled', 'cr_' + sfx(), 'cancelled', notes)).toEqual({ ok: true });
      expect((await txRow(tx))!.status).toBe('completed');
      expect((await hook('payment_link.paid', payId, 'captured', notes, { withLink: true })).ok).toBe(true);
      expect(await count(`subscription_events WHERE business_id = $1 AND event_type = 'upgraded'`, [biz])).toBe(1);
    });

    it('a cancel racing a completion does not overwrite completed or send a failure', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const notes = notesFor(biz, tx, 'billing_growth');
      const r = await completeUnderneath(tx, () => hook('payment_link.cancelled', 'crace_' + sfx(), 'cancelled', notes));
      expect(r.ok).toBe(true);
      expect((await txRow(tx))!.status).toBe('completed');
      expect(await count(`subscription_events WHERE business_id = $1 AND event_type = 'payment_failed'`, [biz])).toBe(0);
    });

    it('Easebuzz: a failure racing a completion does not overwrite completed', async () => {
      const { id, txnid } = await pendingEasebuzzCheckout(biz, 'billing_growth', 499);
      const r = await completeUnderneath(id, () => processPlatformEasebuzzCallback(easebuzzBody(txnid, { status: 'failure' })));
      expect(r.ok).toBe(true);
      expect((await txRow(id))!.status).toBe('completed');
      expect(await count(`subscription_events WHERE business_id = $1 AND event_type = 'payment_failed'`, [biz])).toBe(0);
    });

    it('updateBillingTransactionStatus refuses to write when the row changed underneath it', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await expect(completeUnderneath(tx, () => updateBillingTransactionStatus(tx, 'failed'))).rejects.toMatchObject({
        name: 'BillingTransactionStateError',
        code: 'INVALID_STATUS_TRANSITION',
      });
      expect((await txRow(tx))!.status).toBe('completed');
      expect(await count(`subscription_events WHERE business_id = $1 AND event_type = 'payment_failed'`, [biz])).toBe(0);
    });

    it('a success event for a row owned by another business is ignored, not retried', async () => {
      const other = await newBusiness('foreign-notes');
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const payId = 'pay_fx_' + sfx();
      const r = await hook('payment.captured', payId, 'captured', notesFor(other, tx, 'billing_growth'));
      expect(r).toMatchObject({ ok: true, error: expect.any(String) });
      expect((await eventByPayment(payId))!.status).toBe('ignored');
      expect((await txRow(tx))!.status).toBe('pending');
      expect(await row(other, 'billing')).toBeNull();
    });

    it('a success event for a refunded row is ignored, not retried', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'refunded' WHERE id = $1`, [tx]);
      const payId = 'pay_rf_' + sfx();
      const r = await hook('payment.captured', payId, 'captured', notesFor(biz, tx, 'billing_growth'));
      expect(r).toMatchObject({ ok: true, error: expect.any(String) });
      expect((await eventByPayment(payId))!.status).toBe('ignored');
      expect((await txRow(tx))!.status).toBe('refunded');
      expect(await row(biz, 'billing')).toBeNull();
    });

    it('an add-on success for a row owned by another business is ignored, not retried', async () => {
      const other = await newBusiness('foreign-addon');
      const { id: tx } = await recordBillingTransaction({
        businessId: biz, planId: 'connect', moduleKey: 'connect', amount: 499,
        billingCycle: 'monthly', paymentMethod: 'razorpay', status: 'pending', skipEmails: true,
      });
      const payId = 'pay_fa_' + sfx();
      const r = await hook('payment.captured', payId, 'captured',
        { business_id: other, billing_transaction_id: tx, checkout_type: 'whatsapp_addon', addon_type: 'whatsapp_bot' });
      expect(r).toMatchObject({ ok: true, error: expect.any(String) });
      expect((await eventByPayment(payId))!.status).toBe('ignored');
      expect((await txRow(tx))!.status).toBe('pending');
      expect(await row(other, 'connect')).toBeNull();
    });
  });
  describe('SUB-03: daily report of payments recorded but not applied', () => {
    const ids = (l: { billing_transaction_id: string }[]) => l.map((p) => p.billing_transaction_id);
    const insertedEvents: string[] = [];

    async function insertEvent(status: string, ageMinutes: number): Promise<string> {
      const r = await queryOne<{ id: string }>(
        `INSERT INTO platform_billing_webhook_events (provider, idempotency_key, event_type, status, created_at)
         VALUES ('razorpay', $1, 'payment.captured', $2, CURRENT_TIMESTAMP - ($3::int * INTERVAL '1 minute'))
         RETURNING id`,
        ['t6-' + randomUUID(), status, ageMinutes],
      );
      insertedEvents.push(r!.id);
      return r!.id;
    }

    afterAll(async () => {
      for (const id of insertedEvents) {
        await query(`DELETE FROM platform_billing_webhook_events WHERE id = $1`, [id]).catch(() => undefined);
      }
    });

    beforeEach(() => {
      (sendPlatformAdminPush as jest.Mock).mockClear();
    });

    it('finds a completed payment whose plan was never applied', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);
      expect(ids(await findUnappliedPayments())).toContain(tx);
    });

    it('does not report a payment that was applied', async () => {
      const tx = await paidAndActivated(biz, 'billing_growth');
      expect(ids(await findUnappliedPayments())).not.toContain(tx);
    });

    it('does not report an older payment superseded by a later plan change', async () => {
      const old = await paidAndActivated(biz, 'billing_starter');
      await paidAndActivated(biz, 'billing_growth');
      expect(ids(await findUnappliedPayments())).not.toContain(old);
    });

    it('reports a payment whose module row is older and on a different plan', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);
      await setPlan(biz, 'billing', 'billing_starter');
      await query(
        `UPDATE business_module_subscriptions SET updated_at = CURRENT_TIMESTAMP - INTERVAL '1 hour' WHERE business_id = $1`,
        [biz],
      );
      expect(ids(await findUnappliedPayments())).toContain(tx);
    });

    it('does not report add-on checkouts, zero amounts or payments older than 35 days', async () => {
      const addon = await pendingCheckout(biz, 'billing_growth', 499);
      await query(
        `UPDATE billing_transactions SET status = 'completed', gateway_response = '{"checkout_type":"whatsapp_addon"}'::jsonb WHERE id = $1`,
        [addon],
      );
      const zero = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed', total_amount = 0 WHERE id = $1`, [zero]);
      const old = await pendingCheckout(biz, 'billing_growth', 499);
      // A trigger stamps updated_at on every UPDATE; skip triggers for this one backdating write.
      const client = await getPool().connect();
      try {
        await client.query('BEGIN');
        await client.query(`SET LOCAL session_replication_role = replica`);
        await client.query(
          `UPDATE billing_transactions SET status = 'completed', updated_at = CURRENT_TIMESTAMP - INTERVAL '40 days' WHERE id = $1`,
          [old],
        );
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw e;
      } finally {
        client.release();
      }
      const found = ids(await findUnappliedPayments());
      expect(found).not.toContain(addon);
      expect(found).not.toContain(zero);
      expect(found).not.toContain(old);
    });

    it('finds webhook events stuck in received or error, not fresh or processed ones', async () => {
      const stuckReceived = await insertEvent('received', 30);
      const stuckError = await insertEvent('error', 30);
      const fresh = await insertEvent('received', 0);
      const done = await insertEvent('processed', 30);
      const found = (await findStuckWebhookEvents()).map((e) => e.id);
      expect(found).toContain(stuckReceived);
      expect(found).toContain(stuckError);
      expect(found).not.toContain(fresh);
      expect(found).not.toContain(done);
    });

    it('reportBillingAnomalies pushes once and changes no data', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);
      const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const r = await reportBillingAnomalies();
      err.mockRestore();
      expect(r.unapplied).toBeGreaterThanOrEqual(1);
      expect(sendPlatformAdminPush).toHaveBeenCalledTimes(1);
      expect(sendPlatformAdminPush).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'incident', title: 'Billing: payments need attention', url: '/admin/billing' }),
      );
      expect((await txRow(tx))!.status).toBe('completed');
      expect(await row(biz, 'billing')).toBeNull();
    });

    it('reportBillingAnomalies never throws when the push fails', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);
      (sendPlatformAdminPush as jest.Mock).mockRejectedValueOnce(new Error('push down'));
      const err = jest.spyOn(console, 'error').mockImplementation(() => undefined);
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      await expect(reportBillingAnomalies()).resolves.toMatchObject({ unapplied: expect.any(Number) });
      err.mockRestore();
      warn.mockRestore();
    });
  });
});
