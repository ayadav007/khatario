/**
 * Move one business to the Free plan (fixes stale Trial rows).
 * Usage: npx tsx scripts/move-business-to-free.ts [business_id]
 * Default: Prem Traders (6913a954-b0ba-4ff2-b3be-62a597a7a91b)
 */
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const PREM_TRADERS_ID = '6913a954-b0ba-4ff2-b3be-62a597a7a91b';

async function main() {
  const businessId = process.argv[2] || PREM_TRADERS_ID;
  const { queryOne, getPool } = await import('../lib/db');
  const { moveSubscriptionToFree } = await import('../lib/subscription/lifecycle');

  const before = await queryOne<{
    plan_id: string;
    status: string;
    end_date: string | null;
    trial_end_date: string | null;
  }>(
    `SELECT plan_id, status, end_date::text, trial_end_date::text
     FROM business_subscriptions WHERE business_id = $1`,
    [businessId],
  );

  if (!before) {
    console.error('No subscription row for business', businessId);
    process.exit(1);
  }

  console.log('Before:', before);

  await moveSubscriptionToFree(businessId, before.plan_id, 'admin_fix');

  const after = await queryOne(
    `SELECT plan_id, status, end_date, trial_end_date
     FROM business_subscriptions WHERE business_id = $1`,
    [businessId],
  );

  console.log('After:', after);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
