import { query, queryOne, queryRows } from '@/lib/db';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * True only when every employee id and every shift id belongs to [businessId]. Callers refuse the
 * request (404) before any write when this is false, so ids from another business are never used.
 */
export async function ownsEmployeesAndShifts(
  businessId: string,
  employeeIds: unknown[],
  shiftIds: unknown[],
): Promise<boolean> {
  const employees = [...new Set(employeeIds.map((v) => String(v ?? '')))];
  const shifts = [...new Set(shiftIds.map((v) => String(v ?? '')))];
  if (![...employees, ...shifts].every((id) => UUID_RE.test(id))) return false;
  if (employees.length) {
    const rows = await queryRows<{ id: string }>(
      `SELECT id FROM employees WHERE id::text = ANY($1::text[]) AND business_id = $2`,
      [employees, businessId],
    );
    if (rows.length !== employees.length) return false;
  }
  if (shifts.length) {
    const rows = await queryRows<{ id: string }>(
      `SELECT id FROM shifts WHERE id::text = ANY($1::text[]) AND business_id = $2`,
      [shifts, businessId],
    );
    if (rows.length !== shifts.length) return false;
  }
  return true;
}

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
    // Both statements are limited to this business's own employee and shift, whatever ids came in.
    const updated = await queryOne(
      `UPDATE employees SET default_shift_id = $3::uuid, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1::uuid AND business_id = $2::uuid
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM shifts sh WHERE sh.id = $3::uuid AND sh.business_id = $2::uuid))
       RETURNING id`,
      [employeeId, input.businessId, input.shiftId],
    );
    if (!updated) continue;

    const inserted = await queryOne(
      `INSERT INTO employee_shift_overrides (
         business_id, employee_id, shift_id, effective_from, effective_to, assigned_by
       )
       SELECT $1::uuid, e.id, $3::uuid, $4::date, $5::date, $6::uuid
       FROM employees e
       WHERE e.id = $2::uuid AND e.business_id = $1::uuid
         AND ($3::uuid IS NULL OR EXISTS (SELECT 1 FROM shifts sh WHERE sh.id = $3::uuid AND sh.business_id = $1::uuid))
       RETURNING id`,
      [
        input.businessId,
        employeeId,
        input.shiftId,
        input.effectiveFrom,
        input.effectiveTo ?? null,
        input.assignedBy ?? null,
      ],
    );
    if (inserted) count++;
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
