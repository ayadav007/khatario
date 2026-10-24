/**
 * business_module_subscriptions is the only subscription record. Real-PostgreSQL checks for the
 * paths that used to depend on business_subscriptions. Opt-in, disposable DB only:
 *   SUBSCRIPTION_DB_TEST=1 npx jest tests/db/module-subscription-sole-source.db.test.ts --runInBand
 * (or set PHASE2_TEST_DATABASE_URL). Connection details come from .env with the database forced
 * to kh_phase2_test; migration 359 must be applied there.
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
jest.mock('@/lib/platform-billing', () => ({ recordUpgradeBilling: jest.fn() }));

import { getPool, query, queryOne, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { checkLimit, clearSubscriptionCache } from '@/lib/subscription';
import { adminUpdateSubscription } from '@/lib/admin-business-ops';
import { seedInitialModuleSubscription } from '@/lib/subscription/module-subscriptions';
import { processExpiredModuleSubscriptions } from '@/lib/subscription/lifecycle';

const run = enabled ? describe : describe.skip;

run('module subscriptions as the sole record (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];

  async function newBusiness(label: string): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Sole source ${label} ${id.slice(0, 6)}`],
    );
    await query(
      `INSERT INTO business_modules (business_id, module_key, enabled, source)
       VALUES ($1, 'billing', true, 'test')`,
      [id],
    );
    return id;
  }

  async function billingRow(businessId: string) {
    return queryOne<{ plan_id: string; status: string; trial_end_date: string | null }>(
      `SELECT plan_id, status, trial_end_date::text
       FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`,
      [businessId],
    );
  }

  async function legacyRowCount(businessId: string): Promise<number> {
    const legacy = await queryOne<{ t: string | null }>(
      `SELECT to_regclass('public.business_subscriptions')::text AS t`,
    );
    if (!legacy?.t) return 0;
    const row = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM business_subscriptions WHERE business_id = $1`,
      [businessId],
    );
    return row?.n ?? 0;
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const col = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'business_module_subscriptions' AND column_name = 'trial_extension_granted'`,
    );
    if (!col?.n) throw new Error('Apply migration 359 to kh_phase2_test first');
  });

  afterAll(async () => {
    try {
      if (created.length) {
        await query(`DELETE FROM subscription_events WHERE business_id = ANY($1::uuid[])`, [created]);
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

  it('signup seeding writes only the module row', async () => {
    const biz = await newBusiness('signup');
    await seedInitialModuleSubscription({ query }, biz, 'billing', 'trial', 'trial', 14);

    const row = await billingRow(biz);
    expect(row).toMatchObject({ plan_id: 'trial', status: 'trial' });
    expect(row?.trial_end_date).not.toBeNull();
    expect(await legacyRowCount(biz)).toBe(0);
  });

  it('checkLimit gives an enabled product with no row its free plan', async () => {
    const biz = await newBusiness('fallback');
    expect(await billingRow(biz)).toBeNull();

    const result = await checkLimit(biz, 'invoices');

    expect(await billingRow(biz)).toMatchObject({ plan_id: 'free', status: 'active' });
    expect(result.limit).not.toBe(0);
    expect(result.allowed).toBe(true);
    expect(await legacyRowCount(biz)).toBe(0);
  });

  it('checkLimit leaves an expired row alone', async () => {
    const biz = await newBusiness('expired');
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', 'business', 'expired', CURRENT_DATE - 60, CURRENT_DATE - 30)`,
      [biz],
    );

    const result = await checkLimit(biz, 'invoices');

    expect(result.allowed).toBe(false);
    expect(await billingRow(biz)).toMatchObject({ plan_id: 'business', status: 'expired' });
  });

  it('an admin Free/active save on the billing product unblocks invoices', async () => {
    const biz = await newBusiness('admin-free');
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', 'business', 'expired', CURRENT_DATE - 60, CURRENT_DATE - 30)`,
      [biz],
    );
    expect((await checkLimit(biz, 'invoices')).allowed).toBe(false);

    await adminUpdateSubscription({
      businessId: biz,
      adminId: randomUUID(),
      moduleKey: 'billing',
      planId: 'free',
      status: 'active',
    });
    clearSubscriptionCache(biz);

    expect(await billingRow(biz)).toMatchObject({ plan_id: 'free', status: 'active' });
    const after = await checkLimit(biz, 'invoices');
    expect(after.allowed).toBe(true);
    expect(after.limit).not.toBe(0);
  });

  it('rejects a paid plan with status expired', async () => {
    const biz = await newBusiness('paid-expired');
    await expect(
      adminUpdateSubscription({
        businessId: biz,
        adminId: randomUUID(),
        moduleKey: 'billing',
        planId: 'growth',
        status: 'expired',
      }),
    ).rejects.toThrow(/not allowed/i);
    expect(await billingRow(biz)).toBeNull();
  });

  it('rejects a plan from another product', async () => {
    const biz = await newBusiness('wrong-product');
    await expect(
      adminUpdateSubscription({
        businessId: biz,
        adminId: randomUUID(),
        moduleKey: 'billing',
        planId: 'hr_pro',
        status: 'active',
      }),
    ).rejects.toThrow(/belongs to hr/i);
  });

  it('cron moves an ended extended trial to the free plan', async () => {
    const biz = await newBusiness('ext-trial');
    await query(
      `INSERT INTO business_module_subscriptions (
         business_id, module_key, plan_id, status, start_date, trial_end_date, trial_extension_granted
       ) VALUES ($1, 'billing', 'trial', 'trial', CURRENT_DATE - 30, CURRENT_DATE - 1, true)`,
      [biz],
    );

    const counts = await processExpiredModuleSubscriptions();

    expect(counts.trialExpired).toBeGreaterThanOrEqual(1);
    expect(await billingRow(biz)).toMatchObject({ plan_id: 'free', status: 'active' });
    const moved = await queryOne<{ downgraded_from: string | null }>(
      `SELECT downgraded_from FROM business_module_subscriptions WHERE business_id = $1 AND module_key = 'billing'`,
      [biz],
    );
    expect(moved?.downgraded_from).toBe('trial');
  });
});
