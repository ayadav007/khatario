import { NextRequest, NextResponse } from 'next/server';
import { getBusinessIdFromRequest, getUserIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { toCsv } from '@/lib/hr/reports/csv';
import {
  fetchAttendanceRegister,
  fetchHeadcount,
  fetchLeaveBalances,
  fetchLeaveConsumption,
  fetchLeaveNegativeBalances,
  fetchLeaveAccrualRegister,
  fetchLeaveCarryForward,
  fetchLeaveEncashment,
  fetchOvertimeRegister,
  fetchPayrollRegister,
} from '@/lib/hr/reports/queries';
import { fetchEmployeeRosterReport } from '@/lib/hr/dashboard-enhanced';

export const dynamic = 'force-dynamic';

const REPORT_CONFIG: Record<
  string,
  { filename: string; headers: string[]; fetch: (businessId: string, year: number, month: number) => Promise<unknown[][]> }
> = {
  attendance: {
    filename: 'attendance-register',
    headers: [
      'Employee Code',
      'Employee Name',
      'Department',
      'Date',
      'Status',
      'Check In',
      'Check Out',
      'Late',
      'Late Minutes',
    ],
    fetch: fetchAttendanceRegister,
  },
  'leave-balances': {
    filename: 'leave-balances',
    headers: [
      'Employee Code',
      'Employee Name',
      'Leave Type',
      'Opening',
      'Earned',
      'Used',
      'Carry Forward',
      'Balance',
    ],
    fetch: async (businessId, year) => fetchLeaveBalances(businessId, year),
  },
  'leave-consumption': {
    filename: 'leave-consumption',
    headers: ['Employee Code', 'Employee Name', 'Leave Type', 'Start', 'End', 'Days', 'Status'],
    fetch: async (businessId, year) => fetchLeaveConsumption(businessId, year),
  },
  'leave-negative-balances': {
    filename: 'leave-negative-balances',
    headers: ['Employee Code', 'Employee Name', 'Leave Type', 'Balance'],
    fetch: async (businessId, year) => fetchLeaveNegativeBalances(businessId, year),
  },
  'leave-accrual': {
    filename: 'leave-accrual',
    headers: ['Accrual Month', 'Ran At', 'Days Credited', 'Employees'],
    fetch: async (businessId, year) => fetchLeaveAccrualRegister(businessId, year),
  },
  'leave-carry-forward': {
    filename: 'leave-carry-forward',
    headers: ['Leave Year', 'Ran At', 'Processed', 'Encashment Total'],
    fetch: async (businessId, year) => fetchLeaveCarryForward(businessId, year),
  },
  'leave-encashment': {
    filename: 'leave-encashment',
    headers: [
      'Employee Code',
      'Employee Name',
      'Leave Type',
      'Leave Year',
      'Days',
      'Amount',
      'Status',
      'Salary Month',
    ],
    fetch: async (businessId, year) => fetchLeaveEncashment(businessId, year),
  },
  'payroll-register': {
    filename: 'payroll-register',
    headers: [
      'Employee Code',
      'Employee Name',
      'Department',
      'Gross',
      'Net',
      'Attendance Deduction',
      'Status',
      'Payment Date',
    ],
    fetch: fetchPayrollRegister,
  },
  'overtime-register': {
    filename: 'overtime-register',
    headers: [
      'Employee Code',
      'Employee Name',
      'Department',
      'Date',
      'Hours',
      'Compensation',
      'Status',
      'Reason',
    ],
    fetch: fetchOvertimeRegister,
  },
  headcount: {
    filename: 'headcount',
    headers: ['Department', 'Employment Type', 'Active Count'],
    fetch: async (businessId) => fetchHeadcount(businessId),
  },
  'employees-registered': {
    filename: 'employees-registered',
    headers: ['Employee Code', 'Name', 'Department', 'Designation', 'Registered At', 'Joining Date'],
    fetch: async (businessId) => {
      const rows = await fetchEmployeeRosterReport(businessId, 'registered');
      return rows.map((r) => {
        const row = r as Record<string, string | null>;
        return [
          row.employee_code,
          row.name,
          row.department ?? '',
          row.designation ?? '',
          row.registered_at ?? '',
          row.joining_date ?? '',
        ];
      });
    },
  },
  'employees-unregistered': {
    filename: 'employees-unregistered',
    headers: ['Employee Code', 'Name', 'Department', 'Designation', 'Invited At', 'Joining Date'],
    fetch: async (businessId) => {
      const rows = await fetchEmployeeRosterReport(businessId, 'unregistered');
      return rows.map((r) => {
        const row = r as Record<string, string | null>;
        return [
          row.employee_code,
          row.name,
          row.department ?? '',
          row.designation ?? '',
          row.portal_invited_at ?? '',
          row.joining_date ?? '',
        ];
      });
    },
  },
  'new-joinings': {
    filename: 'new-joinings',
    headers: ['Employee Code', 'Name', 'Department', 'Designation', 'Joining Date'],
    fetch: async (businessId) => {
      const rows = await fetchEmployeeRosterReport(businessId, 'new_joinings');
      return rows.map((r) => {
        const row = r as Record<string, string | null>;
        return [
          row.employee_code,
          row.name,
          row.department ?? '',
          row.designation ?? '',
          row.joining_date ?? '',
        ];
      });
    },
  },
};

export async function GET(
  request: NextRequest,
  { params }: { params: { type: string } },
) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'employees', 'read', { businessId });

    const config = REPORT_CONFIG[params.type];
    if (!config) {
      return NextResponse.json({ error: 'Unknown report type' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const now = new Date();
    const year = Number(searchParams.get('year') ?? now.getFullYear());
    const month = Number(searchParams.get('month') ?? now.getMonth() + 1);

    const rows = await config.fetch(businessId, year, month);
    const csv = toCsv(config.headers, rows);
    const suffix =
      params.type === 'headcount'
        ? now.toISOString().slice(0, 10)
        : params.type.startsWith('leave-')
          ? String(year)
          : `${year}-${String(month).padStart(2, '0')}`;

    return new NextResponse(csv, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${config.filename}-${suffix}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[hr/reports GET]', error);
    return NextResponse.json({ error: 'Failed to generate report' }, { status: 500 });
  }
}
