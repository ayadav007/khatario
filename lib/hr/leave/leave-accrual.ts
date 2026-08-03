import { query, queryOne, queryRows } from '@/lib/db';
import { getDefaultPlanBundle, getLeavePlanTypeRules } from '@/lib/hr/leave/leave-plan';
import { prorateAnnualQuota } from '@/lib/hr/leave/leave-days';
import { getLeaveYear } from '@/lib/hr/leave/types';

function accrualAmountForPeriod(
  annualQuota: number,
  mode: string,
): number {
  if (mode === 'monthly') return annualQuota / 12;
  if (mode === 'quarterly') return annualQuota / 4;
  return annualQuota;
}

export async function ensureLeaveBalanceRow(
  employeeId: string,
  leaveTypeId: string,
  year: number,
): Promise<void> {
  await queryOne(
    `INSERT INTO leave_balances (employee_id, leave_type_id, year, current_balance)
     VALUES ($1, $2, $3, 0)
     ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
    [employeeId, leaveTypeId, year],
  );
}

export async function runLeaveAccrualForBusiness(
  businessId: string,
  asOfDate = new Date(),
): Promise<{ credited: number; employees: number }> {
  const accrualMonth = `${asOfDate.getFullYear()}-${String(asOfDate.getMonth() + 1).padStart(2, '0')}-01`;

  const existing = await queryOne(
    `SELECT id FROM leave_accrual_runs WHERE business_id = $1 AND accrual_month = $2::date`,
    [businessId, accrualMonth],
  );
  if (existing) return { credited: 0, employees: 0 };

  const { plan } = await getDefaultPlanBundle(businessId);
  const rules = await getLeavePlanTypeRules(plan.id);
  const leaveYear = getLeaveYear(asOfDate, plan.calendar_year_start_month);

  const employees = await queryRows<{ id: string; joining_date: string | null }>(
    `SELECT e.id, e.joining_date::text
     FROM employees e
     INNER JOIN users u ON u.id = e.id
     WHERE e.business_id = $1 AND e.is_active = true AND u.is_active = true`,
    [businessId],
  );

  let credited = 0;
  for (const emp of employees) {
    for (const rule of rules) {
      if (rule.accrual_mode === 'lump_sum') {
        await ensureLeaveBalanceRow(emp.id, rule.leave_type_id, leaveYear);
        continue;
      }

      if (asOfDate.getDate() < rule.accrual_day_of_month) continue;

      let quota = rule.annual_quota;
      if (rule.prorate_on_join && emp.joining_date) {
        quota = prorateAnnualQuota(
          rule.annual_quota,
          emp.joining_date,
          plan.calendar_year_start_month,
          asOfDate,
        );
      }

      const increment = accrualAmountForPeriod(quota, rule.accrual_mode);
      await ensureLeaveBalanceRow(emp.id, rule.leave_type_id, leaveYear);

      await queryOne(
        `UPDATE leave_balances SET
           earned_days = earned_days + $4,
           current_balance = opening_balance + earned_days + carry_forward_days - used_days,
           updated_at = CURRENT_TIMESTAMP
         WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
        [emp.id, rule.leave_type_id, leaveYear, increment],
      );
      credited += increment;
    }
  }

  await query(
    `INSERT INTO leave_accrual_runs (business_id, accrual_month, summary)
     VALUES ($1, $2::date, $3::jsonb)`,
    [
      businessId,
      accrualMonth,
      JSON.stringify({ credited, employees: employees.length, leave_year: leaveYear }),
    ],
  );

  return { credited, employees: employees.length };
}

export async function runLeaveAccrualForAllBusinesses(
  asOfDate = new Date(),
): Promise<{ businesses: number; credited: number }> {
  const businesses = await queryRows<{ business_id: string }>(
    `SELECT business_id FROM leave_plans WHERE is_default = true AND is_active = true`,
  );
  let credited = 0;
  for (const b of businesses) {
    const result = await runLeaveAccrualForBusiness(b.business_id, asOfDate);
    credited += result.credited;
  }
  return { businesses: businesses.length, credited };
}

export async function initializeEmployeeLeaveBalances(
  businessId: string,
  employeeId: string,
  joiningDate?: string | null,
): Promise<void> {
  const { plan } = await getDefaultPlanBundle(businessId);
  const rules = await getLeavePlanTypeRules(plan.id);
  const leaveYear = getLeaveYear(new Date(), plan.calendar_year_start_month);

  for (const rule of rules) {
    let earned = 0;
    if (rule.accrual_mode === 'lump_sum') {
      earned = rule.annual_quota;
      if (rule.prorate_on_join && joiningDate) {
        earned = prorateAnnualQuota(
          rule.annual_quota,
          joiningDate,
          plan.calendar_year_start_month,
        );
      }
    }

    await queryOne(
      `INSERT INTO leave_balances (
         employee_id, leave_type_id, year, opening_balance, earned_days, current_balance
       ) VALUES ($1, $2, $3, 0, $4, $4)
       ON CONFLICT (employee_id, leave_type_id, year) DO UPDATE SET
         earned_days = CASE WHEN leave_balances.earned_days = 0 THEN EXCLUDED.earned_days ELSE leave_balances.earned_days END,
         current_balance = leave_balances.opening_balance + leave_balances.earned_days + leave_balances.carry_forward_days - leave_balances.used_days,
         updated_at = CURRENT_TIMESTAMP`,
      [employeeId, rule.leave_type_id, leaveYear, earned],
    );
  }
}
