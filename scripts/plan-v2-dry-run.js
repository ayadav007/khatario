#!/usr/bin/env node
/**
 * Read-only preview of migration 360 (plan catalog v2). Run before applying it.
 * Lists, per business, the billing plan move, features that disappear, and WhatsApp add-ons
 * that become a Connect subscription. Nothing is written.
 * Usage: node scripts/plan-v2-dry-run.js
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig, describeMigrationDb } = require('./db-config');

loadEnvFiles();
const config = getMigrationDbConfig();
const pool = new Pool(config);

const PLAN_MAP = { professional: 'growth', enterprise: 'business' };
const ADDON_TYPES = ['whatsapp_bot', 'whatsapp_send_message', 'khatario_ai'];

/** New billing feature matrices, read from the migration so this preview cannot drift from it. */
function loadNewMatrices() {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'database', 'migrations', '360_plan_catalog_v2.sql'),
    'utf8',
  );
  const matrices = {};
  const block = /FROM \(VALUES ((?:\('\w+'\)(?:,\s*)?)+)\) AS p\(plan_id\)\s*CROSS JOIN unnest\(ARRAY\[([\s\S]*?)\]\)/g;
  for (const m of sql.matchAll(block)) {
    const plans = [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    const features = [...m[2].matchAll(/'(\w+)'/g)].map((x) => x[1]);
    for (const p of plans) {
      matrices[p] = matrices[p] || new Set();
      features.forEach((f) => matrices[p].add(f));
    }
  }
  return matrices;
}

async function main() {
  console.log(`Database: ${describeMigrationDb(config)}\n`);
  const matrices = loadNewMatrices();
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');

    const applied = await client.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_name = 'subscription_plans' AND column_name = 'price_3year'`,
    );
    if (applied.rowCount) {
      console.log('Migration 360 already looks applied (price_3year exists). Showing current state.\n');
    }

    const billing = await client.query(
      `SELECT b.name, m.business_id, m.plan_id, m.status, m.billing_cycle,
              m.end_date, m.trial_end_date, m.scheduled_plan_id
       FROM business_module_subscriptions m
       JOIN businesses b ON b.id = m.business_id
       WHERE m.module_key = 'billing'
       ORDER BY m.plan_id, b.name`,
    );

    const oldMatrix = await client.query(
      `SELECT plan_id, array_agg(feature_id ORDER BY feature_id) AS features
       FROM subscription_plan_features WHERE enabled = true GROUP BY plan_id`,
    );
    const oldFeatures = Object.fromEntries(oldMatrix.rows.map((r) => [r.plan_id, r.features]));

    const rows = billing.rows.map((r) => {
      const newPlan = PLAN_MAP[r.plan_id] || r.plan_id;
      const target = matrices[newPlan];
      const lost = target ? (oldFeatures[r.plan_id] || []).filter((f) => !target.has(f)) : [];
      return {
        business: r.name,
        old_plan: r.plan_id,
        new_plan: newPlan,
        status: r.status,
        cycle: r.billing_cycle || '',
        paid_until: r.end_date ? r.end_date.toISOString().slice(0, 10) : '',
        lost_features: lost.filter((f) => !f.startsWith('hr_')).join(', '),
      };
    });

    const counts = rows.reduce((acc, r) => {
      const k = `${r.old_plan} -> ${r.new_plan}`;
      acc[k] = (acc[k] || 0) + 1;
      return acc;
    }, {});
    console.log('Billing plan moves:');
    console.table(counts);
    console.log('Per business (paid period is kept; the new price applies at renewal):');
    console.table(rows);

    const addons = await client.query(
      `SELECT b.name, a.business_id,
              array_agg(a.addon_type ORDER BY a.addon_type) AS addons,
              CASE WHEN bool_or(a.end_date IS NULL) THEN NULL ELSE MAX(a.end_date) END AS addon_end,
              m.plan_id AS connect_plan, m.status AS connect_status
       FROM whatsapp_addons a
       JOIN businesses b ON b.id = a.business_id
       LEFT JOIN business_module_subscriptions m
         ON m.business_id = a.business_id AND m.module_key = 'connect'
       WHERE a.addon_type = ANY($1) AND a.status = 'active'
         AND (a.end_date IS NULL OR a.end_date >= CURRENT_DATE)
       GROUP BY b.name, a.business_id, m.plan_id, m.status
       ORDER BY b.name`,
      [ADDON_TYPES],
    );
    const nextMonth = new Date();
    nextMonth.setMonth(nextMonth.getMonth() + 1);
    console.log(`WhatsApp add-ons converted to Connect: ${addons.rowCount}`);
    if (addons.rowCount) {
      console.table(
        addons.rows.map((r) => ({
          business: r.name,
          addons: r.addons.join(', '),
          current_connect: r.connect_plan ? `${r.connect_plan} (${r.connect_status})` : 'none',
          connect_until: (r.addon_end || nextMonth).toISOString().slice(0, 10),
        })),
      );
    }

    const addonIds = new Set(addons.rows.map((r) => r.business_id));
    const connectRows = await client.query(
      `SELECT b.name, m.business_id, m.status
       FROM business_module_subscriptions m
       JOIN businesses b ON b.id = m.business_id
       WHERE m.module_key = 'connect' AND m.plan_id = 'connect'
       ORDER BY b.name`,
    );
    const toFree = connectRows.rows.filter((r) => !addonIds.has(r.business_id));
    console.log(`Connect rows without a paid add-on, moving to connect_free: ${toFree.length}`);
    if (toFree.length) console.table(toFree.map((r) => ({ business: r.name, status: r.status })));

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
