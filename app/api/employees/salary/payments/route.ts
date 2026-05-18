import { NextRequest, NextResponse } from 'next/server';
import { getUserIdFromRequest, getBusinessIdFromRequest, getSessionScopedBusinessId } from '@/lib/auth-helpers';
import { queryRows, queryOne, query } from '@/lib/db';
import { SalaryPayment } from '@/types/database';
import { authorize, AuthorizationError } from '@/lib/authorization';
import { limitExceededResponse } from '@/lib/subscription/limit-response';

/**
 * GET /api/employees/salary/payments
 * List salary payments
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const businessId = getBusinessIdFromRequest(request);
    const userId = getUserIdFromRequest(request); // REQUIRED for authorization
    const employeeId = searchParams.get('employee_id');
    const salaryMonth = searchParams.get('salary_month');
    const status = searchParams.get('status');

    if (!businessId) {
      return NextResponse.json(
        { error: 'business_id is required' },
        { status: 400 }
      );
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'user_id is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check read permission (salary payments are part of HR/payroll module)
    try {
      await authorize(userId, 'payroll', 'read', { businessId });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    let sql = `
      SELECT 
        sp.*,
        u.name as employee_name,
        e.employee_code
      FROM salary_payments sp
      JOIN employees e ON sp.employee_id = e.id
      JOIN users u ON e.id = u.id
      WHERE sp.business_id = $1
    `;
    const params: any[] = [businessId];
    let paramIndex = 2;

    if (employeeId) {
      sql += ` AND sp.employee_id = $${paramIndex}`;
      params.push(employeeId);
      paramIndex++;
    }

    if (salaryMonth) {
      sql += ` AND sp.salary_month = $${paramIndex}`;
      params.push(salaryMonth);
      paramIndex++;
    }

    if (status) {
      sql += ` AND sp.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    sql += ` ORDER BY sp.salary_month DESC, sp.created_at DESC`;

    const payments = await queryRows<SalaryPayment & {
      employee_name: string;
      employee_code: string;
    }>(sql, params);

    return NextResponse.json({ payments });
  } catch (error: any) {
    console.error('Error fetching salary payments:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/employees/salary/payments
 * Create a new salary payment
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const business_id = getSessionScopedBusinessId(request);

    const {
      employee_id,
      salary_month,
      from_date,
      to_date,
      payment_date,
      basic_salary,
      hra = 0,
      transport_allowance = 0,
      medical_allowance = 0,
      special_allowance = 0,
      overtime = 0,
      bonus = 0,
      commission = 0,
      other_earnings = 0,
      provident_fund = 0,
      professional_tax = 0,
      tds = 0,
      advance_recovery = 0,
      loan_deduction = 0,
      other_deductions = 0,
      payment_mode,
      payment_reference,
      working_days,
      present_days,
      absent_days,
      leave_days,
      overtime_hours,
      notes,
      processed_by,
      generate_payslip = true,
    } = body;

    if (!business_id || !employee_id || !salary_month || !from_date || !to_date || !payment_date) {
      return NextResponse.json(
        { error: 'Active business scope, employee_id, salary_month, from_date, to_date, and payment_date are required' },
        { status: 400 }
      );
    }

    // Use processed_by as fallback if not provided
    const authUserId = processed_by;
    if (!authUserId) {
      return NextResponse.json(
        { error: 'processed_by (user_id) is required for authorization' },
        { status: 400 }
      );
    }

    // AUTHORIZATION: Check create permission (salary payments are part of HR/payroll module)
    try {
      await authorize(authUserId, 'payroll', 'create', { businessId: business_id });
    } catch (error) {
      if (error instanceof AuthorizationError) {
        return error.toNextResponse();
      }
      throw error;
    }

    const payrollLimit = await limitExceededResponse(business_id, 'payroll');
    if (payrollLimit) return payrollLimit;

    // Calculate totals
    const totalEarnings = Number(basic_salary) + Number(hra) + Number(transport_allowance) +
      Number(medical_allowance) + Number(special_allowance) + Number(overtime) +
      Number(bonus) + Number(commission) + Number(other_earnings);

    const totalDeductions = Number(provident_fund) + Number(professional_tax) + Number(tds) +
      Number(advance_recovery) + Number(loan_deduction) + Number(other_deductions);

    const grossSalary = totalEarnings;
    const netSalary = grossSalary - totalDeductions;

    // Check if salary payment already exists for this month
    const existing = await queryOne(
      'SELECT id FROM salary_payments WHERE business_id = $1 AND employee_id = $2 AND salary_month = $3',
      [business_id, employee_id, salary_month]
    );

    if (existing) {
      return NextResponse.json(
        { error: 'Salary payment already exists for this month' },
        { status: 409 }
      );
    }

    // Get employee bank details
    const employee = await queryOne(
      'SELECT bank_account_number, bank_ifsc FROM employees WHERE id = $1 AND business_id = $2',
      [employee_id, business_id]
    );

    // Get pending advances for automatic recovery
    const pendingAdvances = await queryRows<{
      id: string;
      advance_amount: number;
      recovered_amount: number;
      remaining_amount: number;
      recovery_method: string;
    }>(
      `SELECT id, advance_amount, recovered_amount, remaining_amount, recovery_method
       FROM salary_advances
       WHERE business_id = $1 AND employee_id = $2
         AND status IN ('approved', 'partially_recovered')
         AND remaining_amount > 0
       ORDER BY advance_date ASC`,
      [business_id, employee_id]
    );

    // Calculate total advance recovery
    let totalAdvanceRecovery = Number(advance_recovery || 0);
    const advanceRecoveries: Array<{ advance_id: string; recovery_amount: number }> = [];

    if (pendingAdvances.length > 0 && totalAdvanceRecovery > 0) {
      let remainingRecovery = totalAdvanceRecovery;
      
      for (const advance of pendingAdvances) {
        if (remainingRecovery <= 0) break;
        
        const recoveryAmount = Math.min(remainingRecovery, advance.remaining_amount);
        advanceRecoveries.push({
          advance_id: advance.id,
          recovery_amount: recoveryAmount,
        });
        remainingRecovery -= recoveryAmount;
      }
    }

    // Insert salary payment
    const salaryPayment = await queryOne<SalaryPayment>(
      `INSERT INTO salary_payments (
        business_id, employee_id, salary_month, from_date, to_date, payment_date,
        basic_salary, hra, transport_allowance, medical_allowance, special_allowance,
        overtime, bonus, commission, other_earnings, total_earnings,
        provident_fund, professional_tax, tds, advance_recovery, loan_deduction,
        other_deductions, total_deductions, gross_salary, net_salary,
        payment_mode, payment_reference, bank_account_number, bank_ifsc,
        working_days, present_days, absent_days, leave_days, overtime_hours,
        status, processed_at, processed_by, notes
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29,
        $30, $31, $32, $33, $34, $35, $36, $37, $38
      )
      RETURNING *`,
      [
        business_id, employee_id, salary_month, from_date, to_date, payment_date,
        basic_salary, hra, transport_allowance, medical_allowance, special_allowance,
        overtime, bonus, commission, other_earnings, totalEarnings,
        provident_fund, professional_tax, tds, advance_recovery, loan_deduction,
        other_deductions, totalDeductions, grossSalary, netSalary,
        payment_mode || null, payment_reference || null,
        employee?.bank_account_number || null, employee?.bank_ifsc || null,
        working_days || null, present_days || null, absent_days || null,
        leave_days || null, overtime_hours || null,
        'processed', new Date(), processed_by || null, notes || null,
      ]
    );

    if (!salaryPayment) {
      return NextResponse.json(
        { error: 'Failed to create salary payment' },
        { status: 500 }
      );
    }

    // Record advance recoveries
    for (const recovery of advanceRecoveries) {
      const newRecoveredAmount = await queryOne<{ recovered_amount: number }>(
        `SELECT recovered_amount FROM salary_advances WHERE id = $1 AND business_id = $2`,
        [recovery.advance_id, business_id]
      );

      const updatedRecovered = Number(newRecoveredAmount?.recovered_amount || 0) + recovery.recovery_amount;
      const advance = await queryOne(
        `SELECT advance_amount FROM salary_advances WHERE id = $1 AND business_id = $2`,
        [recovery.advance_id, business_id]
      );
      const newRemaining = Number(advance?.advance_amount || 0) - updatedRecovered;
      const newStatus = newRemaining <= 0 ? 'recovered' : 'partially_recovered';

      await query(
        `UPDATE salary_advances
         SET recovered_amount = $1,
             remaining_amount = $2,
             status = $3,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $4 AND business_id = $5`,
        [updatedRecovered, newRemaining, newStatus, recovery.advance_id, business_id]
      );

      await query(
        `INSERT INTO advance_recoveries (advance_id, salary_payment_id, recovery_amount, recovery_date)
         VALUES ($1, $2, $3, $4)`,
        [recovery.advance_id, salaryPayment.id, recovery.recovery_amount, payment_date]
      );
    }

    // Generate payslip if requested
    if (generate_payslip) {
      try {
        const { generatePayslipHtml } = await import('@/lib/payslip-generator');
        const html = await generatePayslipHtml(salaryPayment.id);

        await query(
          `INSERT INTO payslips (salary_payment_id, employee_id, business_id, payslip_data, html_content)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            salaryPayment.id,
            employee_id,
            business_id,
            JSON.stringify({
              salary_month,
              net_salary: netSalary,
              gross_salary: grossSalary,
            }),
            html,
          ]
        );
      } catch (payslipError) {
        console.error('Error generating payslip:', payslipError);
        // Don't fail the salary payment if payslip generation fails
      }
    }

    return NextResponse.json({ 
      salary_payment: salaryPayment,
      advance_recoveries: advanceRecoveries.length,
    }, { status: 201 });
  } catch (error: any) {
    console.error('Error creating salary payment:', error);
    return NextResponse.json(
      { error: error.message || 'Internal server error' },
      { status: 500 }
    );
  }
}

