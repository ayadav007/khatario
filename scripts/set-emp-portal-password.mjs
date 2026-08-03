import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

function generatePassword() {
  for (let i = 0; i < 32; i++) {
    const raw = crypto.randomBytes(4).toString('hex').toUpperCase();
    const password = `${raw.slice(0, 4)}-${raw.slice(4, 8)}`;
    if (/[A-Za-z]/.test(password) && /[0-9]/.test(password)) return password;
  }
  return 'A1B2-C3D4';
}

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const code = process.argv[2]?.toUpperCase() || 'EMP002';
const password = generatePassword();
const hash = await bcrypt.hash(password, 10);

const info = await pool.query(
  `SELECT e.id, e.employee_code, bs.portal_slug
   FROM employees e
   JOIN business_settings bs ON bs.business_id = e.business_id
   WHERE upper(trim(e.employee_code)) = $1
   LIMIT 1`,
  [code]
);

if (!info.rows[0]) {
  console.error('Employee not found:', code);
  process.exit(1);
}

await pool.query(
  `UPDATE users SET password_hash = $1, must_change_password = true, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
  [hash, info.rows[0].id]
);

const { employee_code, portal_slug } = info.rows[0];
console.log('Employee ID:', employee_code);
console.log('Temporary password:', password);
console.log(`Portal URL: http://localhost:3000/${portal_slug}/employees`);

await pool.end();
