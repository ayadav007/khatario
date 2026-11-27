/**
 * Read-only check that migration 479 objects are really in place (the migration skips a rule with a
 * NOTICE when existing data blocks it). Uses the same DB env vars as scripts/run-pending-migrations.js.
 * Only SELECTs. Exits 1 when anything is missing.
 *
 *   node scripts/check-billing-constraints.js
 */
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig, describeMigrationDb } = require('./db-config');

async function main() {
  loadEnvFiles();
  const config = getMigrationDbConfig();
  const pool = new Pool(config);
  let missing = false;
  try {
    console.log(`DB: ${describeMigrationDb(config)}`);
    const idx = await pool.query(
      `SELECT indexname FROM pg_indexes WHERE indexname = 'uq_billing_tx_completed_payment_ref'`,
    );
    const con = await pool.query(
      `SELECT conname FROM pg_constraint WHERE conname = 'bms_billing_cycle_check'`,
    );
    const arch = await pool.query(`SELECT to_regclass('public.billing_transactions_archive') AS t`);

    const idxOk = idx.rowCount > 0;
    const conOk = con.rowCount > 0;
    const archOk = Boolean(arch.rows[0] && arch.rows[0].t);
    console.log(`uq_billing_tx_completed_payment_ref: ${idxOk ? 'OK' : 'MISSING'}`);
    console.log(`bms_billing_cycle_check: ${conOk ? 'OK' : 'MISSING'}`);
    console.log(`billing_transactions_archive: ${archOk ? 'OK' : 'MISSING'}`);
    missing = !(idxOk && conOk && archOk);

    if (!idxOk) {
      const dups = await pool.query(
        `SELECT payment_method, payment_reference, COUNT(*)::int AS count
           FROM billing_transactions
          WHERE status = 'completed'
            AND payment_reference IS NOT NULL
            AND payment_method IN ('razorpay', 'easebuzz')
          GROUP BY payment_method, payment_reference
         HAVING COUNT(*) > 1
          ORDER BY payment_method, payment_reference`,
      );
      if (dups.rowCount === 0) {
        console.log('No duplicate completed payment references found.');
      } else {
        console.log('Duplicate completed payment references (method, reference, count):');
        for (const d of dups.rows) console.log(`  ${d.payment_method}, ${d.payment_reference}, ${d.count}`);
      }
    }
  } finally {
    await pool.end();
  }
  if (missing) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
