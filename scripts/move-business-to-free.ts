/**
 * Move one business's primary product to its Free plan (fixes stale Trial rows).
 * Usage: npx tsx scripts/move-business-to-free.ts [business_id]
 * Default: Prem Traders (6913a954-b0ba-4ff2-b3be-62a597a7a91b)
 */
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.join(process.cwd(), '.env') });
dotenv.config({ path: path.join(process.cwd(), '.env.local') });

const PREM_TRADERS_ID = '6913a954-b0ba-4ff2-b3be-62a597a7a91b';

const PRIMARY_ROW_SQL = `
  SELECT bms.module_key, bms.plan_id, bms.status, bms.end_date::text, bms.trial_end_date::text
    FROM business_module_subscriptions bms
    JOIN businesses b ON b.id = bms.business_id
   WHERE bms.business_id = $1
   ORDER BY (bms.module_key = COALESCE(b.primary_module, 'billing')) DESC, bms.module_key
   LIMIT 1`;

async function main() {
  const businessId = process.argv[2] || PREM_TRADERS_ID;
  const { queryOne, getPool } = await import('../lib/db');
  const { moveSubscriptionToFree } = await import('../lib/subscription/lifecycle');

  const before = await queryOne<{
    module_key: string;
    plan_id: string;
    status: string;
    end_date: string | null;
    trial_end_date: string | null;
  }>(PRIMARY_ROW_SQL, [businessId]);

  if (!before) {
    console.error('No subscription row for business', businessId);
    process.exit(1);
  }

  console.log('Before:', before);

  await moveSubscriptionToFree(
    businessId,
    before.plan_id,
    'admin_fix',
    before.module_key as 'billing' | 'hr' | 'connect' | 'crm',
  );

  const after = await queryOne(PRIMARY_ROW_SQL, [businessId]);

  console.log('After:', after);
  await getPool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
