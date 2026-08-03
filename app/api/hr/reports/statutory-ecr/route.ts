import { NextRequest, NextResponse } from 'next/server';
import {
  getBusinessIdFromRequest,
  getUserIdFromRequest,
} from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { query, queryRows } from '@/lib/db';
import { getHrPayrollSettings } from '@/lib/hr/hr-payroll-settings';
import { businessHasModule, getBusinessPlatformContext } from '@/lib/business-modules';

export const dynamic = 'force-dynamic';

type EcrRow = {
  employee_code: string;
  employee_name: string;
  uan: string | null;
  basic_salary: number;
  pf_wage: number | null;
  provident_fund: number;
  employer_provident_fund: number;
  esi_ip_number: string | null;
  esi_wage: number | null;
  esi_employee: number;
  esi_employer: number;
  professional_tax: number;
  gross_salary: number;
  net_salary: number;
};

/**
 * GET /api/hr/reports/statutory-ecr?salary_month=2026-03
 * CSV export of PF/ESI/PT amounts for a salary month (simplified ECR helper).
 */
export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    const platform = await getBusinessPlatformContext(businessId);
    if (!businessHasModule(platform, 'hr')) {
      return NextResponse.json({ error: 'HR module is not enabled' }, { status: 403 });
    }

    await authorize(userId, 'payroll', 'read', { businessId });

    const salaryMonth = new URL(request.url).searchParams.get('salary_month');
    if (!salaryMonth) {
      return NextResponse.json({ error: 'salary_month is required (YYYY-MM)' }, { status: 400 });
    }

    const settings = await getHrPayrollSettings(businessId);
    const rows = await queryRows<EcrRow>(
      `SELECT
         e.employee_code,
         u.name AS employee_name,
         e.uan,
         sp.basic_salary,
         sp.pf_wage,
         sp.provident_fund,
         COALESCE(sp.employer_provident_fund, 0) AS employer_provident_fund,
         e.esi_ip_number,
         sp.esi_wage,
         COALESCE(sp.esi_employee, 0) AS esi_employee,
         COALESCE(sp.esi_employer, 0) AS esi_employer,
         sp.professional_tax,
         sp.gross_salary,
         sp.net_salary
       FROM salary_payments sp
       JOIN employees e ON e.id = sp.employee_id
       JOIN users u ON u.id = e.id
       WHERE sp.business_id = $1
         AND sp.salary_month = $2
         AND sp.status IN ('processed', 'paid', 'pending')
       ORDER BY e.employee_code`,
      [businessId, salaryMonth],
    );

    const header = [
      'Employee Code',
      'Employee Name',
      'UAN',
      'Basic',
      'PF Wage',
      'EE PF',
      'ER PF',
      'ESI IP',
      'ESI Wage',
      'EE ESI',
      'ER ESI',
      'PT',
      'Gross',
      'Net',
    ];

    const lines = [
      `# Establishment: ${settings.pf_establishment_id || '-'}`,
      `# ESI Code: ${settings.esi_code || '-'}`,
      `# Month: ${salaryMonth}`,
      header.join(','),
      ...rows.map((r) =>
        [
          csv(r.employee_code),
          csv(r.employee_name),
          csv(r.uan || ''),
          num(r.basic_salary),
          num(r.pf_wage ?? r.basic_salary),
          num(r.provident_fund),
          num(r.employer_provident_fund),
          csv(r.esi_ip_number || ''),
          num(r.esi_wage ?? r.gross_salary),
          num(r.esi_employee),
          num(r.esi_employer),
          num(r.professional_tax),
          num(r.gross_salary),
          num(r.net_salary),
        ].join(','),
      ),
    ];

    try {
      await query(
        `INSERT INTO statutory_export_log (business_id, salary_month, export_type, row_count, generated_by)
         VALUES ($1, $2, 'ecr_csv', $3, $4)`,
        [businessId, salaryMonth, rows.length, userId],
      );
    } catch {
      /* table may not exist until migration runs — ignore log failure */
    }

    const body = lines.join('\n');
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="statutory-${salaryMonth}.csv"`,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[hr/reports/statutory-ecr]', error);
    return NextResponse.json({ error: 'Failed to export statutory report' }, { status: 500 });
  }
}

function csv(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function num(v: number): string {
  return (Number(v) || 0).toFixed(2);
}
