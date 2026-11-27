/**
 * Coupons (plan 2026-11-27 Task 1, SUB-17) against real PostgreSQL: limits under concurrency, the
 * over-limit payment, the tier rule for min_plan_id, the one-month cap on a longer cycle, and the
 * discount recorded on the chosen cycle. Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/coupons.db.test.ts --runInBand --forceExit
 * No real gateway, email or WhatsApp call: webhooks are signed locally, senders are mocked.
 */
import { createHmac, randomUUID } from 'crypto';

process.env.PLATFORM_RAZORPAY_KEY_ID = 'rzp_test_plan';
process.env.PLATFORM_RAZORPAY_KEY_SECRET = 'k';
process.env.PLATFORM_RAZORPAY_WEBHOOK_SECRET = 'whsec_plan';

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
jest.mock('next/headers', () => ({
  headers: jest.fn(async () => ({ get: () => null })),
  cookies: jest.fn(async () => ({ get: () => undefined })),
}));

import { NextRequest } from 'next/server';
import { query, queryOne, closePool } from '@/lib/db';
import { processPlatformRazorpayWebhook, recordBillingTransaction } from '@/lib/platform-billing';
import { validateCoupon, redeemCoupon, CouponUnavailableError } from '@/lib/subscription/coupons';
import { resolveCheckoutPricing } from '@/lib/subscription/checkout-pricing';
import { applyInstantPlanUpgradeWithCoupon } from '@/lib/subscription/apply-coupon-upgrade';
import { reportBillingAnomalies } from '@/lib/subscription/reconcile-payments';
import { GET as previewGet } from '@/app/api/subscriptions/checkout/preview/route';
import type { BillingCycle } from '@/lib/subscription/apply-plan-change';

const run = enabled ? describe : describe.skip;

run('coupons (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const businesses: string[] = [];
  const coupons: string[] = [];
  const ownerOf = new Map<string, string>();

  async function newBusiness(): Promise<string> {
    const id = randomUUID();
    businesses.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Coupons ${id.slice(0, 6)}`],
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

  async function makeCoupon(o: {
    type: 'percentage' | 'flat' | 'free_months';
    value: number;
    maxPerBusiness?: number;
    maxRedemptions?: number | null;
    minPlan?: string | null;
    validUntilOffset?: number | null;
  }): Promise<{ id: string; code: string }> {
    const code = `CP${randomUUID().slice(0, 10).toUpperCase()}`;
    const r = await queryOne<{ id: string }>(
      `INSERT INTO coupons (code, type, value, max_per_business, max_redemptions, min_plan_id, valid_until)
       VALUES ($1, $2, $3, $4, $5, $6, CASE WHEN $7::int IS NULL THEN NULL ELSE CURRENT_DATE + $7::int END)
       RETURNING id`,
      [code, o.type, o.value, o.maxPerBusiness ?? 1, o.maxRedemptions ?? null, o.minPlan ?? null, o.validUntilOffset ?? null],
    );
    coupons.push(r!.id);
    return { id: r!.id, code };
  }

  async function price(planId: string, cycle: BillingCycle): Promise<number> {
    const col = cycle === 'yearly' ? 'price_yearly' : cycle === 'three_year' ? 'price_3year' : 'price_monthly';
    const p = await queryOne<{ p: string }>(`SELECT ${col}::text AS p FROM subscription_plans WHERE id = $1`, [planId]);
    return Number(p!.p);
  }

  async function pendingCheckout(businessId: string, planId: string, cycle: BillingCycle, couponId: string, discount: number): Promise<{ id: string; total: number }> {
    const base = await price(planId, cycle);
    const { id } = await recordBillingTransaction({
      businessId, planId, amount: base, discountAmount: discount, couponId,
      billingCycle: cycle, paymentMethod: 'razorpay', status: 'pending', skipEmails: true,
    });
    await query(
      `UPDATE billing_transactions SET gateway_response = '{"checkout_type":"subscription","provider":"razorpay"}'::jsonb WHERE id = $1`,
      [id],
    );
    return { id, total: base - discount };
  }

  function pay(businessId: string, tx: string, planId: string, cycle: BillingCycle, amount: number) {
    const notes = { business_id: businessId, billing_transaction_id: tx, plan_id: planId, billing_cycle: cycle };
    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_cp_' + randomUUID().slice(0, 10), status: 'captured', amount: Math.round(amount * 100), notes } } },
    });
    const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
    return processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': sig });
  }

  async function redemptions(couponId: string, businessId?: string) {
    return (await query(
      `SELECT discount_amount::text AS d, billing_transaction_id FROM coupon_redemptions
       WHERE coupon_id = $1 AND ($2::uuid IS NULL OR business_id = $2)`,
      [couponId, businessId ?? null],
    ))!.rows as { d: string; billing_transaction_id: string | null }[];
  }

  beforeAll(() => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of businesses) {
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

  describe('one month at most when a coupon would make a longer cycle free', () => {
    it('a 100% coupon on the 3-year cycle takes off one month, not three years', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 100 });
      const monthly = await price('billing_growth', 'monthly');
      const threeYear = await price('billing_growth', 'three_year');
      const v = await validateCoupon(c.code, biz, 'billing_growth', 'three_year');
      expect(v.valid).toBe(true);
      expect(v.discount).toMatchObject({ amount: monthly, capped: true });
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'three_year', couponCode: c.code });
      expect(p.discountAmount).toBe(monthly);
      expect(p.finalAmount).toBe(Math.round((threeYear - monthly) * 100) / 100);
      expect(p.couponCapped).toBe(true);
    });

    it('the same on the yearly cycle, and for a flat coupon bigger than the price', async () => {
      const biz = await newBusiness();
      const monthly = await price('billing_growth', 'monthly');
      const yearly = await price('billing_growth', 'yearly');
      const full = await makeCoupon({ type: 'percentage', value: 100 });
      const flat = await makeCoupon({ type: 'flat', value: 100000 });
      for (const c of [full, flat]) {
        const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'yearly', couponCode: c.code });
        expect(p.discountAmount).toBe(monthly);
        expect(p.finalAmount).toBe(Math.round((yearly - monthly) * 100) / 100);
      }
    });

    it('a partial percentage and a small flat coupon are unchanged on a longer cycle', async () => {
      const biz = await newBusiness();
      const threeYear = await price('billing_growth', 'three_year');
      const half = await makeCoupon({ type: 'percentage', value: 50 });
      const flat = await makeCoupon({ type: 'flat', value: 500 });
      const a = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'three_year', couponCode: half.code });
      expect(a.discountAmount).toBe(Math.round(threeYear * 50) / 100);
      expect(a.couponCapped).toBe(false);
      const b = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'three_year', couponCode: flat.code });
      expect(b.discountAmount).toBe(500);
    });

    it('a 100% coupon on the monthly cycle still gives the zero-rupee path', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 100 });
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', couponCode: c.code });
      expect(p.finalAmount).toBe(0);
      expect(p.couponCapped).toBe(false);
      await applyInstantPlanUpgradeWithCoupon({ businessId: biz, planId: 'billing_growth', planDisplayName: 'Growth', billingCycle: 'monthly', pricing: p, paymentMethod: 'coupon' });
      expect((await queryOne<any>(`SELECT plan_id FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [biz]))!.plan_id).toBe('billing_growth');
      const reds = await redemptions(c.id, biz);
      expect(reds).toHaveLength(1);
      expect(reds[0].billing_transaction_id).not.toBeNull();
      expect(Number(reds[0].d)).toBe(await price('billing_growth', 'monthly'));
    });

    it('the checkout preview shows the cap with the same numbers', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 100 });
      const monthly = await price('billing_growth', 'monthly');
      const threeYear = await price('billing_growth', 'three_year');
      const res = await previewGet(new NextRequest(
        `http://localhost/api/subscriptions/checkout/preview?plan_id=billing_growth&billing_cycle=three_year&coupon_code=${c.code}`,
        { headers: { 'x-authenticated-business-id': biz, 'x-authenticated-user-id': ownerOf.get(biz)! } },
      ));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.breakdown).toMatchObject({ couponDiscount: monthly, couponCapped: true, amountToPay: Math.round((threeYear - monthly) * 100) / 100 });
    });
  });

  describe('the recorded discount is the real one on the chosen cycle', () => {
    it('a paid yearly checkout records the yearly discount, and the capped one records one month', async () => {
      const biz = await newBusiness();
      const yearly = await price('billing_growth', 'yearly');
      const half = await makeCoupon({ type: 'percentage', value: 50 });
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'yearly', couponCode: half.code });
      const tx = await pendingCheckout(biz, 'billing_growth', 'yearly', half.id, p.discountAmount);
      expect(await pay(biz, tx.id, 'billing_growth', 'yearly', tx.total)).toMatchObject({ ok: true });
      expect(Number((await redemptions(half.id, biz))[0].d)).toBe(Math.round(yearly * 50) / 100);

      const biz2 = await newBusiness();
      const full = await makeCoupon({ type: 'percentage', value: 100 });
      const p2 = await resolveCheckoutPricing({ businessId: biz2, planId: 'billing_growth', billingCycle: 'three_year', couponCode: full.code });
      const tx2 = await pendingCheckout(biz2, 'billing_growth', 'three_year', full.id, p2.discountAmount);
      expect(await pay(biz2, tx2.id, 'billing_growth', 'three_year', tx2.total)).toMatchObject({ ok: true });
      expect(Number((await redemptions(full.id, biz2))[0].d)).toBe(await price('billing_growth', 'monthly'));
    });
  });

  describe('limits are enforced under the coupon lock', () => {
    it('two concurrent zero-rupee redemptions of a max_per_business 1 coupon: exactly one succeeds', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 100, maxPerBusiness: 1 });
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', couponCode: c.code });
      const attempt = () => applyInstantPlanUpgradeWithCoupon({ businessId: biz, planId: 'billing_growth', planDisplayName: 'Growth', billingCycle: 'monthly', pricing: p, paymentMethod: 'coupon' });
      const results = await Promise.allSettled([attempt(), attempt()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const failed = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(failed.reason).toBeInstanceOf(CouponUnavailableError);
      const reds = await redemptions(c.id, biz);
      expect(reds).toHaveLength(1);
      expect(reds[0].billing_transaction_id).not.toBeNull();
      expect((await queryOne<any>(`SELECT current_redemptions FROM coupons WHERE id = $1`, [c.id]))!.current_redemptions).toBe(1);
      // The refused attempt left no completed payment behind.
      expect((await queryOne<any>(`SELECT COUNT(*)::int AS n FROM billing_transactions WHERE business_id = $1 AND coupon_id = $2 AND status = 'completed'`, [biz, c.id]))!.n).toBe(1);
    });

    it('a global max_redemptions 1 coupon used by two businesses at once: one wins', async () => {
      const a = await newBusiness();
      const b = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 100, maxRedemptions: 1 });
      const attempt = async (biz: string) => {
        const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', couponCode: c.code });
        return applyInstantPlanUpgradeWithCoupon({ businessId: biz, planId: 'billing_growth', planDisplayName: 'Growth', billingCycle: 'monthly', pricing: p, paymentMethod: 'coupon' });
      };
      const results = await Promise.allSettled([attempt(a), attempt(b)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect((await redemptions(c.id))).toHaveLength(1);
      expect((await queryOne<any>(`SELECT current_redemptions FROM coupons WHERE id = $1`, [c.id]))!.current_redemptions).toBe(1);
    });

    it('a redemption without a billing transaction id is refused', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'flat', value: 10 });
      await expect(redeemCoupon(c.id, biz, 'billing_growth', '' as string, 'monthly')).rejects.toThrow(/billing transaction/);
      expect(await redemptions(c.id)).toHaveLength(0);
    });

    it('a coupon used up between checkout and payment: the paid payment completes at the price paid, is flagged, and the nightly report counts it', async () => {
      const a = await newBusiness();
      const b = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 50, maxRedemptions: 1 });
      const pa = await resolveCheckoutPricing({ businessId: a, planId: 'billing_growth', billingCycle: 'monthly', couponCode: c.code });
      const pb = await resolveCheckoutPricing({ businessId: b, planId: 'billing_growth', billingCycle: 'monthly', couponCode: c.code });
      // Both links are made while the coupon still has a use left.
      const txA = await pendingCheckout(a, 'billing_growth', 'monthly', c.id, pa.discountAmount);
      const txB = await pendingCheckout(b, 'billing_growth', 'monthly', c.id, pb.discountAmount);
      expect(await pay(a, txA.id, 'billing_growth', 'monthly', txA.total)).toMatchObject({ ok: true });
      expect(await pay(b, txB.id, 'billing_growth', 'monthly', txB.total)).toMatchObject({ ok: true });

      const rowB = await queryOne<any>(`SELECT status, total_amount::text AS total, metadata->'coupon_over_limit'->>'reason' AS over FROM billing_transactions WHERE id = $1`, [txB.id]);
      expect(rowB).toMatchObject({ status: 'completed', total: txB.total.toFixed(2) });
      expect(rowB.over).toMatch(/maximum redemptions/);
      const rowA = await queryOne<any>(`SELECT metadata ? 'coupon_over_limit' AS flagged FROM billing_transactions WHERE id = $1`, [txA.id]);
      expect(rowA.flagged).toBe(false);
      expect((await queryOne<any>(`SELECT plan_id FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`, [b]))!.plan_id).toBe('billing_growth');
      expect(await redemptions(c.id)).toHaveLength(2);

      const report = await reportBillingAnomalies();
      expect(report.overLimitCoupons).toBeGreaterThanOrEqual(1);
    });

    it('a coupon that expired after checkout is also flagged, not refused', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'flat', value: 100 });
      const p = await resolveCheckoutPricing({ businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', couponCode: c.code });
      const tx = await pendingCheckout(biz, 'billing_growth', 'monthly', c.id, p.discountAmount);
      await query(`UPDATE coupons SET valid_until = CURRENT_DATE - 1 WHERE id = $1`, [c.id]);
      expect(await pay(biz, tx.id, 'billing_growth', 'monthly', tx.total)).toMatchObject({ ok: true });
      const row = await queryOne<any>(`SELECT status, metadata->'coupon_over_limit'->>'reason' AS over FROM billing_transactions WHERE id = $1`, [tx.id]);
      expect(row).toMatchObject({ status: 'completed', over: 'Coupon has expired' });
    });

    it('a coupon valid until today still works today', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'flat', value: 10, validUntilOffset: 0 });
      expect((await validateCoupon(c.code, biz, 'billing_growth', 'monthly')).valid).toBe(true);
    });
  });

  describe('min_plan_id is a tier rule, never a price rule', () => {
    it('refuses a lower tier and accepts the same or a higher tier', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 10, minPlan: 'billing_growth' });
      expect((await validateCoupon(c.code, biz, 'billing_starter', 'monthly')).valid).toBe(false);
      expect((await validateCoupon(c.code, biz, 'billing_growth', 'monthly')).valid).toBe(true);
      expect((await validateCoupon(c.code, biz, 'billing_business', 'monthly')).valid).toBe(true);
    });

    it('still decides by tier when a plan is priced at Rs 1', async () => {
      const biz = await newBusiness();
      const c = await makeCoupon({ type: 'percentage', value: 10, minPlan: 'billing_growth' });
      const old = await queryOne<any>(`SELECT price_monthly::text AS m FROM subscription_plans WHERE id = 'billing_starter'`);
      await query(`UPDATE subscription_plans SET price_monthly = 1 WHERE id = 'billing_starter'`);
      try {
        expect((await validateCoupon(c.code, biz, 'billing_starter', 'monthly')).valid).toBe(false);
      } finally {
        await query(`UPDATE subscription_plans SET price_monthly = $1 WHERE id = 'billing_starter'`, [old.m]);
      }
    });
  });
});
