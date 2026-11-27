/**
 * Read-only forecast for the over-limit rules (SUB-24): per plan, how many businesses have more seat holders than
 * their plan's seats, how many have more active branches than their plan's branches, and how many users would be
 * paused / branches made read-only once enforcement starts. Run it on production BEFORE deploying.
 * Only SELECTs, and no personal data: plan ids and counts only (no business names, ids or user names).
 * Uses the same DB env vars as scripts/run-pending-migrations.js.
 *
 *   node scripts/check-over-limit.js
 *
 * It is a forecast, not the app's own answer: it reads each module row's plan (an expired trial counts as the free
 * plan), the registry limits (platform_limits default, plan override) and the same seat predicate as
 * lib/subscription/seat-counting.ts. A business whose plan the app cannot resolve is never paused by the app and is
 * listed here under "unresolved". The app also waits 7 days after first seeing a business over its limit before it
 * pauses anyone, and warns the owner meanwhile.
 */
const { Pool } = require('pg');
const { loadEnvFiles, getMigrationDbConfig, describeMigrationDb } = require('./db-config');

const SQL = `
WITH eff AS (
  SELECT s.business_id, s.module_key,
         CASE
           WHEN s.plan_id = 'trial'    AND s.trial_end_date IS NOT NULL AND s.trial_end_date < CURRENT_DATE THEN 'free'
           WHEN s.plan_id = 'hr_trial' AND s.trial_end_date IS NOT NULL AND s.trial_end_date < CURRENT_DATE THEN 'hr_free'
           ELSE s.plan_id
         END AS plan_id
    FROM business_module_subscriptions s
    JOIN business_modules m ON m.business_id = s.business_id AND m.module_key = s.module_key AND m.enabled = true
   WHERE COALESCE(s.status, '') NOT IN ('cancelled', 'canceled', 'expired')
),
lim AS (
  SELECT e.business_id, e.module_key, e.plan_id, k.limit_key,
         COALESCE(spl.limit_value, pl.default_value) AS v
    FROM eff e
    CROSS JOIN (VALUES ('max_users'), ('max_branches')) AS k(limit_key)
    LEFT JOIN platform_limits pl ON pl.limit_key = k.limit_key AND pl.is_active = true
    LEFT JOIN subscription_plan_limits spl ON spl.plan_id = e.plan_id AND spl.limit_key = k.limit_key
),
seat_allow AS (   -- account-wide: the highest plan wins, -1 = unlimited; Connect has its own pool
  SELECT business_id,
         CASE WHEN bool_or(v = -1) THEN -1 ELSE MAX(v) END AS allowed
    FROM lim WHERE limit_key = 'max_users' AND module_key <> 'connect' AND v IS NOT NULL
   GROUP BY business_id
),
branch_allow AS ( -- owned by Billing
  SELECT business_id, MAX(v) AS allowed
    FROM lim WHERE limit_key = 'max_branches' AND module_key = 'billing' AND v IS NOT NULL
   GROUP BY business_id
),
seats AS (
  SELECT u.business_id, COUNT(*)::int AS holders
    FROM users u
   WHERE COALESCE(u.is_active, true) = true
     AND COALESCE(u.seat_type, 'billing') <> 'connect'
     AND (COALESCE(u.is_primary_admin, false) = true OR u.role_id IS NOT NULL
          OR NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = u.id AND COALESCE(e.access_type, 'full') = 'attendance_only'))
   GROUP BY u.business_id
),
br AS (
  SELECT business_id, COUNT(*)::int AS active_branches
    FROM branches WHERE is_active IS NULL OR is_active = true
   GROUP BY business_id
),
plan_of AS (
  SELECT DISTINCT ON (business_id) business_id, plan_id
    FROM eff ORDER BY business_id, CASE module_key WHEN 'billing' THEN 0 WHEN 'hr' THEN 1 ELSE 2 END
)
SELECT COALESCE(p.plan_id, '(no plan row)') AS plan,
       COUNT(*)::int AS businesses,
       COUNT(*) FILTER (WHERE sa.allowed IS NULL)::int AS seats_unresolved,
       COUNT(*) FILTER (WHERE sa.allowed >= 0 AND COALESCE(s.holders, 0) > sa.allowed)::int AS over_seats,
       COALESCE(SUM(GREATEST(COALESCE(s.holders, 0) - sa.allowed, 0)) FILTER (WHERE sa.allowed >= 0), 0)::int AS users_to_pause,
       COUNT(*) FILTER (WHERE ba.allowed >= 0 AND COALESCE(b.active_branches, 0) > ba.allowed)::int AS over_branches,
       COALESCE(SUM(GREATEST(COALESCE(b.active_branches, 0) - ba.allowed, 0)) FILTER (WHERE ba.allowed >= 0), 0)::int AS branches_to_make_read_only
  FROM businesses bz
  LEFT JOIN plan_of p ON p.business_id = bz.id
  LEFT JOIN seat_allow sa ON sa.business_id = bz.id
  LEFT JOIN branch_allow ba ON ba.business_id = bz.id
  LEFT JOIN seats s ON s.business_id = bz.id
  LEFT JOIN br b ON b.business_id = bz.id
  GROUP BY COALESCE(p.plan_id, '(no plan row)')
  ORDER BY over_seats DESC, over_branches DESC, plan
`;

async function main() {
  loadEnvFiles();
  const config = getMigrationDbConfig();
  const pool = new Pool(config);
  try {
    console.log(`DB: ${describeMigrationDb(config)}`);
    const { rows } = await pool.query(SQL);
    console.log('plan | businesses | seats unresolved | over seats | users to pause | over branches | branches to make read-only');
    let users = 0;
    let branches = 0;
    let overSeats = 0;
    let overBranches = 0;
    for (const r of rows) {
      console.log(
        `${r.plan} | ${r.businesses} | ${r.seats_unresolved} | ${r.over_seats} | ${r.users_to_pause} | ${r.over_branches} | ${r.branches_to_make_read_only}`,
      );
      users += r.users_to_pause;
      branches += r.branches_to_make_read_only;
      overSeats += r.over_seats;
      overBranches += r.over_branches;
    }
    console.log(
      `\nTotal: ${overSeats} business(es) over their seats (${users} user(s) would be paused), ` +
        `${overBranches} over their branches (${branches} branch(es) would become read-only).`,
    );
    console.log('The app waits 7 days after first seeing a business over its limit, and warns the owner by banner and one email.');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
