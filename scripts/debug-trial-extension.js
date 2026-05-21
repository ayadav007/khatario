require('dotenv').config();
const { Pool } = require('pg');
const { getMigrationDbConfig } = require('./db-config');
const pool = new Pool(getMigrationDbConfig());

async function main() {
  const name = process.argv[2] || 'Shalini';
  const backdate = process.argv.includes('--backdate');

  if (backdate) {
    const biz = await pool.query(
      `SELECT b.id FROM businesses b WHERE b.name ILIKE $1 LIMIT 1`,
      [`%${name}%`],
    );
    if (!biz.rows[0]) {
      console.error('Business not found');
      process.exit(1);
    }
    const explicitDate = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
    await pool.query(
      explicitDate
        ? `UPDATE business_subscriptions
           SET trial_end_date = $2::date,
               trial_extension_granted = false,
               trial_extension_declined_at = NULL,
               updated_at = CURRENT_TIMESTAMP
           WHERE business_id = $1`
        : `UPDATE business_subscriptions
       SET trial_end_date = (CURRENT_DATE - INTERVAL '1 day')::date,
           trial_extension_granted = false,
           trial_extension_declined_at = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE business_id = $1`,
      explicitDate ? [biz.rows[0].id, explicitDate] : [biz.rows[0].id],
    );
    console.log(
      'Set trial_end_date for',
      biz.rows[0].id,
      explicitDate || 'yesterday',
    );
  }

  const r = await pool.query(
    `SELECT b.id, b.name,
            bs.plan_id, bs.status, bs.trial_end_date::text,
            bs.trial_extension_granted, bs.trial_extension_declined_at::text,
            bs.grace_period_end::text, bs.downgraded_from, bs.created_at
     FROM businesses b
     LEFT JOIN business_subscriptions bs ON bs.business_id = b.id
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
