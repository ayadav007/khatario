/**
 * Billing plan ladder (migration 387): Free is phone-only, Starter / Growth / Business bundle
 * HR Lite / HR Starter / HR Pro. Opt-in, disposable DB only:
 *   SUBSCRIPTION_DB_TEST=1 npx jest tests/db/billing-plan-ladder.db.test.ts --runInBand
 * Connection details come from .env with the database forced to kh_phase2_test;
 * migrations 386 and 387 must be applied there.
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

import { getPool, query, queryOne, closePool } from '@/lib/db';
import { withLedgerDelete } from '@/lib/accounting/ledger-delete-guard';
import { clearAllSubscriptionCaches, hasFeature } from '@/lib/subscription';
import { ensureComplimentaryHrForBilling } from '@/lib/subscription/ensure-complimentary-hr';
import { businessHasWebAccess } from '@/lib/subscription/web-access';
import { planOpenToBusiness } from '@/lib/subscription/public-plans';

const run = enabled ? describe : describe.skip;

run('billing plan ladder (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  const created: string[] = [];

  async function newBusiness(billingPlan: string): Promise<string> {
    const id = randomUUID();
    created.push(id);
    await query(
      `INSERT INTO businesses (id, name, gstin, state_code, gst_registration_type, primary_module)
       VALUES ($1, $2, '27AAAPA1234A1Z5', '27', 'regular', 'billing')`,
      [id, `Ladder ${billingPlan} ${id.slice(0, 6)}`],
    );
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'billing', true, 'test')`, [id]);
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date, end_date)
       VALUES ($1, 'billing', $2, 'active', CURRENT_DATE, CURRENT_DATE + 30)`,
      [id, billingPlan],
    );
    return id;
  }

  async function setBilling(businessId: string, planId: string): Promise<void> {
    await query(`UPDATE business_module_subscriptions SET plan_id = $2 WHERE business_id = $1 AND module_key = 'billing'`, [
      businessId,
      planId,
    ]);
    clearAllSubscriptionCaches();
  }

  async function hr(businessId: string) {
    return queryOne<{ plan_id: string; enabled: boolean; source: string }>(
      `SELECT s.plan_id, m.enabled, m.source
       FROM business_module_subscriptions s
       JOIN business_modules m ON m.business_id = s.business_id AND m.module_key = 'hr'
       WHERE s.business_id = $1 AND s.module_key = 'hr'`,
      [businessId],
    );
  }

  /** The bundled HR plan, or null when this database lacks it (kh_phase2_test has no hr_staff_lite). */
  async function bundleOf(planId: string): Promise<string | null> {
    const row = await queryOne<{ hr: string | null }>(`SELECT bundled_hr_plan_id AS hr FROM subscription_plans WHERE id = $1`, [planId]);
    return row?.hr ?? null;
  }

  beforeAll(async () => {
    const db = await queryOne<{ db: string }>('SELECT current_database() AS db');
    if (db?.db !== TEST_DB) throw new Error(`Refusing to run against ${db?.db}`);
    const col = await queryOne<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM information_schema.columns
       WHERE table_name = 'subscription_plans' AND column_name = 'bundled_hr_plan_id'`,
    );
    if (!col?.n) throw new Error('Apply migration 387 to kh_phase2_test first');
  });

  beforeEach(() => clearAllSubscriptionCaches());

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

  it('offers Free, Starter, Growth and Business and keeps the old plans for existing customers only', async () => {
    const rows = await query<{ id: string; price: string; is_public: boolean }>(
      `SELECT id, price_monthly::int::text AS price, is_public FROM subscription_plans
       WHERE id IN ('free', 'billing_starter', 'billing_growth', 'billing_business', 'growth', 'business')`,
    );
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId.free).toMatchObject({ price: '0', is_public: true });
    expect(byId.billing_starter).toMatchObject({ price: '299', is_public: true });
    expect(byId.billing_growth).toMatchObject({ price: '499', is_public: true });
    expect(byId.billing_business).toMatchObject({ price: '799', is_public: true });
    expect(byId.growth.is_public).toBe(false);
    expect(byId.business.is_public).toBe(false);

    const onClassic = await newBusiness('growth');
    const onFree = await newBusiness('free');
    expect(await planOpenToBusiness(onClassic, 'growth')).toBe(true);
    expect(await planOpenToBusiness(onFree, 'growth')).toBe(false);
    expect(await planOpenToBusiness(onFree, 'billing_growth')).toBe(true);
  });

  it('keeps Free on the phone app and opens the website from Starter', async () => {
    const id = await newBusiness('free');
    expect(await businessHasWebAccess(id)).toBe(false);
    expect(await hasFeature(id, 'settings_pos_mode')).toBe(false);
    await setBilling(id, 'billing_starter');
    expect(await businessHasWebAccess(id)).toBe(true);
    expect(await hasFeature(id, 'settings_pos_mode')).toBe(true);
    expect(await hasFeature(id, 'advanced_ledger')).toBe(false);
    await setBilling(id, 'billing_growth');
    expect(await hasFeature(id, 'advanced_ledger')).toBe(true);
    expect(await hasFeature(id, 'settings_multi_branch')).toBe(false);
    await setBilling(id, 'billing_business');
    expect(await hasFeature(id, 'settings_multi_branch')).toBe(true);
  });

  it('moves bundled HR with the Billing plan and removes it on Free', async () => {
    const id = await newBusiness('billing_business');
    await ensureComplimentaryHrForBilling(id);
    expect(await hr(id)).toMatchObject({ plan_id: 'hr_pro', enabled: true, source: 'complimentary' });

    await setBilling(id, 'billing_growth');
    await ensureComplimentaryHrForBilling(id);
    expect(await hr(id)).toMatchObject({ plan_id: 'hr_starter', enabled: true });

    await setBilling(id, 'billing_starter');
    await ensureComplimentaryHrForBilling(id);
    const starterBundle = (await bundleOf('billing_starter')) ?? 'hr_free';
    expect((await hr(id))?.plan_id).toBe(starterBundle);

    await setBilling(id, 'free');
    await ensureComplimentaryHrForBilling(id);
    expect(await hr(id)).toMatchObject({ plan_id: 'hr_free', enabled: false });
  });

  it('does not take away HR the business bought separately', async () => {
    const id = await newBusiness('billing_growth');
    await query(`INSERT INTO business_modules (business_id, module_key, enabled, source) VALUES ($1, 'hr', true, 'upgrade')`, [id]);
    await query(
      `INSERT INTO business_module_subscriptions (business_id, module_key, plan_id, status, start_date)
       VALUES ($1, 'hr', 'hr_starter', 'active', CURRENT_DATE)`,
      [id],
    );
    await setBilling(id, 'free');
    await ensureComplimentaryHrForBilling(id);
    expect(await hr(id)).toMatchObject({ plan_id: 'hr_starter', enabled: true, source: 'upgrade' });

    await setBilling(id, 'billing_business');
    await ensureComplimentaryHrForBilling(id);
    expect(await hr(id)).toMatchObject({ plan_id: 'hr_pro', source: 'complimentary' });
  });
});
