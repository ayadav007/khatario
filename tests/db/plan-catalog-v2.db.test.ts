/**
 * Plan catalogue v2 (migration 360): Free / Growth / Business billing plans and the paid Connect
 * add-on. Opt-in, disposable DB only:
 *   SUBSCRIPTION_DB_TEST=1 npx jest tests/db/plan-catalog-v2.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migration 360 must be applied there.
 */
import { randomUUID } from 'crypto';
import { config as loadEnv } from 'dotenv';

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
}));
jest.mock('@/lib/platform-billing', () => ({
  recordBillingTransaction: jest.fn(async () => ({ id: 'tx' })),
  updateBillingTransactionStatus: jest.fn(),
  recordUpgradeBilling: jest.fn(),
}));

import { getPool, query, queryOne, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import {
  clearAllSubscriptionCaches,
  hasFeature,
  hasWhatsAppBotAddon,
  resolvePlanLimitValue,
} from '@/lib/subscription';
import { khatarioMonthlyQuota } from '@/lib/ai-agent/billing';
import { completeAddonCheckoutPayment } from '@/lib/platform-addon-checkout';

const run = enabled ? describe : describe.skip;

run('plan catalogue v2 (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];

  async function newBusiness(label: string, billingPlan: string): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Plan v2 ${label} ${id.slice(0, 6)}`],
    );
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`,
      [id],
    );
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [id, billingPlan],
    );
    return id;
  }

  async function addConnect(businessId: string, planId: 'connect' | 'connect_free'): Promise<void> {
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'connect', true, 'test')`,
      [businessId],
    );
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'connect', $2, 'active', CURRENT_DATE, $3)`,
      [businessId, planId, planId === 'connect' ? new Date(Date.now() + 30 * 86400000) : null],
    );
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const col = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'subscription_plans' AND column_name = 'price_3year'`,
    );
    if (!col?.n) throw new Error('Apply migration 360 to kh_phase2_test first');
  });

  beforeEach(() => clearAllSubscriptionCaches());

  afterAll(async () => {
    try {
      if (created.length) {
        await query(`DELETE FROM subscription_events WHERE business_id = ANY($1::uuid[])`, [created]);
        await query(`DELETE FROM notifications WHERE business_id = ANY($1::uuid[])`, [created]);
        const c = await getPool().connect();
        try {
          await c.query('BEGIN');
          await withLedgerDelete(c, 'tenant_purge', null, async () => {
            await c.query(`DELETE FROM businesses WHERE id = ANY($1::uuid[])`, [created]);
          });
          await c.query('COMMIT');
        } catch (e) {
          await c.query('ROLLBACK');
          throw e;
        } finally {
          c.release();
        }
      }
    } finally {
      await closePool();
    }
  });

  it('seeds the catalogue with editable 3-year prices and retires the old plans', async () => {
    const rows = await query<{ id: string; is_active: boolean; price_3year: string }>(
      `SELECT id, is_active, price_3year::text FROM subscription_plans
       WHERE id IN ('free', 'growth', 'business', 'connect', 'connect_free', 'professional', 'enterprise')`,
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId.growth.is_active).toBe(true);
    expect(byId.business.is_active).toBe(true);
    expect(byId.connect.is_active).toBe(true);
    expect(Number(byId.connect.price_3year)).toBeGreaterThan(0);
    expect(byId.professional?.is_active ?? false).toBe(false);
    expect(byId.enterprise?.is_active ?? false).toBe(false);
  });

  it('Free can link WhatsApp but auto reminders start on Growth', async () => {
    const free = await newBusiness('free', 'free');
    const growth = await newBusiness('growth', 'growth');

    expect(await hasFeature(free, 'settings_whatsapp')).toBe(true);
    expect(await hasFeature(free, 'whatsapp_auto_reminders')).toBe(false);
    expect(await hasFeature(growth, 'whatsapp_auto_reminders')).toBe(true);
  });

  it('only a paid Connect subscription unlocks the Connect features and AI quota', async () => {
    const lapsed = await newBusiness('connect-free', 'business');
    await addConnect(lapsed, 'connect_free');
    const paid = await newBusiness('connect-paid', 'free');
    await addConnect(paid, 'connect');

    expect(await hasWhatsAppBotAddon(lapsed, true)).toBe(false);
    expect(await khatarioMonthlyQuota(lapsed)).toBe(0);

    expect(await hasWhatsAppBotAddon(paid, true)).toBe(true);
    expect(await khatarioMonthlyQuota(paid)).toBe(
      await resolvePlanLimitValue('connect', 'max_ai_replies_per_month'),
    );
  });

  it('a late-paid legacy Bot add-on checkout grants a month of Connect', async () => {
    const biz = await newBusiness('legacy-checkout', 'growth');
    expect(await hasWhatsAppBotAddon(biz, true)).toBe(false);

    await completeAddonCheckoutPayment({ businessId: biz, addonType: 'whatsapp_bot', amount: 499 });

    const row = await queryOne<{ plan_id: string; status: string; months: number }>(
      `SELECT plan_id, status,
              (EXTRACT(YEAR FROM age(end_date, CURRENT_DATE)) * 12 + EXTRACT(MONTH FROM age(end_date, CURRENT_DATE)))::int AS months
       FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'connect'`,
      [biz],
    );
    expect(row).toMatchObject({ plan_id: 'connect', status: 'active', months: 1 });
    expect(await hasWhatsAppBotAddon(biz, true)).toBe(true);
  });
});
