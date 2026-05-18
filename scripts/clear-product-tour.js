/**
 * Reset product_tour_completed_at so the welcome modal + first-run tour show again.
 *
 * Usage:
 *   node scripts/clear-product-tour.js you@example.com
 *   node scripts/clear-product-tour.js <user-uuid>
 *
 * Loads .env.local then .env (same idea as other scripts). Uses DB_* from env.
 */
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env.local') });
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/clear-product-tour.js <email-or-user-uuid>');
    console.error('Example: node scripts/clear-product-tour.js admin@company.com');
    process.exit(1);
  }

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'khatario',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
  });

  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    arg.trim()
  );

  try {
    const sql = isUuid
      ? `UPDATE users SET product_tour_completed_at = NULL, updated_at = NOW() WHERE id = $1`
      : `UPDATE users SET product_tour_completed_at = NULL, updated_at = NOW() WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))`;

    const res = await pool.query(sql, [arg.trim()]);
    if (res.rowCount === 0) {
      console.error('No matching user found. Check email or paste your user id from the app / database.');
      process.exit(1);
    }
    console.log(`OK — cleared product tour flag for ${res.rowCount} user row(s).`);
    console.log('');
    console.log('Reload the app so React picks up the new user row from the server:');
    console.log('  • Hard refresh: Ctrl+Shift+R  (or Cmd+Shift+R on Mac)');
    console.log('  • Or in DevTools console: localStorage.removeItem("user"); location.reload();');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
