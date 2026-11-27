/**
 * Payment record safety (migration 479 and payment completion) against real PostgreSQL.
 * Opt-in, disposable DB only:
 *   PHASE2_TEST_DATABASE_URL=postgresql://postgres:<pw>@127.0.0.1:5433/kh_phase2_test DB_SSL=false \
 *     npx jest tests/db/payment-record-safety.db.test.ts --runInBand --forceExit
 * Migration 479 is run (as SQL text) once in beforeAll and stays applied on the test database.
 */
import { createHmac, randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';
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

import { query, queryOne, closePool } from '@/lib/db';
import { clearSubscriptionCache } from '@/lib/subscription';
import { clearModuleSubscriptionCache } from '@/lib/subscription/module-subscriptions';
import { processPlatformRazorpayWebhook, recordBillingTransaction } from '@/lib/platform-billing';
import { completeAddonCheckoutPayment } from '@/lib/platform-addon-checkout';

const run = enabled ? describe : describe.skip;

run('payment record safety (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  let bizA: string;
  let bizB: string;

  async function newBusiness(label: string): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Pay safety ${label} ${id.slice(0, 6)}`],
    );
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [id],
    );
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [randomUUID(), id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
    );
    return id;
  }

  async function pendingCheckout(businessId: string, planId: string, amount: number): Promise<string> {
    const { id } = await recordBillingTransaction({
      businessId,
      planId,
      amount,
      billingCycle: 'monthly',
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
    return queryOne<{ status: string; payment_reference: string | null; gateway_response: Record<string, unknown> | null }>(
      `SELECT status, payment_reference, gateway_response FROM billing_transactions WHERE id = $1`,
      [id],
    );
  }

  async function moduleRow(businessId: string, moduleKey: string) {
    return queryOne<{ plan_id: string; status: string; billing_cycle: string | null }>(
      `SELECT plan_id, status, billing_cycle FROM business_module_subscriptions WHERE business_id = $1 AND module_key = $2`,
      [businessId, moduleKey],
    );
  }

  function notesFor(businessId: string, tx: string, planId: string, cycle = 'monthly') {
    return { business_id: businessId, billing_transaction_id: tx, plan_id: planId, billing_cycle: cycle };
  }

  /**
   * Build, sign and deliver a Razorpay webhook to the real platform handler.
   * The payment id is used exactly as given (callers add their own suffix); `exactPayId` documents
   * that a test relies on that, so a payment id can be replayed on purpose.
   */
  function hook(
    event: string,
    payId: string,
    payStatus: string,
    notes: Record<string, unknown>,
    opts: { amountPaise?: number; withLink?: boolean; exactPayId?: boolean } = {},
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
  async function paidAndActivated(
    businessId: string,
    planId: string,
    opts: { payId?: string; amount?: number } = {},
  ): Promise<string> {
    let price = opts.amount;
    if (price === undefined) {
      const plan = await queryOne<{ price_monthly: string }>(
        `SELECT price_monthly::text FROM subscription_plans WHERE id = $1`,
        [planId],
      );
      price = Number(plan!.price_monthly);
    }
    const tx = await pendingCheckout(businessId, planId, price);
    const r = await hook('payment.captured', opts.payId ?? 'pay_pa_' + sfx(), 'captured', notesFor(businessId, tx, planId), {
      amountPaise: Math.round(price * 100),
      exactPayId: !!opts.payId,
    });
    expect(r).toMatchObject({ ok: true });
    return tx;
  }

  /** Status of the webhook event whose payload mentions the payment id and the business. */
  async function webhookEventStatus(payId: string, businessId: string): Promise<string | null> {
    const r = await queryOne<{ status: string }>(
      `SELECT status FROM platform_billing_webhook_events
       WHERE payload::text LIKE $1 AND payload::text LIKE $2 ORDER BY created_at DESC LIMIT 1`,
      [`%${payId}%`, `%${businessId}%`],
    );
    return r?.status ?? null;
  }

  /** Reads migration 479 and runs it as one multi-statement query. */
  async function runMigration479(): Promise<void> {
    const sql = readFileSync(join(process.cwd(), 'database/migrations/479_billing_record_constraints.sql'), 'utf8');
    await query(sql);
  }

  async function indexExists(name: string): Promise<boolean> {
    const r = await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM pg_indexes WHERE indexname = $1`, [name]);
    return Number(r!.n) > 0;
  }

  /** Two completed Razorpay rows sharing a reference, one per business (only while the unique index is absent). */
  async function insertCompletedPair(a: string, b: string, ref: string): Promise<void> {
    for (const id of [a, b]) {
      await query(
        `INSERT INTO billing_transactions (business_id, type, status, amount, total_amount, plan_id, billing_cycle, payment_method, payment_reference)
         VALUES ($1, 'payment', 'completed', 499, 499, 'billing_growth', 'monthly', 'razorpay', $2)`,
        [id, ref],
      );
    }
  }

  async function deleteRows(ref: string): Promise<void> {
    await query(`DELETE FROM billing_transactions WHERE payment_reference = $1`, [ref]);
  }

  beforeAll(async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
    await runMigration479();
  });

  beforeEach(async () => {
    bizA = await newBusiness('a');
    bizB = await newBusiness('b');
    clearSubscriptionCache(bizA);
    clearModuleSubscriptionCache(bizA);
    clearSubscriptionCache(bizB);
    clearModuleSubscriptionCache(bizB);
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
      await closePool();
    }
  });

  it('migration 479 runs twice without error', async () => {
    await runMigration479();
    await runMigration479();
  });

  it('a second completed row with the same gateway payment id is refused by the database', async () => {
    const a = await pendingCheckout(bizA, 'billing_growth', 499);
    const b = await pendingCheckout(bizB, 'billing_growth', 499);
    await query(`UPDATE billing_transactions SET status='completed', payment_reference='pay_same' WHERE id=$1`, [a]);
    try {
      await expect(query(`UPDATE billing_transactions SET status='completed', payment_reference='pay_same' WHERE id=$1`, [b]))
        .rejects.toMatchObject({ code: '23505', constraint: 'uq_billing_tx_completed_payment_ref' });
    } finally {
      await deleteRows('pay_same');
    }
  });

  it('pending and failed rows may share a reference', async () => {
    const a = await pendingCheckout(bizA, 'billing_growth', 499);
    const b = await pendingCheckout(bizA, 'billing_growth', 499);
    await query(`UPDATE billing_transactions SET payment_reference='plink_x' WHERE id = ANY($1)`, [[a, b]]);
    await query(`UPDATE billing_transactions SET status='failed' WHERE id = $1`, [b]);
    await deleteRows('plink_x');
  });

  it('Razorpay completion records the payment id and keeps the link id in gateway_response', async () => {
    const tx = await pendingCheckout(bizA, 'billing_growth', 499);
    await query(
      `UPDATE billing_transactions SET payment_reference='plink_keep',
         gateway_response = gateway_response || '{"payment_link_id":"plink_keep"}'::jsonb WHERE id=$1`,
      [tx],
    );
    const payId = 'pay_rec_' + sfx();
    const r = await hook('payment.captured', payId, 'captured', notesFor(bizA, tx, 'billing_growth'), { amountPaise: 49900 });
    expect(r).toMatchObject({ ok: true });
    const row = await txRow(tx);
    expect(row!.status).toBe('completed');
    expect(row!.payment_reference).toBe(payId);
    expect(row!.gateway_response).toMatchObject({ payment_link_id: 'plink_keep' });
  });

  it('a webhook that would reuse a payment id is ignored, not retried', async () => {
    await paidAndActivated(bizA, 'billing_growth', { payId: 'pay_reuse' });
    try {
      // payment_link.paid, not payment.captured: the same event type + payment id would be dropped as a
      // duplicate delivery by the webhook idempotency key before reaching completion.
      const tx = await pendingCheckout(bizB, 'billing_growth', 499);
      const r = await hook('payment_link.paid', 'pay_reuse', 'captured', notesFor(bizB, tx, 'billing_growth'), {
        amountPaise: 49900,
        exactPayId: true,
      });
      expect(r).toMatchObject({ ok: true });
      expect((r as { error?: string }).error).toContain('PAYMENT_REFERENCE_ALREADY_USED');
      expect((await txRow(tx))!.status).toBe('pending');
      expect(await moduleRow(bizB, 'billing')).toBeNull();
      expect(await webhookEventStatus('pay_reuse', bizB)).toBe('ignored');
    } finally {
      await deleteRows('pay_reuse');
    }
  });

  it('an add-on completion that would reuse a payment id fails with the terminal error', async () => {
    await paidAndActivated(bizA, 'billing_growth', { payId: 'pay_reuse_addon' });
    try {
      const tx = await pendingCheckout(bizB, 'connect', 299);
      await query(
        `UPDATE billing_transactions SET gateway_response = '{"checkout_type":"whatsapp_addon","addon_type":"khatario_ai","provider":"razorpay"}'::jsonb WHERE id = $1`,
        [tx],
      );
      await expect(
        completeAddonCheckoutPayment({
          businessId: bizB,
          addonType: 'khatario_ai',
          billingTransactionId: tx,
          providerPaymentId: 'pay_reuse_addon',
          amount: 299,
        }),
      ).rejects.toThrow('PAYMENT_REFERENCE_ALREADY_USED');
      expect((await txRow(tx))!.status).toBe('pending');
    } finally {
      await deleteRows('pay_reuse_addon');
    }
  });

  it('the migration skips the unique index when duplicates already exist', async () => {
    try {
      await query(`DROP INDEX IF EXISTS uq_billing_tx_completed_payment_ref`);
      await insertCompletedPair(bizA, bizB, 'pay_dup_old');
      await runMigration479();
      expect(await indexExists('uq_billing_tx_completed_payment_ref')).toBe(false);
      await deleteRows('pay_dup_old');
      await runMigration479();
      expect(await indexExists('uq_billing_tx_completed_payment_ref')).toBe(true);
    } finally {
      await deleteRows('pay_dup_old');
      await runMigration479(); // restore the shared local index even when an assertion failed
    }
  });

  it('an unknown billing cycle is refused on module subscriptions', async () => {
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date)
       VALUES ($1, 'billing', 'billing_growth', 'active', CURRENT_DATE)`,
      [bizA],
    );
    await expect(query(`UPDATE business_module_subscriptions SET billing_cycle='weekly' WHERE business_id=$1`, [bizA]))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('billing_transactions_archive has no foreign keys or check constraints', async () => {
    const cons = await queryOne<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM pg_constraint WHERE conrelid = 'billing_transactions_archive'::regclass AND contype IN ('f','c')`,
    );
    expect(Number(cons!.n)).toBe(0);
  });
});
