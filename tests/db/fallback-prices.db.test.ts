/**
 * The outage fallback price table must equal the seeded catalogue. Opt-in, disposable DB only:
 *   SUBSCRIPTION_DB_TEST=1 npx jest tests/db/fallback-prices.db.test.ts --runInBand
 * (or PHASE2_TEST_DATABASE_URL pointing at kh_phase2_test).
 */
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

import { queryRows, closePool } from '@/lib/db';
import { FALLBACK_PRICING_CATALOG } from '@/lib/landing-pricing-fallback';

const run = enabled ? describe : describe.skip;

run('outage fallback prices equal the seeded catalogue (kh_phase2_test)', () => {
  afterAll(async () => {
    await closePool();
  });

  it('every on-sale plan is in the fallback with the seeded prices, and the fallback has no other plan', async () => {
    const rows = await queryRows<{
      id: string;
      price_monthly: string;
      price_yearly: string;
      price_3year: string;
      product_line: string;
      bundled_hr_plan_id: string | null;
    }>(
      `SELECT id, price_monthly, price_yearly, price_3year, product_line, bundled_hr_plan_id
         FROM subscription_plans WHERE is_active = true AND is_public = true ORDER BY sort_order`,
    );
    expect(rows.length).toBeGreaterThan(0);
    const fallback = new Map(FALLBACK_PRICING_CATALOG.plans.map((p) => [p.id, p]));
    for (const row of rows) {
      const plan = fallback.get(row.id);
      expect({ id: row.id, inFallback: !!plan }).toEqual({ id: row.id, inFallback: true });
      expect({ id: row.id, monthly: plan!.priceMonthly, yearly: plan!.priceYearly, threeYear: plan!.price3Year }).toEqual({
        id: row.id,
        monthly: Number(row.price_monthly),
        yearly: Number(row.price_yearly),
        threeYear: Number(row.price_3year),
      });
      expect({ id: row.id, line: plan!.productLine, hr: plan!.bundledHrPlanId }).toEqual({
        id: row.id,
        line: row.product_line,
        hr: row.bundled_hr_plan_id,
      });
    }
    expect([...fallback.keys()].sort()).toEqual(rows.map((r) => r.id).sort());
  });
});
