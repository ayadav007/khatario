/**
 * Leave Calculator
 * Calculates working days, validates leave requests, and manages balances
 */

import { queryRows, queryOne } from '@/lib/db';

/**
 * Calculate working days between two dates (excluding weekends and holidays)
 */
export async function calculateWorkingDays(
  startDate: Date,
  endDate: Date,
  businessId: string
): Promise<number> {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  if (start > end) {
    throw new Error('Start date must be before or equal to end date');
  }

  // Get holidays for the business
  const holidays = await queryRows<{ holiday_date: Date }>(
    'SELECT holiday_date FROM holidays WHERE business_id = $1 AND holiday_date BETWEEN $2 AND $3',
    [businessId, start, end]
  );

  const holidayDates = new Set(
    holidays.map(h => h.holiday_date.toISOString().split('T')[0])
  );

  let workingDays = 0;
  const current = new Date(start);

  while (current <= end) {
    const dayOfWeek = current.getDay(); // 0 = Sunday, 6 = Saturday
    const dateStr = current.toISOString().split('T')[0];

    // Check if it's a weekday and not a holiday
    if (dayOfWeek !== 0 && dayOfWeek !== 6 && !holidayDates.has(dateStr)) {
      workingDays++;
    }

    current.setDate(current.getDate() + 1);
  }

  return workingDays;
}

/**
 * Check if employee has sufficient leave balance
 */
export async function checkLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  requiredDays: number,
  year: number
): Promise<{ sufficient: boolean; currentBalance: number; shortfall?: number }> {
  const balance = await queryOne<{ current_balance: number }>(
    'SELECT current_balance FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
    [employeeId, leaveTypeId, year]
  );

  if (!balance) {
    return { sufficient: false, currentBalance: 0, shortfall: requiredDays };
  }

  const currentBalance = balance.current_balance;
  const sufficient = currentBalance >= requiredDays;
  const shortfall = sufficient ? undefined : requiredDays - currentBalance;

  return { sufficient, currentBalance, shortfall };
}

/**
 * Get or initialize leave balance for an employee
 */
export async function getOrInitializeLeaveBalance(
  employeeId: string,
  leaveTypeId: string,
  year: number
): Promise<{ current_balance: number }> {
  let balance = await queryOne<{ current_balance: number }>(
    'SELECT current_balance FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
    [employeeId, leaveTypeId, year]
  );

  if (!balance) {
    // Initialize with zero balance
    await queryOne(
      `INSERT INTO leave_balances (employee_id, leave_type_id, year, current_balance)
       VALUES ($1, $2, $3, 0)
       ON CONFLICT (employee_id, leave_type_id, year) DO NOTHING`,
      [employeeId, leaveTypeId, year]
    );

    balance = await queryOne<{ current_balance: number }>(
      'SELECT current_balance FROM leave_balances WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3',
      [employeeId, leaveTypeId, year]
    )!;
  }

  return balance!;
}

