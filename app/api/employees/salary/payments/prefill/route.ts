import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest } from '@/lib/auth-helpers';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { queryOne, queryRows } from '@/lib/db';
import {
  getActiveSalaryStructure,
  payrollPrefillFromStructure,
  payrollPrefillWithProRata,
} from '@/lib/hr/salary-structure';
import { computeProRataMonthlySalary } from '@/lib/hr/salary-payroll-helpers';
import {
  computeAttendanceDeductions,
  getAttendancePolicy,
  type AttendanceRecordForPolicy,
} from '@/lib/hr/attendance-policy';
import { getHrPayrollSettings } from '@/lib/hr/hr-payroll-settings';
import { calculateStatutory } from '@/lib/hr/statutory';
import {
  buildPaymentComponentBreakdown,
  ensureStructureLinesFromLegacy,
} from '@/lib/hr/salary-components';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  try {
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request);
    if (!businessId || !userId) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
    }

    await authorize(userId, 'payroll', 'read', { businessId });

    const { searchParams } = new URL(request.url);
    const employeeId = searchParams.get('employee_id');
    const fromDate = searchParams.get('from_date');
    const toDate = searchParams.get('to_date');

    if (!employeeId || !fromDate || !toDate) {
      return NextResponse.json(
        { error: 'employee_id, from_date, and to_date are required' },
        { status: 400 },
      );
    }

    const employee = await queryOne<{
      salary: number | null;
      joining_date: string | null;
      pf_applicable: boolean | null;
      esi_applicable: boolean | null;
      uan: string | null;
      esi_ip_number: string | null;
    }>(
      `SELECT salary, joining_date,
              COALESCE(pf_applicable, true) AS pf_applicable,
              COALESCE(esi_applicable, true) AS esi_applicable,
              uan, esi_ip_number
       FROM employees WHERE id = $1 AND business_id = $2`,
      [employeeId, businessId],
    );
    if (!employee) {
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 });
    }

    const structure = await getActiveSalaryStructure(employeeId, businessId, toDate);
    const policy = await getAttendancePolicy(businessId);

    let prefillPayload: Record<string, unknown>;

    if (structure) {
      const result = payrollPrefillWithProRata(
        structure,
        fromDate,
        toDate,
        employee.joining_date,
      );
      prefillPayload = {
        source: 'salary_structure',
        structure_id: structure.id,
        effective_from: structure.effective_from,
        fields: result.fields,
        pro_rata: result.proRata,
      };
    } else {
      const monthlySalary = Number(employee.salary ?? 0);
      const proRata = computeProRataMonthlySalary({
        monthlySalary,
        periodFrom: fromDate,
        periodTo: toDate,
        joiningDate: employee.joining_date,
      });
      prefillPayload = {
        source: 'employee_salary',
        fields: {
          basic_salary: proRata.proratedAmount,
          hra: 0,
          transport_allowance: 0,
          medical_allowance: 0,
          special_allowance: 0,
          other_earnings: 0,
          provident_fund: 0,
          professional_tax: 0,
          tds: 0,
          other_deductions: 0,
          gross_monthly: proRata.proratedAmount,
        },
        pro_rata: proRata,
      };
    }

    const attendanceRows = await queryRows<AttendanceRecordForPolicy>(
      `SELECT date::text AS date, status,
              COALESCE(is_late, false) AS is_late,
              COALESCE(late_excused, false) AS late_excused,
              COALESCE(late_minutes, 0) AS late_minutes,
              COALESCE(late_marked_manual, false) AS late_marked_manual
       FROM employee_attendance
       WHERE employee_id = $1 AND date >= $2::date AND date <= $3::date`,
      [employeeId, fromDate, toDate],
    );

    const fullGross = structure
      ? payrollPrefillFromStructure(structure).gross_monthly
      : Number(employee.salary ?? 0);
    const fullBasic = structure
      ? Number(structure.basic_salary ?? 0)
      : Number(employee.salary ?? 0);

    const attendanceDeductions = computeAttendanceDeductions({
      policy,
      records: attendanceRows,
      monthlyGross: fullGross,
      monthlyBasic: fullBasic,
      periodFrom: fromDate,
      periodTo: toDate,
    });

    const settings = await getHrPayrollSettings(businessId);
    const fields = (prefillPayload.fields ?? {}) as Record<string, number>;
    const basic = Number(fields.basic_salary ?? 0);
    const gross = Number(fields.gross_monthly ?? basic);
    const pfFixed =
      structure && structure.pf_fixed_amount != null
        ? Number(structure.pf_fixed_amount)
        : null;
    const ptFixedFromStructure =
      structure && Number(structure.professional_tax ?? 0) > 0
        ? Number(structure.professional_tax)
        : null;

    const statutory = calculateStatutory({
      settings,
      basic,
      gross,
      pfFixedAmount: pfFixed,
      professionalTaxFixed: ptFixedFromStructure,
      pfApplicable: employee.pf_applicable !== false,
      esiApplicable: employee.esi_applicable !== false,
    });

    // Overlay statutory when enabled; keep legacy structure amounts when toggles are off.
    if (settings.pf_enabled) {
      fields.provident_fund = statutory.provident_fund;
    }
    if (settings.pt_enabled || ptFixedFromStructure != null) {
      fields.professional_tax = statutory.professional_tax;
    }
    fields.employer_provident_fund = statutory.employer_provident_fund;
    fields.esi_employee = statutory.esi_employee;
    fields.esi_employer = statutory.esi_employer;
    fields.pf_wage = statutory.pf_wage;
    fields.esi_wage = statutory.esi_wage;
    prefillPayload.fields = fields;
    prefillPayload.statutory = {
      ...statutory.breakdown,
      amounts: {
        provident_fund: statutory.provident_fund,
        employer_provident_fund: statutory.employer_provident_fund,
        esi_employee: statutory.esi_employee,
        esi_employer: statutory.esi_employer,
        professional_tax: statutory.professional_tax,
        pf_wage: statutory.pf_wage,
        esi_wage: statutory.esi_wage,
      },
      employee: {
        uan: employee.uan,
        esi_ip_number: employee.esi_ip_number,
        pf_applicable: employee.pf_applicable !== false,
        esi_applicable: employee.esi_applicable !== false,
      },
    };

    let componentBreakdown: ReturnType<typeof buildPaymentComponentBreakdown> = [];
    if (structure?.id) {
      const structureLines = await ensureStructureLinesFromLegacy(
        String(structure.id),
        structure,
        businessId,
      );
      const proRata = prefillPayload.pro_rata as
        | { fullMonthlySalary?: number; proratedAmount?: number; applied?: boolean }
        | undefined;
      const factor =
        proRata?.applied &&
        proRata.fullMonthlySalary &&
        proRata.fullMonthlySalary > 0
          ? (proRata.proratedAmount ?? 0) / proRata.fullMonthlySalary
          : 1;
      const scaledLines = structureLines.map((line) => ({
        ...line,
        amount:
          line.component_type === 'earning' ||
          line.system_key === 'professional_tax' ||
          line.system_key === 'other_deductions'
            ? Math.round(line.amount * factor * 100) / 100
            : line.amount,
      }));
      componentBreakdown = buildPaymentComponentBreakdown({
        structureLines: scaledLines,
        statutory: {
          provident_fund: settings.pf_enabled ? statutory.provident_fund : undefined,
          esi_employee: statutory.esi_employee,
          professional_tax: statutory.professional_tax,
          employer_provident_fund: statutory.employer_provident_fund,
          esi_employer: statutory.esi_employer,
        },
      });
    }
    prefillPayload.component_breakdown = componentBreakdown;

    return NextResponse.json({
      ...prefillPayload,
      attendance_deduction: attendanceDeductions,
      attendance_summary: {
        present: attendanceRows.filter((r) => r.status === 'present').length,
        absent: attendanceRows.filter((r) => r.status === 'absent').length,
        half_day: attendanceRows.filter((r) => r.status === 'half_day').length,
        leave: attendanceRows.filter((r) => r.status === 'leave').length,
      },
    });
  } catch (error) {
    if (error instanceof AuthorizationError) return error.toNextResponse();
    console.error('[salary/payments/prefill GET]', error);
    return NextResponse.json({ error: 'Failed to compute prefill' }, { status: 500 });
  }
}
