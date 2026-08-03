import { queryOne } from '@/lib/db';
import { ensureLeaveBalanceRow } from '@/lib/hr/leave/leave-accrual';
import { getLeaveYear } from '@/lib/hr/leave/types';
import { getDefaultPlanBundle } from '@/lib/hr/leave/leave-plan';

export type BulkImportRow = {
  employee_code: string;
  leave_code: string;
  opening_balance?: number;
  earned_days?: number;
};

export type BulkImportResult = {
  imported: number;
  errors: string[];
};

export function parseLeaveBalanceCsv(text: string): BulkImportRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];

  const header = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const codeIdx = header.indexOf('employee_code');
  const leaveIdx = header.indexOf('leave_code');
  const openIdx = header.indexOf('opening_balance');
  const earnedIdx = header.indexOf('earned_days');

  if (codeIdx < 0 || leaveIdx < 0) return [];

  return lines.slice(1).map((line) => {
    const cols = line.split(',').map((c) => c.trim());
    return {
      employee_code: cols[codeIdx] ?? '',
      leave_code: cols[leaveIdx] ?? '',
      opening_balance: openIdx >= 0 ? Number(cols[openIdx] || 0) : undefined,
      earned_days: earnedIdx >= 0 ? Number(cols[earnedIdx] || 0) : undefined,
    };
  });
}

export async function importLeaveBalancesCsv(
  businessId: string,
  csvText: string,
  year?: number,
): Promise<BulkImportResult> {
  const rows = parseLeaveBalanceCsv(csvText);
  const { plan } = await getDefaultPlanBundle(businessId);
  const leaveYear = year ?? getLeaveYear(new Date(), plan.calendar_year_start_month);

  let imported = 0;
  const errors: string[] = [];

  for (const row of rows) {
    if (!row.employee_code || !row.leave_code) {
      errors.push('Missing employee_code or leave_code in a row');
      continue;
    }

    const employee = await queryOne<{ id: string }>(
      `SELECT id FROM employees WHERE business_id = $1 AND employee_code = $2`,
      [businessId, row.employee_code],
    );
    if (!employee) {
      errors.push(`Employee not found: ${row.employee_code}`);
      continue;
    }

    const leaveType = await queryOne<{ id: string }>(
      `SELECT id FROM leave_types WHERE business_id = $1 AND leave_code = $2`,
      [businessId, row.leave_code],
    );
    if (!leaveType) {
      errors.push(`Leave type not found: ${row.leave_code}`);
      continue;
    }

    await ensureLeaveBalanceRow(employee.id, leaveType.id, leaveYear);

    const opening = row.opening_balance ?? 0;
    const earned = row.earned_days ?? 0;

    await queryOne(
      `UPDATE leave_balances SET
         opening_balance = $4,
         earned_days = $5,
         current_balance = $4 + $5 + carry_forward_days - used_days,
         updated_at = CURRENT_TIMESTAMP
       WHERE employee_id = $1 AND leave_type_id = $2 AND year = $3`,
      [employee.id, leaveType.id, leaveYear, opening, earned],
    );
    imported += 1;
  }

  return { imported, errors };
}
