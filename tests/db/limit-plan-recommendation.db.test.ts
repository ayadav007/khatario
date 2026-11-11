/**
 * Recommended plan for every limit, from the owning product's plans only. Read-only, disposable DB:
 *   SUBSCRIPTION_DB_TEST=1 npx jest tests/db/limit-plan-recommendation.db.test.ts --runInBand
 * Connection details come from .env with the database forced to kh_phase2_test (migration 387 applied).
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

import { queryOne, closePool } from '@/lib/db';
import { getLowestPlanForLimit } from '@/lib/subscription/limit-plan-recommendation';

const run = enabled ? describe : describe.skip;

run('getLowestPlanForLimit (kh_phase2_test)', () => {
  jest.setTimeout(60000);
  afterAll(async () => {
    await closePool();
  });

  async function lineOf(planId: string): Promise<string> {
    const row = await queryOne<{ product_line: string | null }>(
      'SELECT product_line FROM subscription_plans WHERE id = $1',
      [planId],
    );
    return row?.product_line ?? 'billing';
  }

  it('a second user on Free points to Starter', async () => {
    const plan = await getLowestPlanForLimit('users', 1);
    expect(plan?.planId).toBe('billing_starter');
  });

  it('billing limits beyond the old five get a billing plan', async () => {
    const plan = await getLowestPlanForLimit('estimates', 20);
    expect(plan).not.toBeNull();
    expect(await lineOf(plan!.planId)).toBe('billing');
  });

  it('employee limits get an HR plan, not a billing plan', async () => {
    const plan = await getLowestPlanForLimit('employees', 5);
    expect(plan).not.toBeNull();
    expect(await lineOf(plan!.planId)).toBe('hr');
  });
});
