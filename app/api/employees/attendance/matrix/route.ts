import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUserId, requireTenantBusinessId } from '@/lib/auth-helpers';
import { queryRows } from '@/lib/db';
import { authorize, AuthorizationError } from '@/lib/authorization';
import {
  buildEmployeeScopeSql,
  getActorEmployeeId,
  resolveEmployeeListScope,
} from '@/lib/hr/employee-access-scope';
import {
  buildAttendanceMatrix,
  parseAttendanceMatrixMonth,
  monthDateRange,
  type AttendanceMatrixStatus,
} from '@/lib/hr/attendance-matrix';
import { getBusinessWeeklyOffPolicy } from '@/lib/hr/shift-overtime/weekly-off';
import { parseWeeklyOffPolicy, type WeeklyOffPolicy } from '@/lib/hr/shift-overtime/types';

export const dynamic = 'force-dynamic';

type EmployeeRow = {
  id: string;
  employee_code: string;
  employee_name: string;
  branch_id: string | null;
  weekly_off_override: unknown;
};

type AttendanceRow = {
  employee_id: string;
  date: string;
  status: AttendanceMatrixStatus;
  total_hours: string | number | null;
};

type HolidayRow = {
  branch_id: string | null;
  is_default: boolean;
  holiday_date: string;
};

type HolidayListRow = {
  branch_id: string | null;
  is_default: boolean;
};

type RosterOffRow = {
  employee_id: string;
  roster_date: string;
};

/**
 * GET /api/employees/attendance/matrix?month=YYYY-MM
 * Read-only month grid: one row per employee, one column per day.
 */
export async function GET(request: NextRequest) {
  try {
    const tenant = requireTenantBusinessId(request);
    if (!tenant.ok) return tenant.response;

    const userId = getAuthenticatedUserId(request);
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const month = parseAttendanceMatrixMonth(new URL(request.url).searchParams.get('month'));
    if (!month) {
      return NextResponse.json({ error: 'month must be YYYY-MM' }, { status: 400 });
    }

    const businessId = tenant.businessId;

    try {
      await authorize(userId, 'attendance', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) return error.toNextResponse();
      throw error;
    }

    const { start, end } = monthDateRange(month.year, month.month);
    const listScope = await resolveEmployeeListScope(userId, businessId, null);
    const actorEmployeeId = await getActorEmployeeId(userId, businessId);
    const scopeFilter = buildEmployeeScopeSql(listScope, actorEmployeeId, 2);

    const employees = await queryRows<EmployeeRow>(
      `SELECT e.id, e.employee_code, u.name AS employee_name, e.branch_id, e.weekly_off_override
       FROM employees e
       INNER JOIN users u ON e.id = u.id
       WHERE e.business_id = $1
         AND e.is_active = true
         AND u.is_active = true
         ${scopeFilter.sql}
       ORDER BY u.name ASC`,
      [businessId, ...scopeFilter.params],
    );

    const [attendance, holidays, holidayLists, rosterOff, businessWeeklyOff] = await Promise.all([
      queryRows<AttendanceRow>(
        `SELECT a.employee_id, a.date::text AS date, a.status, a.total_hours
         FROM employee_attendance a
         INNER JOIN employees e ON a.employee_id = e.id
         WHERE e.business_id = $1
           AND a.date >= $2::date
           AND a.date <= $3::date`,
        [businessId, start, end],
      ),
      queryRows<HolidayRow>(
        `SELECT hl.branch_id, hl.is_default, h.holiday_date::text AS holiday_date
         FROM holidays h
         INNER JOIN holiday_lists hl ON hl.id = h.holiday_list_id
         WHERE h.business_id = $1
           AND h.holiday_date >= $2::date
           AND h.holiday_date <= $3::date`,
        [businessId, start, end],
      ),
      queryRows<HolidayListRow>(
        `SELECT branch_id, is_default FROM holiday_lists WHERE business_id = $1`,
        [businessId],
      ),
      queryRows<RosterOffRow>(
        `SELECT employee_id, roster_date::text AS roster_date
         FROM shift_roster_entries
         WHERE business_id = $1
           AND is_day_off = true
           AND roster_date >= $2::date
           AND roster_date <= $3::date`,
        [businessId, start, end],
      ),
      getBusinessWeeklyOffPolicy(businessId),
    ]);

    const branchesWithLists = new Set(
      holidayLists.filter((list) => list.branch_id).map((list) => list.branch_id as string),
    );
    const holidaysByBranch = new Map<string, string[]>();
    const defaultHolidays: string[] = [];
    for (const holiday of holidays) {
      if (holiday.branch_id) {
        const dates = holidaysByBranch.get(holiday.branch_id) ?? [];
        dates.push(holiday.holiday_date);
        holidaysByBranch.set(holiday.branch_id, dates);
      } else if (holiday.is_default) {
        defaultHolidays.push(holiday.holiday_date);
      }
    }

    const rosterByEmployee = new Map<string, string[]>();
    for (const row of rosterOff) {
      const dates = rosterByEmployee.get(row.employee_id) ?? [];
      dates.push(row.roster_date);
      rosterByEmployee.set(row.employee_id, dates);
    }

    const attendanceByEmployee = new Set(employees.map((employee) => employee.id));
    const matrix = buildAttendanceMatrix({
      year: month.year,
      month: month.month,
      employees: employees.map((employee) => {
        const weeklyOff: WeeklyOffPolicy = employee.weekly_off_override
          ? parseWeeklyOffPolicy(employee.weekly_off_override)
          : businessWeeklyOff;
        const holidayDates =
          employee.branch_id && branchesWithLists.has(employee.branch_id)
            ? (holidaysByBranch.get(employee.branch_id) ?? [])
            : defaultHolidays;
        return {
          id: employee.id,
          code: employee.employee_code,
          name: employee.employee_name,
          weeklyOff,
          offDates: [...holidayDates, ...(rosterByEmployee.get(employee.id) ?? [])],
        };
      }),
      attendance: attendance
        .filter((row) => attendanceByEmployee.has(row.employee_id))
        .map((row) => ({
          employeeId: row.employee_id,
          date: row.date,
          status: row.status,
          totalHours: row.total_hours == null ? null : Number(row.total_hours),
        })),
    });

    return NextResponse.json({
      month: `${month.year}-${String(month.month).padStart(2, '0')}`,
      days: matrix.days,
      workers: matrix.workers,
    });
  } catch (error: unknown) {
    console.error('Error fetching attendance matrix:', error);
    const message = error instanceof Error ? error.message : 'Internal server error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
