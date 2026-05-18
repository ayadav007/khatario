/**
 * Backfill branch_item_stock from items.current_stock onto each business's default branch.
 *
 * Requires migration 156 (creates table branch_item_stock). From project root run first:
 *
 *   node scripts/run-migration.js database/migrations/156_branch_item_stock_ledger_customers.sql
 *
 * IMPORTANT (Windows): Do not double-click this file — that runs Windows Script Host (JScript),
 * which throws a syntax error on `const`. Always run with Node from the project root:
 *
 *   npm run db:backfill:branch-item-stock
 *
 * or:  node scripts/backfill_branch_item_stock.js
 */
const path = require('path');
const fs = require('fs');
const root = path.join(__dirname, '..');

// Same pattern as scripts/migrate.js + lib/db.ts: load project .env from repo root (works regardless of cwd).
require('dotenv').config({ path: path.join(root, '.env') });
// If you run from another cwd, also pick up .env there (does not override vars already set).
require('dotenv').config();

const { Pool } = require('pg');

function getDbPoolConfig() {
  if (process.env.DATABASE_URL && process.env.DATABASE_URL.trim()) {
    return {
      connectionString: process.env.DATABASE_URL.trim(),
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
    };
  }
  const host = process.env.DB_HOST;
  const database = process.env.DB_NAME;
  if (host && database) {
    return {
      host,
      port: parseInt(process.env.DB_PORT || '5432', 10),
      database,
      user: process.env.DB_USER || 'postgres',
      password: process.env.DB_PASSWORD || '',
      ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
    };
  }
  return null;
}

async function main() {
  const poolConfig = getDbPoolConfig();
  if (!poolConfig) {
    const envPath = path.join(root, '.env');
    console.error(
      'No database configuration found after loading:\n' +
        `  ${envPath} (${fs.existsSync(envPath) ? 'exists' : 'missing'})\n` +
        '  process.cwd()/.env (optional)\n\n' +
        'Use the same variables as the app (see lib/db.ts): either\n' +
        '  DATABASE_URL=postgresql://...\n' +
        'or\n' +
        '  DB_HOST=... DB_PORT=5432 DB_NAME=... DB_USER=... DB_PASSWORD=...'
    );
    process.exit(1);
  }
  const pool = new Pool(poolConfig);
  const client = await pool.connect();
  try {
    const exists = await client.query(
      `SELECT to_regclass('public.branch_item_stock') IS NOT NULL AS ok`
    );
    if (!exists.rows[0]?.ok) {
      console.error(
        'Table public.branch_item_stock does not exist yet.\n\n' +
          'Run the migration that creates it (from project root):\n\n' +
          '  node scripts/run-migration.js database/migrations/156_branch_item_stock_ledger_customers.sql\n\n' +
          'Then run this backfill again:\n' +
          '  node scripts/backfill_branch_item_stock.js'
      );
      process.exit(1);
    }

    await client.query('BEGIN');
    const items = await client.query(`
      SELECT i.id AS item_id, i.business_id, i.current_stock::numeric AS qty
      FROM items i
      WHERE i.is_active IS DISTINCT FROM false
    `);
    let n = 0;
    for (const row of items.rows) {
      const def = await client.query(
        `SELECT id FROM branches
         WHERE business_id = $1 AND is_default = true AND is_active = true
         ORDER BY created_at ASC NULLS LAST
         LIMIT 1`,
        [row.business_id]
      );
      if (def.rows.length === 0) continue;
      const branchId = def.rows[0].id;
      const qty = parseFloat(row.qty) || 0;
      await client.query(
        `INSERT INTO branch_item_stock (business_id, branch_id, item_id, quantity, created_at, updated_at)
         VALUES ($1, $2, $3, $4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT (business_id, branch_id, item_id)
         DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = CURRENT_TIMESTAMP`,
        [row.business_id, branchId, row.item_id, qty]
      );
      n++;
    }
    await client.query('COMMIT');
    console.log(`Backfill complete: ${n} item rows synced to default branch (branch_item_stock).`);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
