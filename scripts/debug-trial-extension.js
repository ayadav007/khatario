require('dotenv').config();
const { Pool } = require('pg');
const { getMigrationDbConfig } = require('./db-config');
const pool = new Pool(getMigrationDbConfig());

async function main() {
  const name = process.argv[2] || 'Shalini';
  const backdate = process.argv.includes('--backdate');

  if (backdate) {
    const biz = await pool.query(
      `SELECT b.id, COALESCE(b.primary_module, 'billing') AS module_key
       FROM businesses b WHERE b.name ILIKE $1 LIMIT 1`,
      [`%${name}%`],
    );
    if (!biz.rows[0]) {
      console.error('Business not found');
      process.exit(1);
    }
    const explicitDate = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    await pool.query(
      `UPDATE business_module_subscriptions
       SET trial_end_date = ${explicitDate ? '$3::date' : `(CURRENT_DATE - INTERVAL '1 day')::date`},
           trial_extension_granted = false,
           trial_extension_declined_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1 AND module_key = $2`,
      explicitDate
        ? [biz.rows[0].id, biz.rows[0].module_key, explicitDate]
        : [biz.rows[0].id, biz.rows[0].module_key],
    );
    console.log('Set trial_end_date for', biz.rows[0].id, explicitDate || 'yesterday');
  }

  const r = await pool.query(
    `SELECT b.id, b.name, m.module_key,
            m.plan_id, m.status, m.trial_end_date::text,
            m.trial_extension_granted, m.trial_extension_declined_at::text,
            m.grace_period_end::text, m.downgraded_from, m.created_at
     FROM businesses b
     LEFT JOIN business_module_subscriptions m
       ON m.business_id = b.id AND m.module_key = COALESCE(b.primary_module, 'billing')
     WHERE b.name ILIKE $1
     ORDER BY b.name`,
    [`%${name}%`],
  );
  console.log(JSON.stringify(r.rows, null, 2));

  for (const row of r.rows) {
    if (!row.id) continue;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const trialEnd = row.trial_end_date ? new Date(row.trial_end_date) : null;
    console.log('--- eligibility ---');
    console.log({
      plan_id: row.plan_id,
      trial_end_date: row.trial_end_date,
      trial_extension_granted: row.trial_extension_granted,
      trial_extension_declined_at: row.trial_extension_declined_at,
      calendarExpired: trialEnd ? today > trialEnd : null,
      offerModal:
        row.plan_id === 'trial' &&
        !row.trial_extension_granted &&
        !row.trial_extension_declined_at &&
        trialEnd &&
        today > trialEnd,
    });
  }
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
