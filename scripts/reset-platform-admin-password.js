/**
 * Reset (or create) a platform admin password on the current DB (.env).
 *
 * Usage:
 *   node scripts/reset-platform-admin-password.js admin@khatario.com 'YourNewPassword'
 *
 * On VPS staging:
 *   cd /var/www/khatario
 *   node scripts/reset-platform-admin-password.js admin@khatario.com 'YourNewPassword'
 *
 * Login at: https://staging.khatario.com/admin/login
 * (Use /admin/login — not the tenant /login page.)
 */

const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const root = path.join(__dirname, '..');
// VPS uses .env.production; load it first so it wins over any local .env defaults.
for (const name of ['.env.production', '.env']) {
  const envPath = path.join(root, name);
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
}

const email = (process.argv[2] || 'admin@khatario.com').toLowerCase().trim();
const password = process.argv[3];

if (!password || password.length < 6) {
  console.error('Usage: node scripts/reset-platform-admin-password.js <email> <password>');
  console.error('Password must be at least 6 characters.');
  process.exit(1);
}

function getPoolConfig() {
  const url =
    process.env.MIGRATION_DATABASE_URL ||
    process.env.DATABASE_URL_MIGRATE ||
    process.env.DATABASE_URL;
  if (url) {
    return { connectionString: url };
  }
  return {
    host: process.env.DB_HOST || process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || process.env.POSTGRES_PORT || '5432', 10),
    database:
      process.env.DB_NAME ||
      process.env.POSTGRES_DB ||
      process.env.POSTGRES_DATABASE ||
      'khatario',
    user: process.env.DB_USER || process.env.POSTGRES_USER || 'postgres',
    password: String(process.env.DB_PASSWORD ?? process.env.POSTGRES_PASSWORD ?? ''),
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
}

const pool = new Pool(getPoolConfig());

async function main() {
  const hash = await bcrypt.hash(password, 10);

  const existing = await pool.query(
    `SELECT id, email, is_active FROM platform_admins WHERE email = $1`,
    [email],
  );

  if (existing.rows.length === 0) {
    await pool.query(
      `INSERT INTO platform_admins (name, email, password_hash, role, permissions, is_active)
       VALUES ($1, $2, $3, 'super_admin', $4::jsonb, true)`,
      [
        'Platform Owner',
        email,
        hash,
        JSON.stringify({
          can_manage_admins: true,
          can_manage_businesses: true,
          can_manage_subscriptions: true,
          can_manage_plans: true,
          can_view_metrics: true,
          can_view_logs: true,
          can_impersonate_business: true,
        }),
      ],
    );
    console.log(`Created platform admin: ${email}`);
  } else {
    await pool.query(
      `UPDATE platform_admins
       SET password_hash = $2, is_active = true, updated_at = CURRENT_TIMESTAMP
       WHERE email = $1`,
      [email, hash],
    );
    console.log(`Updated password for: ${email}`);
  }

  console.log('\nLogin at: /admin/login');
  console.log(`Email:    ${email}`);
  console.log('Password: (the one you just passed on the command line)\n');
}

main()
  .catch((err) => {
    console.error('Failed:', err.message);
    process.exit(1);
  })
  .finally(() => pool.end());
