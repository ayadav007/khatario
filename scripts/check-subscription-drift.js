#!/usr/bin/env node
/**
 * Read-only check before/after migration 359.
 * Lists businesses whose legacy business_subscriptions row disagrees with their primary-module
 * row, and enabled modules that have no business_module_subscriptions row.
 * Usage: node scripts/check-subscription-drift.js
 */
require('dotenv').config();
const { Pool } = require('pg');
const { getMigrationDbConfig } = require('./db-config');

const pool = new Pool(getMigrationDbConfig());

async function main() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');

    const legacyExists = await client.query(
      `SELECT to_regclass('public.business_subscriptions') IS NOT NULL AS exists`,
    );

    if (legacyExists.rows[0].exists) {
      const drift = await client.query(
        `SELECT b.name, b.id AS business_id, COALESCE(b.primary_module, 'billing') AS module_key,
                bs.plan_id AS legacy_plan, bs.status AS legacy_status,
                m.plan_id AS module_plan, m.status AS module_status
         FROM business_subscriptions bs
         JOIN businesses b ON b.id = bs.business_id
         LEFT JOIN business_module_subscriptions m
           ON m.business_id = bs.business_id AND m.module_key = COALESCE(b.primary_module, 'billing')
         WHERE m.business_id IS NULL OR m.plan_id <> bs.plan_id OR m.status <> bs.status
         ORDER BY b.name`,
      );
      console.log(`Legacy vs primary-module mismatches: ${drift.rowCount}`);
      if (drift.rowCount) console.table(drift.rows);
    } else {
      console.log('business_subscriptions no longer exists; skipping legacy comparison.');
    }

    const missing = await client.query(
      `SELECT b.name, bm.business_id, bm.module_key
       FROM business_modules bm
       JOIN businesses b ON b.id = bm.business_id
       WHERE bm.enabled
         AND NOT EXISTS (
           SELECT 1 FROM business_module_subscriptions m
           WHERE m.business_id = bm.business_id AND m.module_key = bm.module_key
         )
       ORDER BY b.name, bm.module_key`,
    );
    console.log(`Enabled modules without a subscription row: ${missing.rowCount}`);
    if (missing.rowCount) console.table(missing.rows);

    const noSub = await client.query(
      `SELECT b.name, b.id AS business_id
       FROM businesses b
       WHERE NOT EXISTS (SELECT 1 FROM business_module_subscriptions m WHERE m.business_id = b.id)
       ORDER BY b.name`,
    );
    console.log(`Businesses with no module subscription at all: ${noSub.rowCount}`);
    if (noSub.rowCount) console.table(noSub.rows);

    await client.query('ROLLBACK');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
