/**
 * One-time local seed for employee portal demo (EMP002 @ akshat-enterprices).
 * Run: node scripts/seed-employee-portal-demo.mjs
 */
import 'dotenv/config';
import pg from 'pg';

const pool = new pg.Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'khatario',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || '',
});

const emp = await pool.query(
  `SELECT e.id, e.business_id
   FROM employees e
   JOIN business_settings bs ON bs.business_id = e.business_id
   WHERE upper(trim(e.employee_code)) = 'EMP002'
     AND lower(trim(bs.portal_slug)) = 'akshat-enterprices'
   LIMIT 1`,
);

if (!emp.rows[0]) {
  console.error('EMP002 not found for akshat-enterprices');
  process.exit(1);
}

const { id: employeeId, business_id: businessId } = emp.rows[0];

await pool.query(
  `UPDATE employees SET access_type = 'full', date_of_birth = COALESCE(date_of_birth, '1990-06-26'::date) WHERE id = $1`,
  [employeeId],
);
await pool.query(
  `UPDATE users SET must_change_password = false WHERE id = $1`,
  [employeeId],
);

const lt = await pool.query(
  `SELECT id, leave_name FROM leave_types WHERE business_id = $1 AND is_active = true LIMIT 1`,
  [businessId],
);

if (lt.rows[0]) {
  const year = new Date().getFullYear();
  await pool.query(
    `INSERT INTO leave_balances (business_id, employee_id, leave_type_id, year, opening_balance, earned_days, used_days, current_balance, carry_forward_days)
     VALUES ($1, $2, $3, $4, 2, 6, 1, 7, 0)
     ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE
       SET opening_balance = EXCLUDED.opening_balance,
           earned_days = EXCLUDED.earned_days,
           used_days = EXCLUDED.used_days,
           current_balance = EXCLUDED.current_balance`,
    [businessId, employeeId, lt.rows[0].id, year],
  );
  console.log('Leave balance seeded for', lt.rows[0].leave_name);
} else {
  console.log('No leave type — skip balance seed');
}

await pool.query(
  `INSERT INTO hr_announcements (business_id, title, body, author_name)
   SELECT $1, 'Welcome to the employee portal', 'Your HR team can post updates here.', 'HR Team'
   WHERE NOT EXISTS (
     SELECT 1 FROM hr_announcements WHERE business_id = $1 AND title = 'Welcome to the employee portal'
   )`,
  [businessId],
);

await pool.query(
  `INSERT INTO tasks (business_id, title, description, assigned_to, assigned_by, status, priority)
   SELECT $1, 'Complete your profile', 'Upload ID proof in Me → Documents', $2, $2, 'pending', 'medium'
   WHERE NOT EXISTS (
     SELECT 1 FROM tasks WHERE business_id = $1 AND assigned_to = $2 AND title = 'Complete your profile'
   )`,
  [businessId, employeeId],
);

console.log('Portal demo seed complete for EMP002');
await pool.end();
