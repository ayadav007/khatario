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
import { getPool } from '@/lib/db';
import { deleteBusinessCompletely } from '@/lib/admin-business-ops';
import {
  archiveBusinessBillingTransactions,
  listArchivedBillingTransactions,
  ARCHIVE_MISSING_MESSAGE,
} from '@/lib/platform-billing-archive';

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


run('business deletion keeps payment rows (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  const ADMIN = randomUUID(); // logAdminAction is mocked, so no platform_admins row is needed

  async function biz(label: string): Promise<{ id: string; userId: string; name: string }> {
    const id = randomUUID();
    const userId = randomUUID();
    const name = `Del safety ${label} ${id.slice(0, 6)}`;
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, name],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [id]);
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [userId, id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
    );
    return { id, userId, name };
  }

  async function paidTx(businessId: string): Promise<string> {
    const { id } = await recordBillingTransaction({
      businessId, planId: 'billing_growth', amount: 499, billingCycle: 'monthly',
      paymentMethod: 'razorpay', status: 'completed', skipEmails: true,
    });
    await query(`UPDATE billing_transactions SET payment_reference = $2 WHERE id = $1`, [id, 'pay_del_' + randomUUID().slice(0, 8)]);
    return id;
  }

  const cnt = async (sql: string, p: unknown[]) => Number((await queryOne<{ n: string }>(`SELECT COUNT(*)::text AS n FROM ${sql}`, p))!.n);

  beforeAll(async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
    const sql = readFileSync(join(process.cwd(), 'database/migrations/479_billing_record_constraints.sql'), 'utf8');
    await query(sql);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      await query(`DELETE FROM period_locks WHERE business_id = ANY($1)`, [created]).catch(() => undefined);
      for (const id of created) {
        await query(`DELETE FROM billing_transactions_archive WHERE business_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
    }
  });

  it('deleting a business keeps its payment rows in the archive', async () => {
    const b = await biz('keep');
    const tx = await paidTx(b.id);
    await deleteBusinessCompletely(b.id, ADMIN);
    expect(await cnt(`billing_transactions WHERE id = $1`, [tx])).toBe(0);
    expect(await cnt(`businesses WHERE id = $1`, [b.id])).toBe(0);
    const a = await queryOne<Record<string, string>>(
      `SELECT status, total_amount::text, business_name, business_gstin, archive_reason FROM billing_transactions_archive WHERE id = $1`,
      [tx],
    );
    expect(a).toMatchObject({
      status: 'completed', total_amount: '499.00', archive_reason: 'business_deleted',
      business_name: b.name, business_gstin: '27AAAPA1234A1Z5',
    });
  });

  it('archiving twice does not duplicate', async () => {
    const b = await biz('twice');
    await paidTx(b.id);
    const c = await getPool().connect();
    try {
      expect(await archiveBusinessBillingTransactions(c, b.id, 'test')).toBe(1);
      expect(await archiveBusinessBillingTransactions(c, b.id, 'test')).toBe(0);
    } finally {
      c.release();
    }
    expect(await cnt(`billing_transactions_archive WHERE business_id = $1`, [b.id])).toBe(1);
  });

  it('a business with a partner commission on its payment still archives the payment', async () => {
    const b = await biz('partner');
    const tx = await paidTx(b.id);
    const partnerId = randomUUID();
    await query(
      `INSERT INTO platform_partners (id, name, email, password_hash, referral_code)
       VALUES ($1, 'Test partner', $2, 'x', $3)`,
      [partnerId, `p_${partnerId.slice(0, 8)}@example.test`, 'REF' + partnerId.slice(0, 8)],
    );
    try {
      await query(
        `INSERT INTO partner_commissions (partner_id, business_id, billing_transaction_id, sale_amount, commission_type, commission_rate, commission_amount, eligible_at)
         VALUES ($1, $2, $3, 499, 'percentage', 20, 99.8, NOW())`,
        [partnerId, b.id, tx],
      );
      await deleteBusinessCompletely(b.id, ADMIN);
      expect(await cnt(`billing_transactions_archive WHERE id = $1`, [tx])).toBe(1);
      expect(await cnt(`partner_commissions WHERE billing_transaction_id = $1`, [tx])).toBe(0);
    } finally {
      await query(`DELETE FROM platform_partners WHERE id = $1`, [partnerId]);
    }
  });

  it('a failed delete leaves no archive rows behind', async () => {
    // Real blocker, no mocks: another tenant's period_locks row points at a user of the business
    // (locked_by, NO ACTION). purgeTenantRows only deletes blockers that belong to the business being
    // purged, so it cannot clear this one and the delete fails after the archive step has run.
    const a = await biz('failA');
    const other = await biz('failOther');
    const tx = await paidTx(a.id);
    await query(
      `INSERT INTO period_locks (business_id, financial_year, period_start, period_end, is_locked, locked_by)
       VALUES ($1, '2024-2025', '2024-04-01', '2025-03-31', false, $2)`,
      [other.id, a.userId],
    );
    await expect(deleteBusinessCompletely(a.id, ADMIN)).rejects.toThrow(/Cannot delete tenant|Failed to delete tenant/);
    expect(await cnt(`businesses WHERE id = $1`, [a.id])).toBe(1);
    expect(await cnt(`billing_transactions WHERE id = $1`, [tx])).toBe(1);
    expect(await cnt(`billing_transactions_archive WHERE business_id = $1`, [a.id])).toBe(0);
  });

  it('refuses to archive when the archive table does not exist, without touching anything', async () => {
    const b = await biz('noarch');
    const tx = await paidTx(b.id);
    const c = await getPool().connect();
    try {
      await c.query('BEGIN');
      await expect(
        archiveBusinessBillingTransactions(c, b.id, 'x', { archiveTable: 'no_such_table_xyz' }),
      ).rejects.toThrow(ARCHIVE_MISSING_MESSAGE);
      await c.query('ROLLBACK');
    } finally {
      c.release();
    }
    expect(await cnt(`billing_transactions WHERE id = $1`, [tx])).toBe(1);
    expect(await cnt(`billing_transactions_archive WHERE business_id = $1`, [b.id])).toBe(0);
  });

  it('lists archived rows newest first and clamps the limit', async () => {
    const b = await biz('list');
    const t1 = await paidTx(b.id);
    const t2 = await paidTx(b.id);
    const c = await getPool().connect();
    try {
      await archiveBusinessBillingTransactions(c, b.id, 'test');
    } finally {
      c.release();
    }
    await query(`UPDATE billing_transactions_archive SET archived_at = NOW() + interval '1 day' WHERE id = $1`, [t2]);
    const rows = await listArchivedBillingTransactions(200, 0);
    const ids = rows.map((r) => r.id);
    expect(ids.indexOf(t2)).toBeGreaterThanOrEqual(0);
    expect(ids.indexOf(t2)).toBeLessThan(ids.indexOf(t1) === -1 ? Infinity : ids.indexOf(t1));
    for (let i = 1; i < rows.length; i++) {
      expect(new Date(rows[i - 1].archived_at).getTime()).toBeGreaterThanOrEqual(new Date(rows[i].archived_at).getTime());
    }
    expect((await listArchivedBillingTransactions(0, 0)).length).toBe(1);
    expect((await listArchivedBillingTransactions(100000, 0)).length).toBeLessThanOrEqual(200);
  });
});

run('payment records the period it paid for (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];
  const coupons: string[] = [];
  let biz: string;

  async function newBiz(): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Period ${id.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [id]);
    await query(
      `INSERT INTO users (id, business_id, name, phone, is_primary_admin) VALUES ($1, $2, 'Owner', $3, true)`,
      [randomUUID(), id, `9${Math.floor(Math.random() * 1e9).toString().padStart(9, '0')}`],
    );
    return id;
  }

  async function pending(businessId: string, planId: string, amount: number, couponId?: string): Promise<string> {
    const { id } = await recordBillingTransaction({
      businessId, planId, amount, couponId, billingCycle: 'monthly',
      paymentMethod: 'razorpay', status: 'pending', skipEmails: true,
    });
    await query(
      `UPDATE billing_transactions SET gateway_response = '{"checkout_type":"subscription","provider":"razorpay"}'::jsonb WHERE id = $1`,
      [id],
    );
    return id;
  }

  const notes = (b: string, tx: string, planId: string) => ({
    business_id: b, billing_transaction_id: tx, plan_id: planId, billing_cycle: 'monthly',
  });

  async function pay(tx: string, b: string, planId: string, price: number) {
    const raw = JSON.stringify({
      event: 'payment.captured',
      payload: { payment: { entity: { id: 'pay_per_' + randomUUID().slice(0, 10), status: 'captured', amount: Math.round(price * 100), notes: notes(b, tx, planId) } } },
    });
    const sig = createHmac('sha256', 'whsec_plan').update(raw).digest('hex');
    expect(await processPlatformRazorpayWebhook(raw, { 'x-razorpay-signature': sig })).toMatchObject({ ok: true });
  }

  async function period(tx: string) {
    return queryOne<{ period_start: string | null; period_end: string | null }>(
      `SELECT period_start::text, period_end::text FROM billing_transactions WHERE id = $1`, [tx]);
  }

  async function modRow(b: string, key: string) {
    return queryOne<{ start_date: string; end_date: string | null }>(
      `SELECT start_date::text, end_date::text FROM business_module_subscriptions WHERE business_id=$1 AND module_key=$2`, [b, key]);
  }

  async function addonRow(b: string) {
    return queryOne<{ start_date: string; end_date: string | null }>(
      `SELECT start_date::text, end_date::text FROM whatsapp_addons WHERE business_id=$1 AND addon_type='khatario_ai'`, [b]);
  }

  async function payAddonTx(b: string, type: 'khatario_ai' | 'whatsapp_bot' = 'khatario_ai', amount = 299) {
    const { id } = await recordBillingTransaction({
      businessId: b, planId: 'connect', moduleKey: 'connect', amount, billingCycle: 'monthly',
      paymentMethod: 'razorpay', status: 'pending', skipEmails: true,
    });
    await query(
      `UPDATE billing_transactions SET gateway_response = $2::jsonb WHERE id = $1`,
      [id, JSON.stringify({ checkout_type: 'whatsapp_addon', addon_type: type, provider: 'razorpay' })],
    );
    const r = await completeAddonCheckoutPayment({
      businessId: b, billingTransactionId: id, providerPaymentId: 'pay_ap_' + randomUUID().replace(/-/g, '').slice(0, 14), amount,
    });
    return { id, r };
  }

  async function makeFreeMonthsCoupon(months: number): Promise<string> {
    const r = await queryOne<{ id: string }>(
      `INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, 'free_months', $2, 1) RETURNING id`,
      [`PR${randomUUID().slice(0, 10).toUpperCase()}`, months],
    );
    coupons.push(r!.id);
    return r!.id;
  }

  async function planPrice(planId: string): Promise<number> {
    const p = await queryOne<{ price_monthly: string }>(`SELECT price_monthly::text FROM subscription_plans WHERE id=$1`, [planId]);
    return Number(p!.price_monthly);
  }

  beforeAll(async () => {
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network disabled in tests'));
    await query(readFileSync(join(process.cwd(), 'database/migrations/479_billing_record_constraints.sql'), 'utf8'));
  });

  beforeEach(async () => {
    biz = await newBiz();
    clearSubscriptionCache(biz);
    clearModuleSubscriptionCache(biz);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (enabled) {
      for (const id of created) {
        await query(`DELETE FROM platform_billing_webhook_events WHERE business_id = $1 OR payload::text LIKE $2`, [id, `%${id}%`]).catch(() => undefined);
        await query(`DELETE FROM businesses WHERE id = $1`, [id]).catch(() => undefined);
      }
      for (const id of coupons) {
        await query(`DELETE FROM coupon_redemptions WHERE coupon_id = $1`, [id]).catch(() => undefined);
        await query(`DELETE FROM coupons WHERE id = $1`, [id]).catch(() => undefined);
      }
      await closePool();
    }
  });

  it('a completed subscription payment records its period', async () => {
    const price = await planPrice('billing_growth');
    const tx = await pending(biz, 'billing_growth', price);
    await pay(tx, biz, 'billing_growth', price);
    const m = await modRow(biz, 'billing');
    expect(await period(tx)).toEqual({ period_start: m!.start_date, period_end: m!.end_date });
    expect(m!.end_date).not.toBeNull();
  });

  it('free months are inside the recorded period', async () => {
    const coupon = await makeFreeMonthsCoupon(3);
    const tx = await pending(biz, 'billing_growth', 499, coupon);
    await pay(tx, biz, 'billing_growth', 499);
    const m = await modRow(biz, 'billing');
    const p = await period(tx);
    expect(p!.period_end).toBe(m!.end_date);
    expect(p!.period_start).toBe(m!.start_date);
    const expected = await queryOne<{ d: string }>(`SELECT ((CURRENT_DATE + interval '1 month')::date + interval '3 months')::date::text AS d`);
    expect(p!.period_end).toBe(expected!.d);
  });

  it('an early renewal records the new period and leaves the first row unchanged', async () => {
    const price = await planPrice('billing_growth');
    const first = await pending(biz, 'billing_growth', price);
    await pay(first, biz, 'billing_growth', price);
    // Mark the first row with a period no renewal could produce, so any rewrite of it shows.
    await query(`UPDATE billing_transactions SET period_start = '2020-01-01', period_end = '2020-02-01' WHERE id = $1`, [first]);
    const firstPeriod = await period(first);
    const second = await pending(biz, 'billing_growth', price);
    await pay(second, biz, 'billing_growth', price);
    const m = await modRow(biz, 'billing');
    expect(await period(first)).toEqual(firstPeriod);
    expect(await period(second)).toEqual({ period_start: m!.start_date, period_end: m!.end_date });
    expect(firstPeriod).toEqual({ period_start: '2020-01-01', period_end: '2020-02-01' });
  });

  it('a redelivered payment does not rewrite the period', async () => {
    const price = await planPrice('billing_growth');
    const tx = await pending(biz, 'billing_growth', price);
    await pay(tx, biz, 'billing_growth', price);
    await query(`UPDATE billing_transactions SET period_start = '2020-01-01', period_end = '2020-02-01' WHERE id = $1`, [tx]);
    const { completeSubscriptionCheckoutPayment } = await import('@/lib/platform-subscription-checkout');
    const r = await completeSubscriptionCheckoutPayment({
      businessId: biz, planId: 'billing_growth', billingCycle: 'monthly', billingTransactionId: tx,
      providerPaymentId: 'pay_redeliver', amount: price,
    });
    expect(r).toBe('already_completed');
    expect(await period(tx)).toEqual({ period_start: '2020-01-01', period_end: '2020-02-01' });
  });

  it('an add-on payment records its month', async () => {
    const { id } = await payAddonTx(biz);
    const a = await addonRow(biz);
    expect(await period(id)).toEqual({ period_start: a!.start_date, period_end: a!.end_date });
    const today = await queryOne<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
    expect((await period(id))!.period_start).toBe(today!.d);
  });

  it('a second add-on payment starts where the first ended', async () => {
    const one = await payAddonTx(biz);
    const two = await payAddonTx(biz);
    const p1 = await period(one.id);
    const p2 = await period(two.id);
    const a = await addonRow(biz);
    expect(p2!.period_start).toBe(p1!.period_end);
    expect(p2!.period_end).toBe(a!.end_date);
    expect(await period(one.id)).toEqual(p1);
  });

  it('an add-on payment after it ended starts today', async () => {
    const one = await payAddonTx(biz);
    await query(`UPDATE whatsapp_addons SET status='expired', end_date = CURRENT_DATE - 10 WHERE business_id=$1 AND addon_type='khatario_ai'`, [biz]);
    const two = await payAddonTx(biz);
    const today = await queryOne<{ d: string }>(`SELECT CURRENT_DATE::text AS d`);
    const a = await addonRow(biz);
    expect(await period(two.id)).toEqual({ period_start: today!.d, period_end: a!.end_date });
    expect(one.id).not.toBe(two.id);
  });

  it('a legacy add-on payment records the Connect month it granted', async () => {
    const { id } = await payAddonTx(biz, 'whatsapp_bot', 299);
    const m = await modRow(biz, 'connect');
    expect(await period(id)).toEqual({ period_start: m!.start_date, period_end: m!.end_date });
    const second = await payAddonTx(biz, 'whatsapp_bot', 299);
    const m2 = await modRow(biz, 'connect');
    expect((await period(second.id))).toEqual({ period_start: m!.end_date, period_end: m2!.end_date });
  });

  it('a 100% coupon upgrade records the period on its zero-amount row', async () => {
    const coupon = await queryOne<{ id: string }>(
      `INSERT INTO coupons (code, type, value, max_per_business) VALUES ($1, 'percentage', 100, 1) RETURNING id`,
      [`PR${randomUUID().slice(0, 10).toUpperCase()}`],
    );
    coupons.push(coupon!.id);
    const { applyInstantPlanUpgradeWithCoupon } = await import('@/lib/subscription/apply-coupon-upgrade');
    await applyInstantPlanUpgradeWithCoupon({
      businessId: biz, planId: 'billing_growth', planDisplayName: 'Growth', billingCycle: 'monthly',
      pricing: { baseAmount: 499, discountAmount: 499, finalAmount: 0, couponId: coupon!.id },
    });
    const row = await queryOne<{ id: string }>(
      `SELECT id FROM billing_transactions WHERE business_id=$1 AND payment_method='coupon'`, [biz]);
    const m = await modRow(biz, 'billing');
    expect(await period(row!.id)).toEqual({ period_start: m!.start_date, period_end: m!.end_date });
  });
});
