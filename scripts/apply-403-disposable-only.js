/**
 * Applies only 403_purchase_acquisition_cost.sql to the local disposable database.
 * Refuses any other database name or a non-local port.
 */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let val = match[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    out[match[1]] = val;
  }
  return out;
}

async function main() {
  const env = readEnv(path.join(__dirname, '..', '.env'));
  const host = env.DB_HOST || '';
  if (host !== 'localhost' && host !== '127.0.0.1' && host !== '::1') {
    throw new Error('Refusing migration: database host is not local');
  }
  const pool = new Pool({
    host,
    port: Number(env.DB_PORT || 5432),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: 'kh_phase2_test',
  });
  const client = await pool.connect();
  try {
    const info = (
      await client.query(`SELECT current_database() AS db, inet_server_port() AS port, inet_server_addr()::text AS addr`)
    ).rows[0];
    const local = info.addr == null || String(info.addr).startsWith('127.0.0.1') || String(info.addr).startsWith('::1');
    if (info.db !== 'kh_phase2_test' || Number(info.port) !== 5433 || !local) {
      throw new Error(`Refusing to migrate ${info.db} on ${info.addr}:${info.port}`);
    }
    const exists = await client.query(`SELECT to_regclass('public.purchases') AS purchases`);
    if (!exists.rows[0].purchases) throw new Error('purchases table is missing; refusing to apply 403');
    const sql = fs.readFileSync(
      path.join(__dirname, '..', 'database', 'migrations', '403_purchase_acquisition_cost.sql'),
      'utf8'
    );
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      `INSERT INTO schema_migrations (migration_name, success, error_message)
       VALUES ('403_purchase_acquisition_cost.sql', true, NULL)
       ON CONFLICT (migration_name) DO UPDATE SET success = true, executed_at = NOW(), error_message = NULL`
    );
    await client.query('COMMIT');
    const check = await client.query(
      `SELECT current_database() AS db, inet_server_port() AS port,
              EXISTS (SELECT 1 FROM information_schema.columns
                       WHERE table_name = 'purchase_items' AND column_name = 'acquisition_cost') AS has_cost`
    );
    console.log(JSON.stringify(check.rows[0]));
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
