/**
 * Writes an attendance row under the monthly attendance limit (`max_attendance_records_per_month`).
 *
 * Only a genuinely new row for (employee, day) counts: the same statement may be an upsert onto a day that
 * already has a row, and updating that row is never refused. The "is there a row?" test runs inside the limit
 * lock, so two concurrent requests for different employees at limit - 1 cannot both add a row.
 */

import { limitedUpsertCount } from '@/lib/subscription/limit-lock';

export function insertAttendanceLimited<T = any>(
  businessId: string,
  employeeId: string,
  dateYmd: string,
  sql: string,
  params: unknown[],
): Promise<T | null> {
  return limitedUpsertCount<T>(
    businessId,
    'attendance',
    async (client) => {
      const existing = await client.query(
        `SELECT 1 FROM employee_attendance WHERE employee_id = $1 AND date = $2::date`,
        [employeeId, dateYmd],
      );
      return (existing.rowCount ?? 0) > 0 ? 0 : 1;
    },
    sql,
    params,
  );
}
