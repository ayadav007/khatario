import { query, queryOne, queryRows } from '@/lib/db';

export async function bulkAssignShift(input: {
  businessId: string;
  shiftId: string | null;
  employeeIds?: string[];
  department?: string;
  branchId?: string;
  assignedBy?: string;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<number> {
  let employeeIds = input.employeeIds ?? [];

  if (employeeIds.length === 0) {
    let sql = `SELECT id FROM employees WHERE business_id = $1 AND is_active = true`;
    const params: unknown[] = [input.businessId];
    if (input.department) {
      sql += ` AND department = $${params.length + 1}`;
      params.push(input.department);
    }
    if (input.branchId) {
      sql += ` AND branch_id = $${params.length + 1}`;
      params.push(input.branchId);
    }
    const rows = await queryRows<{ id: string }>(sql, params);
    employeeIds = rows.map((r) => r.id);
  }

  let count = 0;
  for (const employeeId of employeeIds) {
    await queryOne(
      `UPDATE employees SET default_shift_id = $3, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 AND business_id = $2`,
      [employeeId, input.businessId, input.shiftId],
    );

    await query(
      `INSERT INTO employee_shift_overrides (
         business_id, employee_id, shift_id, effective_from, effective_to, assigned_by
       ) VALUES ($1, $2, $3, $4::date, $5, $6)`,
      [
        input.businessId,
        employeeId,
        input.shiftId,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.assignedBy ?? null,
      ],
    );
    count++;
  }
  return count;
}

export async function managerAssignShiftForEmployee(input: {
  businessId: string;
  managerUserId: string;
  employeeId: string;
  shiftId: string | null;
  effectiveFrom: string;
  effectiveTo?: string | null;
}): Promise<void> {
  const { getDirectReportIds } = await import('@/lib/hr/manager-scope');
  const team = await getDirectReportIds(input.businessId, input.managerUserId);
  if (!team.includes(input.employeeId)) {
    throw new Error('You can only change shifts for your direct reports');
  }
  await bulkAssignShift({
    businessId: input.businessId,
    shiftId: input.shiftId,
    employeeIds: [input.employeeId],
    assignedBy: input.managerUserId,
    effectiveFrom: input.effectiveFrom,
    effectiveTo: input.effectiveTo,
  });
}

export async function resolveShiftForEmployeeOnDate(
  businessId: string,
  employeeId: string,
  dateStr: string,
): Promise<string | null> {
  const { getRosterEntryForDate } = await import('@/lib/hr/shift-overtime/shift-roster');
  const roster = await getRosterEntryForDate(businessId, employeeId, dateStr);
  if (roster) {
    if (roster.is_day_off) return null;
    if (roster.shift_id) return roster.shift_id;
  }

  const override = await queryOne<{ shift_id: string | null }>(
    `SELECT shift_id FROM employee_shift_overrides
     WHERE employee_id = $1 AND business_id = $2
       AND effective_from <= $3::date
       AND (effective_to IS NULL OR effective_to >= $3::date)
     ORDER BY effective_from DESC LIMIT 1`,
    [employeeId, businessId, dateStr],
  );
  if (override) return override.shift_id;

  const emp = await queryOne<{ default_shift_id: string | null }>(
    `SELECT default_shift_id FROM employees WHERE id = $1 AND business_id = $2`,
    [employeeId, businessId],
  );
  return emp?.default_shift_id ?? null;
}
