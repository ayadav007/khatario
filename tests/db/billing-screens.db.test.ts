/**
 * Billing screens and wording (plan 2026-11-27, Task A) against real PostgreSQL: the checkout status
 * route, the plans a business may be offered, refusal of a plan not on sale, who may see billing, and
 * the debug routes. Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/billing-screens.db.test.ts --runInBand --forceExit
 * No real gateway call: the hosted-link call is stubbed and the webhooks are signed locally.
 */
import { createHash, createHmac, randomUUID } from 'crypto';

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
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { NextRequest, NextResponse } from 'next/server';
import { readFileSync } from 'fs';
import { join } from 'path';
import { query, queryOne, closePool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { processPlatformRazorpayWebhook, recordBillingTransaction } from '@/lib/platform-billing';
import { createSubscriptionCheckout } from '@/lib/platform-subscription-checkout';
import { createAddonCheckout } from '@/lib/platform-addon-checkout';
import { RazorpayPaymentProvider } from '@/lib/payments/providers/razorpay-payment-provider';
import { handleEasebuzzCallback } from '@/lib/payments/easebuzz-callback';
import { requirePlatformRequest } from '@/lib/platform-request-auth';
import { GET as statusGet } from '@/app/api/subscriptions/checkout/status/route';
import { GET as plansGet } from '@/app/api/subscriptions/plans/route';
import { POST as upgradePost } from '@/app/api/subscriptions/upgrade/route';
import { POST as checkoutPost } from '@/app/api/subscriptions/checkout/route';
import { GET as previewGet } from '@/app/api/subscriptions/checkout/preview/route';
import { GET as historyGet } from '@/app/api/subscriptions/billing-history/route';
import { GET as receiptGet } from '@/app/api/subscriptions/receipts/[id]/route';
import { GET as modulesCurrentGet } from '@/app/api/subscriptions/modules/current/route';
import { GET as currentGet } from '@/app/api/subscriptions/current/route';
import { GET as debugGet } from '@/app/api/subscriptions/debug/route';
import { GET as addonsDebugGet } from '@/app/api/subscriptions/addons/debug/route';
import { GET as featurePlanGet } from '@/app/api/subscriptions/feature-plan/route';
import { PLAN_NOT_ON_SALE_MESSAGE } from '@/lib/subscription/plan-offer-rules';
import type { BillingCycle } from '@/lib/subscription/apply-plan-change';

const run = enabled ? describe : describe.skip;

run('billing screens (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  let biz: string;
  const ownerOf = new Map<string, string>();

  // ---- helpers ----

  async function newBusiness(label = 'scr'): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Screens ${label} ${id.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [id]);
    const ownerId = randomUUID();
    ownerOf.set(id, ownerId);
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [ownerId, id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
    );
    return id;
  }

  async function newStaff(businessId: string, roleKey?: string): Promise<string> {
    const id = randomUUID();
    let roleId: string | null = null;
    if (roleKey) {
      const role = await queryOne<{ id: string }>(
        `INSERT INTO user_roles (business_id, role_name, role_key, is_system_role) VALUES ($1, $2, $2, false)
         ON CONFLICT (business_id, role_key) DO UPDATE SET role_name = EXCLUDED.role_name RETURNING id`,
        [businessId, roleKey],
      );
      roleId = role!.id;
    }
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin, role_id) VALUES ($1, $2, 'Staff', $3, false, $4)`,
      [id, businessId, `8${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`, roleId],
    );
    return id;
  }

  /** Put a module row into a known state; dates are day offsets from the database's today. */
  async function setRow(
    businessId: string,
    planId: string,
    opts: { module?: string; status?: string; startOffset?: number; endOffset?: number | null; cycle?: BillingCycle; scheduled?: string | null } = {},
  ): Promise<void> {
    await query(
      `INSERT INTO business_module_subscriptions
         (business_id, module_key, plan_id, status, start_date, end_date, billing_cycle, scheduled_plan_id)
       VALUES ($1, $2, $3, $4, CURRENT_DATE + $5::int,
               CASE WHEN $6::int IS NULL THEN NULL ELSE CURRENT_DATE + $6::int END, $7, $8)
       ON CONFLICT (business_id, module_key) DO UPDATE SET
         plan_id = EXCLUDED.plan_id, status = EXCLUDED.status, start_date = EXCLUDED.start_date,
         end_date = EXCLUDED.end_date, billing_cycle = EXCLUDED.billing_cycle,
         scheduled_plan_id = EXCLUDED.scheduled_plan_id, grace_period_end = NULL, trial_end_date = NULL,
         updated_at = CURRENT_TIMESTAMP`,
      [
        businessId,
        opts.module ?? 'billing',
        planId,
        opts.status ?? 'active',
        opts.startOffset ?? 0,
        opts.endOffset === undefined ? 30 : opts.endOffset,
        opts.cycle ?? 'monthly',
        opts.scheduled ?? null,
      ],
    );
    clearSubscriptionCache(businessId);
    clearModuleSubscriptionCache(businessId);
  }

  const asOwner = (businessId: string) => ({
    'x-authenticated-business-id': businessId,
    'x-authenticated-user-id': ownerOf.get(businessId)!,
  });
  const asUser = (businessId: string, userId: string) => ({
    'x-authenticated-business-id': businessId,
    'x-authenticated-user-id': userId,
  });

  const get = (url: string, headers: Record<string, string>) => new NextRequest(`http://localhost${url}`, { headers });
  const post = (url: string, body: unknown, headers: Record<string, string>) =>
    new NextRequest(`http://localhost${url}`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json', ...headers },
    });

  async function pendingCheckout(
    businessId: string,
    planId: string,
    amount: number,
    opts: { cycle?: BillingCycle; addon?: string } = {},
  ): Promise<string> {
    const { id } = await recordBillingTransaction({
      businessId,
      planId,
      amount,
      billingCycle: opts.cycle ?? 'monthly',
      paymentMethod: 'razorpay',
      status: 'pending',
      skipEmails: true,
    });
    await query(`UPDATE billing_transactions SET gateway_response = $2::jsonb WHERE id = $1`, [
      id,
      JSON.stringify(
        opts.addon
          ? { checkout_type: 'whatsapp_addon', addon_type: opts.addon, provider: 'razorpay' }
          : { checkout_type: 'subscription', provider: 'razorpay' },
      ),
    ]);
    return id;
  }

  const sfx = () => randomUUID().slice(0, 10);

  function hook(event: string, payId: string, payStatus: string, notes: Record<string, unknown>, amountPaise: number) {
    const raw = JSON.stringify({ event, payload: { payment: { entity: { id: payId, status: payStatus, amount: amountPaise, notes } } } });
    const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
    return processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': sig });
  }

  async function statusOf(businessId: string, tx: string | null) {
    const res = await statusGet(get(`/api/subscriptions/checkout/status${tx === null ? '' : `?tx=${encodeURIComponent(tx)}`}`, asOwner(businessId)));
    return { status: res.status, body: await res.json() };
  }

  async function plansFor(businessId: string | null, qs = '') {
    const res = await plansGet(get(`/api/subscriptions/plans${qs}`, businessId ? asOwner(businessId) : {}));
    expect(res.status).toBe(200);
    const body = await res.json();
    return body.plans as Array<{ id: string; display_name: string; product_line: string; offer: { on_sale: boolean; current: boolean; renewable: boolean; selectable: boolean } }>;
  }
  const byId = (plans: Array<{ id: string }>, id: string) => plans.find((p) => p.id === id);

  beforeAll(async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
    // The checkout tables carry the columns this file reads (period_end and the add-on rows).
    for (const f of ['480_subscription_tax_and_refunds.sql', '481_subscription_tax.sql']) {
      await query(readFileSync(join(process.cwd(), 'database/migrations', f), 'utf8'));
    }
  });

  beforeEach(async () => {
    biz = await newBusiness();
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of created) {
        await query(`DELETE FROM platform_billing_webhook_events WHERE business_id = $1 OR payload::text LIKE $2`, [id, `%${id}%`]).catch(() => undefined);
        await query(`DELETE FROM subscription_events WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      await closePool();
    }
  });

  // ---- 1. success screen from the server (SUB-10) ----

  describe('checkout status route', () => {
    it('a pending checkout is pending, with the plan name and never the plan id', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const { status, body } = await statusOf(biz, tx);
      expect(status).toBe(200);
      expect(body).toMatchObject({ status: 'pending', kind: 'subscription', plan_name: 'Growth', shortened_days: null, period_end: null });
      expect(JSON.stringify(body)).not.toContain('billing_growth');
    });

    it('a payment completed through the signed webhook is completed, with the period end the server stored', async () => {
      await setRow(biz, 'billing_starter', { startOffset: -5, endOffset: 25 });
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      const r = await hook('payment.captured', 'pay_scr_' + sfx(), 'captured',
        { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' }, 49900);
      expect(r).toMatchObject({ ok: true });
      const { status, body } = await statusOf(biz, tx);
      expect(status).toBe(200);
      const row = await queryOne<{ period_end: string }>(`SELECT period_end::text FROM billing_transactions WHERE id = $1`, [tx]);
      expect(body).toMatchObject({ status: 'completed', plan_name: 'Growth', period_end: row!.period_end, shortened_days: null });
      expect(row!.period_end).toBeTruthy();
    });

    it('a closed-as-failed payment is failed', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'failed' WHERE id = $1`, [tx]);
      expect((await statusOf(biz, tx)).body).toMatchObject({ status: 'failed', period_end: null });
    });

    it('one failed attempt on Razorpay leaves the checkout open: the screen keeps waiting, it does not say failed', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await hook('payment.failed', 'pay_scr_' + sfx(), 'failed',
        { business_id: biz, billing_transaction_id: tx, plan_id: 'billing_growth', billing_cycle: 'monthly' }, 49900);
      expect((await statusOf(biz, tx)).body).toMatchObject({ status: 'pending' });
    });

    it('a pending link older than its 24 hours is expired; a fresh one is still pending', async () => {
      const old = await pendingCheckout(biz, 'billing_growth', 499);
      const fresh = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET created_at = now() - interval '25 hours' WHERE id = $1`, [old]);
      expect((await statusOf(biz, old)).body.status).toBe('expired');
      expect((await statusOf(biz, fresh)).body.status).toBe('pending');
    });

    it('a stale upgrade credit that shortened the period reports the days bought', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(
        `UPDATE billing_transactions SET status = 'completed', period_end = CURRENT_DATE + 20,
           metadata = jsonb_build_object('upgrade_credit', jsonb_build_object('rejected', 'expired', 'shortened_days', 20))
         WHERE id = $1`,
        [tx],
      );
      expect((await statusOf(biz, tx)).body).toMatchObject({ status: 'completed', shortened_days: 20 });
    });

    it('a pending payment never reports shortened days', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET metadata = jsonb_build_object('upgrade_credit', jsonb_build_object('shortened_days', 9)) WHERE id = $1`, [tx]);
      expect((await statusOf(biz, tx)).body).toMatchObject({ status: 'pending', shortened_days: null });
    });

    it('a refunded payment says refunded', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'refunded' WHERE id = $1`, [tx]);
      expect((await statusOf(biz, tx)).body.status).toBe('refunded');
    });

    it('an add-on checkout is kind addon with its label', async () => {
      const tx = await pendingCheckout(biz, 'connect', 299, { addon: 'khatario_ai' });
      expect((await statusOf(biz, tx)).body).toMatchObject({ status: 'pending', kind: 'addon', addon_label: 'Khatario AI' });
    });

    it('a payment of another business answers 404, exactly like one that does not exist', async () => {
      const other = await newBusiness('other');
      const tx = await pendingCheckout(other, 'billing_growth', 499);
      const asOther = await statusOf(other, tx);
      expect(asOther.status).toBe(200);
      const mine = await statusOf(biz, tx);
      const missing = await statusOf(biz, randomUUID());
      expect(mine.status).toBe(404);
      expect(mine.body).toEqual(missing.body);
    });

    it('a missing or malformed payment id is 404 and no session is 401', async () => {
      expect((await statusOf(biz, null)).status).toBe(404);
      expect((await statusOf(biz, 'not-a-uuid')).status).toBe(404);
      expect((await statusOf(biz, "' OR 1=1 --")).status).toBe(404);
      const res = await statusGet(get('/api/subscriptions/checkout/status?tx=' + randomUUID(), {}));
      expect(res.status).toBe(401);
    });

    it('a refund row is not a checkout payment (404)', async () => {
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET type = 'refund' WHERE id = $1`, [tx]);
      expect((await statusOf(biz, tx)).status).toBe(404);
    });

    it('the business comes from the session, not the query string', async () => {
      const other = await newBusiness('other2');
      const tx = await pendingCheckout(other, 'billing_growth', 499);
      const res = await statusGet(get(`/api/subscriptions/checkout/status?tx=${tx}&business_id=${other}`, asOwner(biz)));
      expect(res.status).toBe(404);
    });
  });

  describe('return URLs carry the payment id', () => {
    it('the subscription return URL has the payment id and no plan id or name', async () => {
      const spy = jest
        .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
        .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
      try {
        const r = await createSubscriptionCheckout({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly' });
        const input = spy.mock.calls[0][0] as { returnUrl: string; metadata: { cancel_url: string } };
        expect(input.returnUrl).toContain(`tx=${r.billingTransactionId}`);
        expect(input.returnUrl).not.toMatch(/plan=|billing_growth|Growth/);
        expect(input.metadata.cancel_url).toContain(`tx=${r.billingTransactionId}`);
        // The id in the URL answers the status route for this business.
        expect((await statusOf(biz, r.billingTransactionId)).body).toMatchObject({ status: 'pending', plan_name: 'Growth' });
      } finally {
        spy.mockRestore();
      }
    });

    it('the add-on return URL has the payment id', async () => {
      const spy = jest
        .spyOn(RazorpayPaymentProvider.prototype, 'createHostedPaymentLink')
        .mockResolvedValue({ provider: 'razorpay', providerPaymentId: 'plink_' + sfx(), paymentUrl: 'https://rzp.io/x' });
      try {
        const r = await createAddonCheckout({ businessId: biz, addonType: 'whatsapp_bot' });
        const input = spy.mock.calls[0][0] as { returnUrl: string };
        expect(input.returnUrl).toContain('addon=success');
        expect(input.returnUrl).toContain(`tx=${r.billingTransactionId}`);
        expect(input.returnUrl).not.toContain('type=');
      } finally {
        spy.mockRestore();
      }
    });

    function easebuzzBody(txnid: string, fields: Record<string, string>) {
      const f = {
        key: 'PLATKEY', txnid, amount: '499.00', productinfo: 'Khatario plan', firstname: 'Owner',
        email: 'owner@example.in', udf1: '', udf2: '', status: 'success', easepayid: 'EP' + randomUUID().slice(0, 8), ...fields,
      };
      const hash = createHash('sha512')
        .update(['PLATSALT', f.status, '', '', '', '', '', '', '', '', f.udf2, f.udf1, f.email, f.firstname, f.productinfo, f.amount, f.txnid, f.key].join('|'))
        .digest('hex');
      return new URLSearchParams({ ...f, hash }).toString();
    }
    async function pendingEasebuzz(businessId: string, addon?: string) {
      const txnid = `PB-${randomUUID().replace(/-/g, '').slice(0, 20)}-${Date.now()}`;
      const { id } = await recordBillingTransaction({
        businessId, planId: addon ? 'connect' : 'billing_growth', amount: 499, billingCycle: 'monthly',
        paymentMethod: 'easebuzz', paymentReference: txnid, status: 'pending', skipEmails: true,
      });
      await query(`UPDATE billing_transactions SET gateway_response = $2::jsonb WHERE id = $1`, [
        id,
        JSON.stringify(addon ? { checkout_type: 'whatsapp_addon', addon_type: addon, provider: 'easebuzz' } : { checkout_type: 'subscription', provider: 'easebuzz' }),
      ]);
      return { id, txnid };
    }

    it('the Easebuzz return for each outcome carries the payment id and no plan id', async () => {
      const paid = await pendingEasebuzz(biz);
      const paidRes = await handleEasebuzzCallback(easebuzzBody(paid.txnid, {}));
      expect(paidRes.redirectPath).toContain('payment=success');
      expect(paidRes.redirectPath).toContain(`tx=${paid.id}`);
      expect(paidRes.redirectPath).not.toMatch(/plan=|billing_growth/);

      const failed = await pendingEasebuzz(biz);
      const failedRes = await handleEasebuzzCallback(easebuzzBody(failed.txnid, { status: 'failure' }));
      expect(failedRes.redirectPath).toContain('payment=cancelled');
      expect(failedRes.redirectPath).toContain(`tx=${failed.id}`);
      // What the browser is sent to ask about: the server's answers for the three payments.
      expect((await statusOf(biz, paid.id)).body.status).toBe('completed');
      expect((await statusOf(biz, failed.id)).body.status).toBe('failed');

      const pending = await pendingEasebuzz(biz);
      const pendingRes = await handleEasebuzzCallback(easebuzzBody(pending.txnid, { status: 'pending' }));
      expect(pendingRes.redirectPath).toContain('payment=pending');
      expect(pendingRes.redirectPath).toContain(`tx=${pending.id}`);
    });

    it('the Easebuzz add-on return (pending) carries the payment id', async () => {
      const row = await pendingEasebuzz(biz, 'whatsapp_bot');
      const res = await handleEasebuzzCallback(easebuzzBody(row.txnid, { status: 'pending' }));
      expect(res.redirectPath).toContain('addon=pending');
      expect(res.redirectPath).toContain(`tx=${row.id}`);
    });
  });

  // ---- 2. only plans on sale are offered (SUB-30) ----

  describe('plans offered to a business', () => {
    it('a business on Starter sees plans on sale only: not Classic, trial, hidden free plans or Connect-not-active', async () => {
      await setRow(biz, 'billing_starter');
      const ids = (await plansFor(biz)).map((p) => p.id);
      expect(ids).toEqual(expect.arrayContaining(['free', 'billing_starter', 'billing_growth', 'billing_business', 'connect', 'hr_starter', 'hr_pro']));
      for (const hidden of ['growth', 'business', 'trial', 'hr_trial', 'hr_free', 'connect_free', 'hr_staff_lite']) {
        expect(ids).not.toContain(hidden);
      }
    });

    it('the current plan is shown as current and cannot be chosen unless it can be renewed', async () => {
      await setRow(biz, 'billing_starter');
      expect(byId(await plansFor(biz), 'billing_starter')!.offer).toEqual({ on_sale: true, current: true, renewable: true, selectable: true });
      await setRow(biz, 'free', { endOffset: null });
      const free = byId(await plansFor(biz), 'free')!;
      expect(free.offer).toMatchObject({ current: true, renewable: false, selectable: false });
      const starter = byId(await plansFor(biz), 'billing_starter')!;
      expect(starter.offer).toMatchObject({ current: false, selectable: true });
    });

    it('a customer on a retired Classic plan sees it as current and may renew it; other businesses do not see it', async () => {
      await setRow(biz, 'growth');
      const mine = byId(await plansFor(biz), 'growth')!;
      expect(mine).toMatchObject({ display_name: 'Growth Classic' });
      expect(mine.offer).toEqual({ on_sale: false, current: true, renewable: true, selectable: true });
      expect(byId(await plansFor(biz), 'business')).toBeUndefined();
      const stranger = await newBusiness('stranger');
      await setRow(stranger, 'billing_starter');
      expect(byId(await plansFor(stranger), 'growth')).toBeUndefined();
    });

    it('a trial is listed only to the business on it, and cannot be chosen', async () => {
      await setRow(biz, 'trial', { status: 'trial', endOffset: 20 });
      const trial = byId(await plansFor(biz), 'trial')!;
      expect(trial.offer).toMatchObject({ current: true, renewable: false, selectable: false });
      const stranger = await newBusiness('stranger2');
      await setRow(stranger, 'billing_starter');
      expect(byId(await plansFor(stranger), 'trial')).toBeUndefined();
    });

    it('a hidden free plan is listed to the business that is on it, not selectable', async () => {
      await setRow(biz, 'hr_free', { module: 'hr', endOffset: null });
      const own = byId(await plansFor(biz), 'hr_free')!;
      expect(own.offer).toMatchObject({ on_sale: false, current: true, selectable: false });
      const stranger = await newBusiness('stranger3');
      expect(byId(await plansFor(stranger), 'hr_free')).toBeUndefined();
    });

    it('a plan priced at Rs 1 is listed and can be chosen; a hidden plan priced at Rs 1 stays hidden (price is never the rule)', async () => {
      const keep = await queryOne<{ a: string; b: string; c: string }>(
        `SELECT (SELECT price_monthly::text FROM subscription_plans WHERE id = 'billing_business') AS a,
                (SELECT price_monthly::text FROM subscription_plans WHERE id = 'business') AS b,
                (SELECT price_yearly::text FROM subscription_plans WHERE id = 'billing_business') AS c`,
      );
      await query(`UPDATE subscription_plans SET price_monthly = 1, price_yearly = 1 WHERE id = 'billing_business'`);
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'business'`);
      try {
        await setRow(biz, 'billing_starter');
        const plans = await plansFor(biz);
        expect(byId(plans, 'billing_business')!.offer).toMatchObject({ on_sale: true, selectable: true });
        expect(byId(plans, 'business')).toBeUndefined();
        // And buyable: preview prices it at Rs 1.
        const res = await previewGet(get('/api/subscriptions/checkout/preview?plan_id=billing_business&billing_cycle=monthly', asOwner(biz)));
        expect(res.status).toBe(200);
        expect((await res.json()).breakdown.listPrice).toBe(1);
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = $1, price_yearly = $2 WHERE id = 'billing_business'`, [keep!.a, keep!.c]);
        await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'business'`, [keep!.b]);
      }
    });

    it('a plan that is not active is hidden, even from its own business it is not selectable', async () => {
      await setRow(biz, 'billing_starter');
      await query(`UPDATE subscription_plans SET is_active = false WHERE id = 'billing_growth'`);
      try {
        expect(byId(await plansFor(biz), 'billing_growth')).toBeUndefined();
        await setRow(biz, 'billing_growth');
        expect(byId(await plansFor(biz), 'billing_growth')!.offer).toMatchObject({ current: true, renewable: false, selectable: false });
      } finally {
        await query(`UPDATE subscription_plans SET is_active = true WHERE id = 'billing_growth'`);
      }
    });

    it('module_key narrows the list to one product; the phone shape (id, display_name, prices, features) is kept', async () => {
      await setRow(biz, 'billing_starter');
      const hr = await plansFor(biz, '?module_key=hr');
      expect(hr.length).toBeGreaterThan(0);
      expect(hr.every((p) => p.product_line === 'hr')).toBe(true);
      const all = (await (await plansGet(get('/api/subscriptions/plans', asOwner(biz)))).json()).plans[0];
      for (const key of ['id', 'name', 'display_name', 'description', 'price_monthly', 'price_yearly', 'features', 'sort_order', 'product_line']) {
        expect(all).toHaveProperty(key);
      }
    });

    it('with no session only plans on sale are listed and none is current', async () => {
      const plans = await plansFor(null);
      expect(plans.every((p) => p.offer.on_sale && !p.offer.current)).toBe(true);
      expect(byId(plans, 'growth')).toBeUndefined();
    });
  });

  describe('a plan not on sale is refused', () => {
    it('upgrade refuses a Classic plan for a business that is not on it, with a plain message', async () => {
      await setRow(biz, 'billing_starter');
      const res = await upgradePost(post('/api/subscriptions/upgrade', { plan_id: 'growth' }, asOwner(biz)));
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ error: PLAN_NOT_ON_SALE_MESSAGE, code: 'PLAN_NOT_OFFERED' });
      expect((await queryOne<{ plan_id: string }>(`SELECT plan_id FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz]))!.plan_id).toBe('billing_starter');
    });

    it('checkout and preview refuse it too', async () => {
      await setRow(biz, 'billing_starter');
      const checkout = await checkoutPost(post('/api/subscriptions/checkout', { plan_id: 'business', billing_cycle: 'monthly' }, asOwner(biz)));
      expect(checkout.status).toBe(400);
      expect(await checkout.json()).toMatchObject({ error: PLAN_NOT_ON_SALE_MESSAGE, code: 'PLAN_NOT_OFFERED' });
      const preview = await previewGet(get('/api/subscriptions/checkout/preview?plan_id=business&billing_cycle=monthly', asOwner(biz)));
      expect(preview.status).toBe(400);
      expect((await preview.json()).code).toBe('PLAN_NOT_OFFERED');
    });

    it('a business on the Classic plan is not refused (renewing is allowed): upgrade moves on to "pay through checkout"', async () => {
      await setRow(biz, 'growth');
      const res = await upgradePost(post('/api/subscriptions/upgrade', { plan_id: 'growth' }, asOwner(biz)));
      expect(res.status).toBe(402);
      expect((await res.json()).code).toBe('REQUIRES_CHECKOUT');
      const preview = await previewGet(get('/api/subscriptions/checkout/preview?plan_id=growth&billing_cycle=monthly', asOwner(biz)));
      expect(preview.status).toBe(200);
    });

    it('a plan on sale is not refused by upgrade', async () => {
      await setRow(biz, 'billing_starter');
      const res = await upgradePost(post('/api/subscriptions/upgrade', { plan_id: 'billing_growth' }, asOwner(biz)));
      expect(res.status).toBe(402);
      expect((await res.json()).code).toBe('REQUIRES_CHECKOUT');
    });

    it('the HR trial is still started through upgrade (it is not a plan being bought)', async () => {
      const res = await upgradePost(post('/api/subscriptions/upgrade', { plan_id: 'hr_trial' }, asOwner(biz)));
      expect(res.status).toBe(200);
    });
  });

  // ---- 3. upgrade prompts name a plan that can be bought ----

  describe('feature upgrade prompt', () => {
    async function featurePlan(businessId: string, key: string) {
      const res = await featurePlanGet(get(`/api/subscriptions/feature-plan?feature_key=${key}`, asOwner(businessId)));
      expect(res.status).toBe(200);
      return (await res.json()).requiredPlan as { planId: string; allPlansWithFeature: Array<{ planId: string }> } | null;
    }

    it('names the lowest paid plan on sale, never the free plan, a Classic plan or the trial that also have the feature', async () => {
      await setRow(biz, 'free', { endOffset: null });
      const plan = await featurePlan(biz, 'accessibility');
      expect(plan!.planId).toBe('billing_starter');
      const ids = plan!.allPlansWithFeature.map((p) => p.planId);
      for (const bad of ['free', 'growth', 'business', 'trial']) expect(ids).not.toContain(bad);
    });

    it('a Rs 1 plan on sale is named (price is not the filter)', async () => {
      await setRow(biz, 'free', { endOffset: null });
      const keep = await queryOne<{ p: string; y: string }>(`SELECT price_monthly::text AS p, price_yearly::text AS y FROM subscription_plans WHERE id = 'billing_starter'`);
      await query(`UPDATE subscription_plans SET price_monthly = 1, price_yearly = 1 WHERE id = 'billing_starter'`);
      try {
        expect((await featurePlan(biz, 'accessibility'))!.planId).toBe('billing_starter');
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = $1, price_yearly = $2 WHERE id = 'billing_starter'`, [keep!.p, keep!.y]);
      }
    });

    it('an HR feature names HR Starter, not the complimentary HR Lite or the HR trial', async () => {
      const plan = await featurePlan(biz, 'hr_attendance');
      expect(plan!.planId).toBe('hr_starter');
      expect(plan!.allPlansWithFeature.map((p) => p.planId)).not.toContain('hr_staff_lite');
    });

    it('a business already on Growth is pointed above Growth, never down', async () => {
      await setRow(biz, 'billing_growth');
      const plan = await featurePlan(biz, 'advanced_barcode');
      expect(plan!.planId).toBe('billing_business');
    });
  });

  // ---- 4. small states ----

  describe('card price and names', () => {
    it('the card gets the price of the cycle the customer is on, and the scheduled plan by name', async () => {
      await setRow(biz, 'billing_growth', { cycle: 'yearly', scheduled: 'billing_starter' });
      const res = await modulesCurrentGet(get('/api/subscriptions/modules/current', asOwner(biz)));
      const json = await res.json();
      const sub = json.modules.find((m: { module_key: string }) => m.module_key === 'billing').subscription;
      const prices = await queryOne<{ y: string }>(`SELECT price_yearly::text AS y FROM subscription_plans WHERE id = 'billing_growth'`);
      expect(sub.billing_cycle).toBe('yearly');
      expect(sub.price_for_cycle).toBe(Number(prices!.y));
      expect(sub.scheduled_plan_display_name).toBe('Starter');
      await setRow(biz, 'billing_growth', { cycle: 'monthly' });
      const monthly = (await (await modulesCurrentGet(get('/api/subscriptions/modules/current', asOwner(biz)))).json()).modules[0].subscription;
      expect(monthly.price_for_cycle).toBe(499);
    });

    it('the current route names the scheduled plan too', async () => {
      await setRow(biz, 'billing_growth', { scheduled: 'billing_starter' });
      const res = await currentGet(get('/api/subscriptions/current', asOwner(biz)));
      expect((await res.json()).subscription).toMatchObject({ scheduled_plan_display_name: 'Starter' });
    });
  });

  // ---- 5. who sees billing (SUB-40) ----

  describe('billing visibility follows the plan-change permission', () => {
    it('the owner, and a user with the primary_admin role, see history, receipts and the full card', async () => {
      await setRow(biz, 'billing_growth');
      const admin = await newStaff(biz, 'primary_admin');
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);
      for (const headers of [asOwner(biz), asUser(biz, admin)]) {
        expect((await historyGet(get('/api/subscriptions/billing-history', headers))).status).toBe(200);
        expect((await receiptGet(get(`/api/subscriptions/receipts/${tx}`, headers), { params: { id: tx } })).status).toBe(200);
        const modules = await (await modulesCurrentGet(get('/api/subscriptions/modules/current', headers))).json();
        expect(modules.can_manage_billing).toBe(true);
        expect(modules.modules[0].subscription).toMatchObject({ plan_display_name: 'Growth', can_renew: true });
        const current = await (await currentGet(get('/api/subscriptions/current', headers))).json();
        expect(current.subscription.can_manage_billing).toBe(true);
      }
    });

    it('staff without the permission get 403 for history and receipts, and see the plan name only on the card', async () => {
      await setRow(biz, 'billing_growth', { cycle: 'yearly', scheduled: 'billing_starter' });
      const staff = await newStaff(biz);
      const tx = await pendingCheckout(biz, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);

      const history = await historyGet(get('/api/subscriptions/billing-history', asUser(biz, staff)));
      expect(history.status).toBe(403);
      expect((await history.json()).code).toBe('FORBIDDEN');
      const receipt = await receiptGet(get(`/api/subscriptions/receipts/${tx}`, asUser(biz, staff)), { params: { id: tx } });
      expect(receipt.status).toBe(403);

      const modules = await (await modulesCurrentGet(get('/api/subscriptions/modules/current', asUser(biz, staff)))).json();
      expect(modules.can_manage_billing).toBe(false);
      const sub = modules.modules[0].subscription;
      expect(sub).toEqual({ plan_id: 'billing_growth', status: 'active', plan_display_name: 'Growth', can_manage_billing: false });
      const current = await (await currentGet(get('/api/subscriptions/current', asUser(biz, staff)))).json();
      expect(current.subscription.can_manage_billing).toBe(false);
      expect(current.subscription.plan_display_name).toBe('Growth');
    });

    it('a user of another business, or with no user id, cannot see billing either', async () => {
      const other = await newBusiness('other3');
      const stranger = ownerOf.get(other)!;
      expect((await historyGet(get('/api/subscriptions/billing-history', asUser(biz, stranger)))).status).toBe(403);
      expect((await historyGet(get('/api/subscriptions/billing-history', { 'x-authenticated-business-id': biz }))).status).toBe(401);
    });

    it('the permission is the one the plan-change routes require (same 403 and code)', async () => {
      await setRow(biz, 'billing_starter');
      const staff = await newStaff(biz);
      const change = await upgradePost(post('/api/subscriptions/upgrade', { plan_id: 'billing_growth' }, asUser(biz, staff)));
      const history = await historyGet(get('/api/subscriptions/billing-history', asUser(biz, staff)));
      expect(change.status).toBe(403);
      expect(history.status).toBe(403);
      expect((await change.json()).code).toBe((await history.json()).code);
    });

    it('a receipt of another business is still 404 for its owner-of-this-business caller', async () => {
      const other = await newBusiness('other4');
      const tx = await pendingCheckout(other, 'billing_growth', 499);
      await query(`UPDATE billing_transactions SET status = 'completed' WHERE id = $1`, [tx]);
      const res = await receiptGet(get(`/api/subscriptions/receipts/${tx}`, asOwner(biz)), { params: { id: tx } });
      expect(res.status).toBe(404);
    });
  });

  // ---- 6. debug routes (SUB-42) ----

  describe('debug routes need a platform admin and a non-production environment', () => {
    const platformMock = requirePlatformRequest as jest.Mock;
    const env = process.env as Record<string, string | undefined>;
    const savedEnv = env.NODE_ENV;
    afterEach(() => {
      env.NODE_ENV = savedEnv;
      platformMock.mockReset();
    });
    const denied = () => ({ ok: false, response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) });
    const allowed = () => ({ ok: true, admin: { id: 'a', role: 'viewer', permissions: {} } });

    it.each([
      ['debug', () => debugGet(get('/api/subscriptions/debug', asOwner(biz)))],
      ['addons/debug', () => addonsDebugGet(get('/api/subscriptions/addons/debug', asOwner(biz)))],
    ])('%s: a signed-in business user who is not a platform admin is refused', async (_name, call) => {
      env.NODE_ENV = 'test';
      platformMock.mockResolvedValue(denied());
      const res = await call();
      expect(res.status).toBe(401);
      expect(platformMock).toHaveBeenCalled();
    });

    it.each([
      ['debug', () => debugGet(get('/api/subscriptions/debug', asOwner(biz)))],
      ['addons/debug', () => addonsDebugGet(get('/api/subscriptions/addons/debug', asOwner(biz)))],
    ])('%s: a platform admin outside production gets the data', async (_name, call) => {
      env.NODE_ENV = 'test';
      platformMock.mockResolvedValue(allowed());
      const res = await call();
      expect(res.status).toBe(200);
    });

    it.each([
      ['debug', () => debugGet(get('/api/subscriptions/debug', asOwner(biz)))],
      ['addons/debug', () => addonsDebugGet(get('/api/subscriptions/addons/debug', asOwner(biz)))],
    ])('%s: in production even a platform admin gets 404', async (_name, call) => {
      env.NODE_ENV = 'production';
      platformMock.mockResolvedValue(allowed());
      const res = await call();
      expect(res.status).toBe(404);
      expect(platformMock).not.toHaveBeenCalled();
    });
  });
});
