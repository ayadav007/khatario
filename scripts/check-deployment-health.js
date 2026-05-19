#!/usr/bin/env node
/**
 * Run on the VPS to debug login / DB / JWT issues:
 *   node scripts/check-deployment-health.js
 * Loads .env.production then .env from project root (cwd).
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
for (const name of ['.env.production', '.env']) {
  const p = path.join(root, name);
  if (fs.existsSync(p)) {
    require('dotenv').config({ path: p });
    console.log(`Loaded ${name}`);
    break;
  }
}

function status(label, ok, detail = '') {
  console.log(`${ok ? '✓' : '✗'} ${label}${detail ? `: ${detail}` : ''}`);
}

async function main() {
  console.log('\n=== Khatario deployment health ===\n');

  const jwt = process.env.JWT_SECRET;
  status('JWT_SECRET', !!jwt, jwt ? `length ${jwt.length}` : 'MISSING — login will 500');

  const dbVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
  for (const k of dbVars) {
    status(k, !!process.env[k], process.env[k] ? 'set' : 'MISSING');
  }
  status('DB_PORT', true, process.env.DB_PORT || '5432 (default)');
  status('NODE_ENV', true, process.env.NODE_ENV || '(unset)');

  if (!process.env.JWT_SECRET) {
    console.log('\nFix: set JWT_SECRET in .env.production and restart PM2 with --update-env\n');
    process.exit(1);
  }

  let Pool;
  try {
    Pool = require('pg').Pool;
  } catch (e) {
    status('pg module', false, e.message);
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl:
      process.env.DB_SSL === 'true'
        ? { rejectUnauthorized: false }
        : false,
    connectionTimeoutMillis: 8000,
  });

  try {
    await pool.query('SELECT 1 AS ok');
    status('PostgreSQL connect', true);
  } catch (e) {
    status('PostgreSQL connect', false, e.message);
    console.log('\nLogin 500 is often a DB connection failure on VPS.\n');
    await pool.end();
    process.exit(1);
  }

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'users'
       AND column_name IN ('auth_session_version', 'allow_multidevice_sync', 'password_hash')`
  );
  const found = new Set(cols.rows.map((r) => r.column_name));
  for (const c of ['password_hash', 'auth_session_version', 'allow_multidevice_sync']) {
    status(`users.${c}`, found.has(c), found.has(c) ? '' : 'run npm run db:migrate');
  }

  const phone = process.argv[2] || '7777777777';
  const formats = [phone, `+91${phone}`, `91${phone}`];
  let user = null;
  for (const p of formats) {
    const r = await pool.query(
      'SELECT id, phone, business_id, (password_hash IS NOT NULL) AS has_pw FROM users WHERE phone = $1 LIMIT 1',
      [p]
    );
    if (r.rows[0]) {
      user = r.rows[0];
      break;
    }
  }
  status(`User lookup (${phone})`, !!user, user ? `id=${user.id} phone=${user.phone}` : 'no row — would get 401 not 500');

  try {
    const { SignJWT } = require('jose');
    await new SignJWT({ test: true })
      .setProtectedHeader({ alg: 'HS256' })
      .setExpirationTime('60s')
      .sign(new TextEncoder().encode(process.env.JWT_SECRET));
    status('JWT sign (jose)', true);
  } catch (e) {
    status('JWT sign (jose)', false, e.message);
  }

  await pool.end();
  console.log('\nIf all checks pass but login still 500, run login on localhost and watch PM2:\n');
  console.log('  curl -sk -X POST https://127.0.0.1:3000/api/auth/login -H "Content-Type: application/json" -d \'{"phone":"...","password":"..."}\'');
  console.log('  pm2 logs khatario --lines 50\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
