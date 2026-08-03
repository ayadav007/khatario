import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
});

const code = process.argv[2]?.toUpperCase() || 'EMP002';
const testPassword = process.argv[3] || null;

const { rows } = await pool.query(
  `SELECT e.id, e.business_id, e.employee_code, e.is_active as emp_active,
          u.is_active as user_active, u.password_hash, u.must_change_password,
          b.name as business, bs.portal_slug
   FROM employees e
   JOIN users u ON u.id = e.id
   JOIN businesses b ON b.id = e.business_id
   LEFT JOIN business_settings bs ON bs.business_id = b.id
   WHERE upper(trim(e.employee_code)) = $1
   ORDER BY e.created_at DESC NULLS LAST`,
  [code]
);

console.log('matches:', rows.length);
for (const row of rows) {
  const hashPrefix = row.password_hash?.slice(0, 7) ?? null;
  let compare = null;
  if (testPassword && row.password_hash) {
    compare = await bcrypt.compare(testPassword, row.password_hash);
  }
  console.log(
    JSON.stringify(
      {
        id: row.id,
        business_id: row.business_id,
        business: row.business,
        portal_slug: row.portal_slug,
        employee_code: row.employee_code,
        emp_active: row.emp_active,
        user_active: row.user_active,
        has_password_hash: Boolean(row.password_hash),
        hash_prefix: hashPrefix,
        must_change_password: row.must_change_password,
        password_test: testPassword ? compare : undefined,
      },
      null,
      2
    )
  );
}

await pool.end();
